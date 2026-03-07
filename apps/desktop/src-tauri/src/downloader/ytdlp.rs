use crate::{
  binaries::resolve_binary_path,
  constants::{EVENT_DOWNLOAD_COMPLETE, EVENT_DOWNLOAD_ERROR, EVENT_DOWNLOAD_PROGRESS, EVENT_QUEUE_UPDATED},
  downloader::progress::parse_progress_line,
  models::{DownloadFormat, DownloadStatus, SubtitleSource, SubtitleTrack, VideoInfo},
  state::AppState,
};
use chrono::Utc;
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};
use thiserror::Error;
use tracing::error;

struct AttemptResult {
  success: bool,
  cancelled: bool,
  last_error_line: Option<String>,
  auth_error_detected: bool,
}

#[derive(Error, Debug)]
pub enum DownloaderError {
  #[error("resource lookup failed: {0}")]
  Resource(String),
  #[error("process failed: {0}")]
  Process(String),
  #[error("serialization failed: {0}")]
  Serialization(String),
}

impl From<DownloaderError> for String {
  fn from(value: DownloaderError) -> Self {
    value.to_string()
  }
}

pub async fn enqueue_download(app: AppHandle, state: AppState) -> Result<(), String> {
  let mut active = state.active_job.lock().await;
  if active.is_some() {
    return Ok(());
  }

  let next_job = {
    let order = state.order.lock().await;
    let jobs = state.jobs.lock().await;
    order
      .iter()
      .find(|job_id| {
        jobs
          .get(job_id)
          .map(|job| matches!(job.status, DownloadStatus::Queued))
          .unwrap_or(false)
      })
      .copied()
  };

  let Some(job_id) = next_job else {
    return Ok(());
  };

  *active = Some(job_id);
  drop(active);

  let app_clone = app.clone();
  let state_clone = state.clone();
  tauri::async_runtime::spawn(async move {
    let mut current_job_id = Some(job_id);
    while let Some(active_job_id) = current_job_id {
      if let Err(err) = run_download_job(app_clone.clone(), state_clone.clone(), active_job_id).await {
        error!("download failed: {err}");
      }

      {
        let mut active = state_clone.active_job.lock().await;
        *active = None;
      }

      current_job_id = {
        let order = state_clone.order.lock().await;
        let jobs = state_clone.jobs.lock().await;
        order
          .iter()
          .find(|next_job_id| {
            jobs
              .get(next_job_id)
              .map(|job| matches!(job.status, DownloadStatus::Queued))
              .unwrap_or(false)
          })
          .copied()
      };

      if let Some(next_job_id) = current_job_id {
        let mut active = state_clone.active_job.lock().await;
        *active = Some(next_job_id);
      }
    }
  });

  Ok(())
}

pub async fn get_video_info(app: &AppHandle, video_id: &str) -> Result<VideoInfo, String> {
  let ytdlp = resolve_binary_path(app, yt_dlp_binary_name()).map_err(DownloaderError::Resource)?;
  let target = format!("https://www.youtube.com/watch?v={video_id}");
  let output = app
    .shell()
    .command(ytdlp.to_string_lossy().to_string())
    .args(["--dump-json", "--skip-download", &target])
    .output()
    .await
    .map_err(|error| DownloaderError::Process(error.to_string()))?;

  if output.status.code() != Some(0) {
    return Err(DownloaderError::Process(String::from_utf8_lossy(&output.stderr).to_string()).into());
  }

  let payload: Value = serde_json::from_slice(&output.stdout)
    .map_err(|error| DownloaderError::Serialization(error.to_string()))?;
  Ok(map_video_info(video_id, &payload))
}

async fn run_download_job(app: AppHandle, state: AppState, job_id: uuid::Uuid) -> Result<(), String> {
  let starting_job = {
    let mut jobs = state.jobs.lock().await;
    let job = jobs.get_mut(&job_id).ok_or_else(|| "job not found".to_string())?;
    job.status = DownloadStatus::Downloading;
    job.error = None;
    job.clone()
  };
  let request = starting_job.request.clone();
  let _ = app.emit(EVENT_QUEUE_UPDATED, &starting_job);

  let output_dir = match resolve_output_dir(request.output_dir.as_deref()) {
    Ok(path) => path,
    Err(message) => {
      mark_job_failed(&app, &state, job_id, message).await?;
      return Ok(());
    }
  };

  if let Err(message) = ensure_output_directory_writable(&output_dir) {
    mark_job_failed(&app, &state, job_id, message).await?;
    return Ok(());
  }

  let output_dir_value = output_dir.to_string_lossy().to_string();
  {
    let mut jobs = state.jobs.lock().await;
    if let Some(job) = jobs.get_mut(&job_id) {
      job.output_dir_resolved = Some(output_dir_value);
    }
  }

  let output_template = output_dir
    .join("%(title)s.%(ext)s")
    .to_string_lossy()
    .to_string();

  let ytdlp = match resolve_binary_path(&app, yt_dlp_binary_name()) {
    Ok(path) => path,
    Err(error) => {
      mark_job_failed(
        &app,
        &state,
        job_id,
        DownloaderError::Resource(error).to_string(),
      )
      .await?;
      return Ok(());
    }
  };
  let mut base_args = build_download_args(
    &request.url,
    &request.format,
    request.quality.as_deref(),
    request.subtitle_lang.as_deref(),
    request.subtitle_source.as_ref(),
  );
  base_args.extend(["-o".to_string(), output_template.clone(), "--newline".to_string()]);

  let first_attempt = match run_ytdlp_attempt(
    &app,
    &state,
    job_id,
    ytdlp.to_string_lossy().to_string(),
    base_args.clone(),
  )
  .await
  {
    Ok(result) => result,
    Err(error) => {
      mark_job_failed(
        &app,
        &state,
        job_id,
        DownloaderError::Process(error.to_string()).to_string(),
      )
      .await?;
      return Ok(());
    }
  };

  if first_attempt.cancelled || is_job_cancelled(&state, job_id).await? {
    return Ok(());
  }

  let retry_with_cookies = should_retry_with_browser_cookies(&first_attempt);
  let mut success = first_attempt.success;
  let mut final_error_line = first_attempt.last_error_line;
  if retry_with_cookies {
    let mut cookie_args = base_args;
    cookie_args.extend(["--cookies-from-browser".to_string(), "chrome".to_string()]);
    let second_attempt = match run_ytdlp_attempt(
      &app,
      &state,
      job_id,
      ytdlp.to_string_lossy().to_string(),
      cookie_args,
    )
    .await
    {
      Ok(result) => result,
      Err(error) => {
        mark_job_failed(
          &app,
          &state,
          job_id,
          DownloaderError::Process(error.to_string()).to_string(),
        )
        .await?;
        return Ok(());
      }
    };

    if second_attempt.cancelled || is_job_cancelled(&state, job_id).await? {
      return Ok(());
    }

    success = second_attempt.success;
    final_error_line = second_attempt.last_error_line.or(final_error_line);
  }

  if success {
    let completed = {
      let mut jobs = state.jobs.lock().await;
      let job = jobs.get_mut(&job_id).ok_or_else(|| "job not found".to_string())?;
      job.status = DownloadStatus::Complete;
      job.progress = 100.0;
      job.completed_at = Some(Utc::now().to_rfc3339());
      job.clone()
    };
    let _ = app.emit(EVENT_DOWNLOAD_COMPLETE, &completed);
  } else {
    let error_message = final_error_line.unwrap_or_else(|| "yt-dlp failed".to_string());
    let failed = {
      let mut jobs = state.jobs.lock().await;
      let job = jobs.get_mut(&job_id).ok_or_else(|| "job not found".to_string())?;
      job.status = DownloadStatus::Error;
      job.error = Some(error_message);
      job.completed_at = Some(Utc::now().to_rfc3339());
      job.clone()
    };
    let _ = app.emit(EVENT_DOWNLOAD_ERROR, &failed);
  }

  Ok(())
}

async fn run_ytdlp_attempt(
  app: &AppHandle,
  state: &AppState,
  job_id: uuid::Uuid,
  ytdlp_command: String,
  args: Vec<String>,
) -> Result<AttemptResult, String> {
  let (mut rx, child) = app
    .shell()
    .command(ytdlp_command)
    .args(args)
    .spawn()
    .map_err(|error| error.to_string())?;

  let mut child = Some(child);
  let mut success = false;
  let mut cancelled = false;
  let mut last_error_line: Option<String> = None;
  let mut auth_error_detected = false;

  while let Some(event) = rx.recv().await {
    if is_job_cancelled(state, job_id).await? {
      if let Some(process) = child.take() {
        if let Err(err) = process.kill() {
          error!("failed to kill process after cancellation: {err}");
        }
      }
      cancelled = true;
      break;
    }

    match event {
      CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
        let line = String::from_utf8_lossy(&bytes).to_string();
        if is_auth_error_line(&line) {
          auth_error_detected = true;
        }
        if let Some(error_line) = extract_error_line(&line) {
          last_error_line = Some(error_line);
        }
        if let Some(output_path) = extract_output_path_line(&line) {
          let snapshot = {
            let mut jobs = state.jobs.lock().await;
            if let Some(job) = jobs.get_mut(&job_id) {
              let filename = Path::new(&output_path)
                .file_name()
                .map(|value| value.to_string_lossy().to_string());
              let changed = job.output_path.as_deref() != Some(output_path.as_str())
                || job.filename != filename;
              if changed {
                job.output_path = Some(output_path);
                job.filename = filename;
                Some(job.clone())
              } else {
                None
              }
            } else {
              None
            }
          };
          if let Some(job) = snapshot {
            let _ = app.emit(EVENT_QUEUE_UPDATED, &job);
          }
        }
        if let Some(progress) = parse_progress_line(&line) {
          let snapshot = {
            let mut jobs = state.jobs.lock().await;
            if let Some(job) = jobs.get_mut(&job_id) {
              job.progress = progress.percent;
              job.speed = progress.speed.clone();
              job.eta = progress.eta.clone();
              Some(job.clone())
            } else {
              None
            }
          };
          if let Some(job) = snapshot {
            let _ = app.emit(EVENT_DOWNLOAD_PROGRESS, &job);
          }
        }
      }
      CommandEvent::Terminated(payload) => {
        success = payload.code == Some(0);
      }
      _ => {}
    }
  }

  if !success && !cancelled {
    if let Some(process) = child.take() {
      if let Err(err) = process.kill() {
        error!("failed to kill process: {err}");
      }
    }
  }

  Ok(AttemptResult {
    success,
    cancelled,
    last_error_line,
    auth_error_detected,
  })
}

fn should_retry_with_browser_cookies(attempt: &AttemptResult) -> bool {
  !attempt.success && !attempt.cancelled && attempt.auth_error_detected
}

async fn mark_job_failed(
  app: &AppHandle,
  state: &AppState,
  job_id: uuid::Uuid,
  message: String,
) -> Result<(), String> {
  let failed = {
    let mut jobs = state.jobs.lock().await;
    let job = jobs.get_mut(&job_id).ok_or_else(|| "job not found".to_string())?;
    job.status = DownloadStatus::Error;
    job.error = Some(message);
    job.completed_at = Some(Utc::now().to_rfc3339());
    job.clone()
  };
  let _ = app.emit(EVENT_DOWNLOAD_ERROR, &failed);
  Ok(())
}

fn extract_error_line(line: &str) -> Option<String> {
  let message = line.trim();
  if message.is_empty() {
    return None;
  }

  let lower = message.to_ascii_lowercase();
  if lower.contains("error:")
    || lower.contains("permission denied")
    || lower.contains("access is denied")
    || lower.contains("operation not permitted")
    || lower.contains("unable to open for writing")
  {
    return Some(message.to_string());
  }

  None
}

fn extract_output_path_line(line: &str) -> Option<String> {
  let message = line.trim();
  if message.is_empty() {
    return None;
  }

  if let Some(path) = message.split_once("Destination:").map(|(_, value)| value.trim()) {
    return normalize_output_path(path);
  }

  if let Some(path) = message
    .split_once("Merging formats into")
    .map(|(_, value)| value.trim())
  {
    return normalize_output_path(path);
  }

  if let Some((prefix, _)) = message.split_once(" has already been downloaded") {
    let path = prefix
      .strip_prefix("[download]")
      .map(str::trim)
      .unwrap_or(prefix.trim());
    return normalize_output_path(path);
  }

  None
}

fn normalize_output_path(raw: &str) -> Option<String> {
  let trimmed = raw.trim().trim_matches('"').trim_matches('\'');
  if trimmed.is_empty() {
    return None;
  }
  Some(trimmed.to_string())
}

fn is_auth_error_line(line: &str) -> bool {
  let message = line.to_ascii_lowercase();
  let patterns = [
    "login required",
    "sign in to confirm your age",
    "use --cookies-from-browser",
    "cookies are required",
    "this video is private",
    "members-only content",
    "confirm you're not a bot",
    "captcha",
    "authentication required",
  ];
  patterns.iter().any(|pattern| message.contains(pattern))
}

fn build_download_args(
  url: &str,
  format: &DownloadFormat,
  quality: Option<&str>,
  subtitle_lang: Option<&str>,
  subtitle_source: Option<&SubtitleSource>,
) -> Vec<String> {
  let mut args = vec![url.to_string()];
  match format {
    DownloadFormat::Mp4 => {
      let height = match quality.unwrap_or("best") {
        "360p" => "360",
        "720p" => "720",
        "1080p" => "1080",
        "4k" => "2160",
        _ => "9999",
      };
      args.extend([
        "-f".to_string(),
        format!("bestvideo[height<={height}]+bestaudio"),
        "--merge-output-format".to_string(),
        "mp4".to_string(),
      ]);
    }
    DownloadFormat::Mp3 => {
      args.extend([
        "-x".to_string(),
        "--audio-format".to_string(),
        "mp3".to_string(),
        "--audio-quality".to_string(),
        "0".to_string(),
      ]);
    }
    DownloadFormat::Srt | DownloadFormat::Vtt => {
      let lang = subtitle_lang.unwrap_or("en");
      let sub_ext = if matches!(format, DownloadFormat::Srt) { "srt" } else { "vtt" };
      match subtitle_source.unwrap_or(&SubtitleSource::Manual) {
        SubtitleSource::Manual => args.extend(["--write-subs".to_string(), "--no-write-auto-subs".to_string()]),
        SubtitleSource::Auto => args.extend(["--write-auto-subs".to_string(), "--no-write-subs".to_string()]),
      }
      args.extend([
        "--sub-langs".to_string(),
        lang.to_string(),
        "--skip-download".to_string(),
        "--convert-subs".to_string(),
        sub_ext.to_string(),
      ])
    }
  }
  args
}

fn map_video_info(video_id: &str, payload: &Value) -> VideoInfo {
  VideoInfo {
    video_id: video_id.to_string(),
    title: payload
      .get("title")
      .and_then(Value::as_str)
      .unwrap_or("Unknown title")
      .to_string(),
    duration_seconds: payload.get("duration").and_then(Value::as_f64),
    thumbnail_url: payload
      .get("thumbnail")
      .and_then(Value::as_str)
      .map(ToString::to_string),
    subtitle_tracks: parse_subtitle_tracks(payload),
  }
}

fn parse_subtitle_tracks(payload: &Value) -> Vec<SubtitleTrack> {
  let mut tracks = Vec::new();
  collect_subtitle_tracks(payload, "subtitles", SubtitleSource::Manual, &mut tracks);
  collect_subtitle_tracks(payload, "automatic_captions", SubtitleSource::Auto, &mut tracks);
  tracks.sort_by(|left, right| {
    subtitle_source_order(&left.source)
      .cmp(&subtitle_source_order(&right.source))
      .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
      .then_with(|| left.lang.cmp(&right.lang))
  });
  tracks
}

fn collect_subtitle_tracks(payload: &Value, key: &str, source: SubtitleSource, tracks: &mut Vec<SubtitleTrack>) {
  let Some(language_map) = payload.get(key).and_then(Value::as_object) else {
    return;
  };

  for (lang, variants) in language_map {
    let base_name = variants
      .as_array()
      .and_then(|items| items.first())
      .and_then(Value::as_object)
      .and_then(|item| {
        item
          .get("name")
          .and_then(Value::as_str)
          .or_else(|| item.get("language").and_then(Value::as_str))
      })
      .unwrap_or(lang);

    let name = if matches!(source, SubtitleSource::Auto) {
      format!("{base_name} [Auto]")
    } else {
      base_name.to_string()
    };

    tracks.push(SubtitleTrack {
      lang: lang.to_string(),
      name,
      source: source.clone(),
    });
  }
}

fn subtitle_source_order(source: &SubtitleSource) -> u8 {
  match source {
    SubtitleSource::Manual => 0,
    SubtitleSource::Auto => 1,
  }
}

fn resolve_output_dir(raw: Option<&str>) -> Result<PathBuf, String> {
  resolve_output_dir_from(raw, default_download_dir(), current_home_dir())
}

fn resolve_output_dir_from(
  raw: Option<&str>,
  default_dir: Option<String>,
  home_dir: Option<String>,
) -> Result<PathBuf, String> {
  let value = match raw {
    Some(candidate) => {
      let trimmed = candidate.trim();
      if trimmed.is_empty() {
        return Err("Output directory cannot be empty.".to_string());
      }
      trimmed.to_string()
    }
    None => default_dir.ok_or_else(|| "Failed to determine output directory.".to_string())?,
  };

  let expanded = expand_tilde_path(&value, home_dir)?;
  let path = PathBuf::from(expanded);

  if !path.is_absolute() {
    return Err("Output directory must be an absolute path.".to_string());
  }

  Ok(path)
}

fn expand_tilde_path(value: &str, home_dir: Option<String>) -> Result<String, String> {
  if value == "~" {
    return home_dir.ok_or_else(|| "Home directory could not be resolved.".to_string());
  }

  if let Some(suffix) = value.strip_prefix("~/").or_else(|| value.strip_prefix("~\\")) {
    let home = home_dir.ok_or_else(|| "Home directory could not be resolved.".to_string())?;
    return Ok(PathBuf::from(home).join(suffix).to_string_lossy().to_string());
  }

  if value.starts_with('~') {
    return Err("Unsupported output directory. Use '~/' or an absolute path.".to_string());
  }

  Ok(value.to_string())
}

fn ensure_output_directory_writable(path: &Path) -> Result<(), String> {
  std::fs::create_dir_all(path).map_err(|error| {
    format!(
      "Cannot create output directory '{}': {}",
      path.display(),
      error
    )
  })?;

  let probe_path = path.join(format!(".grabbit-write-test-{}", uuid::Uuid::new_v4()));
  std::fs::write(&probe_path, b"grabbit").map_err(|error| {
    format!(
      "Output directory '{}' is not writable: {}",
      path.display(),
      error
    )
  })?;
  std::fs::remove_file(probe_path).map_err(|error| {
    format!(
      "Output directory '{}' is not writable: {}",
      path.display(),
      error
    )
  })?;

  Ok(())
}

fn default_download_dir() -> Option<String> {
  if cfg!(target_os = "windows") {
    return current_home_dir().map(|home| {
      PathBuf::from(home)
        .join("Downloads")
        .to_string_lossy()
        .to_string()
    });
  }

  current_home_dir().map(|home| {
    PathBuf::from(home)
      .join("Downloads")
      .to_string_lossy()
      .to_string()
  })
}

fn current_home_dir() -> Option<String> {
  if cfg!(target_os = "windows") {
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
      return Some(user_profile);
    }

    let home_drive = std::env::var("HOMEDRIVE").ok();
    let home_path = std::env::var("HOMEPATH").ok();
    if let (Some(drive), Some(path)) = (home_drive, home_path) {
      return Some(format!("{drive}{path}"));
    }

    return None;
  }

  std::env::var("HOME").ok()
}

fn yt_dlp_binary_name() -> &'static str {
  if cfg!(target_os = "windows") {
    "yt-dlp.exe"
  } else {
    "yt-dlp"
  }
}

async fn is_job_cancelled(state: &AppState, job_id: uuid::Uuid) -> Result<bool, String> {
  let jobs = state.jobs.lock().await;
  let job = jobs.get(&job_id).ok_or_else(|| "job not found".to_string())?;
  Ok(matches!(job.status, DownloadStatus::Cancelled))
}

#[cfg(test)]
mod tests {
  use super::{
    AttemptResult, build_download_args, expand_tilde_path, extract_output_path_line,
    is_auth_error_line, map_video_info, parse_subtitle_tracks, resolve_output_dir_from,
    should_retry_with_browser_cookies,
  };
  use crate::models::{DownloadFormat, SubtitleSource};
  use serde_json::json;

  #[test]
  fn parse_subtitle_tracks_collects_manual_and_auto_sorted() {
    let payload = json!({
      "subtitles": {
        "en": [{ "name": "English" }],
        "es": [{ "language": "Spanish" }]
      },
      "automatic_captions": {
        "en": [{ "name": "English" }],
        "de": [{}]
      }
    });

    let tracks = parse_subtitle_tracks(&payload);
    assert_eq!(tracks.len(), 4);

    assert_eq!(tracks[0].lang, "en");
    assert_eq!(tracks[0].name, "English");
    assert!(matches!(tracks[0].source, SubtitleSource::Manual));

    assert_eq!(tracks[1].lang, "es");
    assert_eq!(tracks[1].name, "Spanish");
    assert!(matches!(tracks[1].source, SubtitleSource::Manual));

    assert_eq!(tracks[2].lang, "de");
    assert_eq!(tracks[2].name, "de [Auto]");
    assert!(matches!(tracks[2].source, SubtitleSource::Auto));

    assert_eq!(tracks[3].lang, "en");
    assert_eq!(tracks[3].name, "English [Auto]");
    assert!(matches!(tracks[3].source, SubtitleSource::Auto));
  }

  #[test]
  fn map_video_info_extracts_core_fields() {
    let payload = json!({
      "title": "Demo Title",
      "duration": 12.5,
      "thumbnail": "https://example.com/thumb.jpg",
      "subtitles": {
        "en": [{ "name": "English" }]
      }
    });

    let info = map_video_info("abc123", &payload);
    assert_eq!(info.video_id, "abc123");
    assert_eq!(info.title, "Demo Title");
    assert_eq!(info.duration_seconds, Some(12.5));
    assert_eq!(info.thumbnail_url.as_deref(), Some("https://example.com/thumb.jpg"));
    assert_eq!(info.subtitle_tracks.len(), 1);
  }

  #[test]
  fn build_download_args_uses_manual_subtitle_flags() {
    let args = build_download_args(
      "https://example.com/video",
      &DownloadFormat::Srt,
      None,
      Some("en"),
      Some(&SubtitleSource::Manual),
    );

    assert!(args.contains(&"--write-subs".to_string()));
    assert!(args.contains(&"--no-write-auto-subs".to_string()));
    assert!(!args.contains(&"--write-auto-subs".to_string()));
    assert!(args.contains(&"en".to_string()));
  }

  #[test]
  fn build_download_args_uses_auto_subtitle_flags() {
    let args = build_download_args(
      "https://example.com/video",
      &DownloadFormat::Vtt,
      None,
      Some("en"),
      Some(&SubtitleSource::Auto),
    );

    assert!(args.contains(&"--write-auto-subs".to_string()));
    assert!(args.contains(&"--no-write-subs".to_string()));
    assert!(!args.contains(&"--write-subs".to_string()));
    assert!(args.contains(&"vtt".to_string()));
  }

  #[test]
  fn expand_tilde_path_expands_user_home() {
    let value = expand_tilde_path("~/Downloads", Some("/Users/demo".to_string())).unwrap();
    assert_eq!(value, "/Users/demo/Downloads");
  }

  #[test]
  fn resolve_output_dir_from_uses_default_when_missing() {
    let path = resolve_output_dir_from(
      None,
      Some("/Users/demo/Downloads".to_string()),
      Some("/Users/demo".to_string()),
    )
    .unwrap();
    assert_eq!(path.to_string_lossy(), "/Users/demo/Downloads");
  }

  #[test]
  fn resolve_output_dir_from_rejects_empty_input() {
    let result = resolve_output_dir_from(
      Some("   "),
      Some("/Users/demo/Downloads".to_string()),
      Some("/Users/demo".to_string()),
    );

    assert!(result.is_err());
  }

  #[test]
  fn resolve_output_dir_from_rejects_unsupported_tilde_user_syntax() {
    let result = resolve_output_dir_from(
      Some("~another/Downloads"),
      Some("/Users/demo/Downloads".to_string()),
      Some("/Users/demo".to_string()),
    );

    assert!(result.is_err());
  }

  #[test]
  fn resolve_output_dir_from_rejects_relative_path() {
    let result = resolve_output_dir_from(
      Some("downloads"),
      Some("/Users/demo/Downloads".to_string()),
      Some("/Users/demo".to_string()),
    );

    assert!(result.is_err());
  }

  #[test]
  fn is_auth_error_line_detects_login_required_messages() {
    assert!(is_auth_error_line("ERROR: Sign in to confirm your age"));
    assert!(is_auth_error_line("ERROR: Use --cookies-from-browser or --cookies for the authentication"));
    assert!(is_auth_error_line("Please confirm you're not a bot"));
  }

  #[test]
  fn is_auth_error_line_ignores_non_auth_errors() {
    assert!(!is_auth_error_line("ERROR: Unable to write to file"));
    assert!(!is_auth_error_line("ERROR: HTTP Error 500: Internal Server Error"));
  }

  #[test]
  fn should_retry_with_browser_cookies_only_on_auth_failures() {
    let attempt = AttemptResult {
      success: false,
      cancelled: false,
      last_error_line: Some("error".to_string()),
      auth_error_detected: true,
    };
    assert!(should_retry_with_browser_cookies(&attempt));

    let non_auth = AttemptResult {
      success: false,
      cancelled: false,
      last_error_line: Some("error".to_string()),
      auth_error_detected: false,
    };
    assert!(!should_retry_with_browser_cookies(&non_auth));

    let succeeded = AttemptResult {
      success: true,
      cancelled: false,
      last_error_line: None,
      auth_error_detected: true,
    };
    assert!(!should_retry_with_browser_cookies(&succeeded));
  }

  #[test]
  fn extract_output_path_line_reads_destination_and_merger_messages() {
    assert_eq!(
      extract_output_path_line("[download] Destination: /tmp/demo.mp4"),
      Some("/tmp/demo.mp4".to_string())
    );
    assert_eq!(
      extract_output_path_line("[Merger] Merging formats into \"/tmp/demo.mp4\""),
      Some("/tmp/demo.mp4".to_string())
    );
    assert_eq!(
      extract_output_path_line("[download] /tmp/demo.mp4 has already been downloaded"),
      Some("/tmp/demo.mp4".to_string())
    );
  }
}
