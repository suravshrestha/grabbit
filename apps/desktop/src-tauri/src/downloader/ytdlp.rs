use crate::{
  binaries::resolve_binary_path,
  constants::{EVENT_DOWNLOAD_COMPLETE, EVENT_DOWNLOAD_ERROR, EVENT_DOWNLOAD_PROGRESS},
  downloader::progress::parse_progress_line,
  models::{DownloadFormat, DownloadStatus, SubtitleSource, SubtitleTrack, VideoInfo},
  state::AppState,
};
use chrono::Utc;
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};
use thiserror::Error;
use tracing::error;

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
  let (request, output_template) = {
    let mut jobs = state.jobs.lock().await;
    let job = jobs.get_mut(&job_id).ok_or_else(|| "job not found".to_string())?;
    job.status = DownloadStatus::Downloading;
    let dir = job
      .request
      .output_dir
      .clone()
      .or_else(default_download_dir)
      .unwrap_or_else(|| "~/Downloads".to_string());
    let template = format!("{dir}/%(title)s.%(ext)s");
    (job.request.clone(), template)
  };

  let ytdlp = resolve_binary_path(&app, yt_dlp_binary_name()).map_err(DownloaderError::Resource)?;
  let mut args = build_download_args(
    &request.url,
    &request.format,
    request.quality.as_deref(),
    request.subtitle_lang.as_deref(),
    request.subtitle_source.as_ref(),
  );
  args.extend([
    "--cookies-from-browser".to_string(),
    "chrome".to_string(),
    "-o".to_string(),
    output_template,
    "--newline".to_string(),
  ]);

  let (mut rx, child) = app
    .shell()
    .command(ytdlp.to_string_lossy().to_string())
    .args(args)
    .spawn()
    .map_err(|error| DownloaderError::Process(error.to_string()))?;

  let mut child = Some(child);
  let mut success = false;
  let mut cancelled = false;
  while let Some(event) = rx.recv().await {
    if is_job_cancelled(&state, job_id).await? {
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

  if cancelled || is_job_cancelled(&state, job_id).await? {
    return Ok(());
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
    let failed = {
      let mut jobs = state.jobs.lock().await;
      let job = jobs.get_mut(&job_id).ok_or_else(|| "job not found".to_string())?;
      job.status = DownloadStatus::Error;
      job.error = Some("yt-dlp failed".to_string());
      job.completed_at = Some(Utc::now().to_rfc3339());
      job.clone()
    };
    let _ = app.emit(EVENT_DOWNLOAD_ERROR, &failed);
  }

  Ok(())
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

fn default_download_dir() -> Option<String> {
  if cfg!(target_os = "windows") {
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
      return Some(format!("{user_profile}\\Downloads"));
    }

    let home_drive = std::env::var("HOMEDRIVE").ok();
    let home_path = std::env::var("HOMEPATH").ok();
    if let (Some(drive), Some(path)) = (home_drive, home_path) {
      return Some(format!("{drive}{path}\\Downloads"));
    }

    return None;
  }

  std::env::var("HOME").ok().map(|home| format!("{home}/Downloads"))
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
  use super::{build_download_args, map_video_info, parse_subtitle_tracks};
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
}
