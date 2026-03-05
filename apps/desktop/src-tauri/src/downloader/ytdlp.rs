use crate::{
  binaries::resolve_binary_path,
  constants::{EVENT_DOWNLOAD_COMPLETE, EVENT_DOWNLOAD_ERROR, EVENT_DOWNLOAD_PROGRESS},
  downloader::progress::parse_progress_line,
  models::{DownloadFormat, DownloadStatus},
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
    if let Err(err) = run_download_job(app_clone.clone(), state_clone.clone(), job_id).await {
      error!("download failed: {err}");
    }
    let mut active = state_clone.active_job.lock().await;
    *active = None;
    drop(active);
    let _ = enqueue_download(app_clone, state_clone).await;
  });

  Ok(())
}

pub async fn get_video_info(app: &AppHandle, video_id: &str) -> Result<Value, String> {
  let ytdlp = resolve_binary_path(app, yt_dlp_binary_name()).map_err(DownloaderError::Resource)?;
  let target = format!("https://www.youtube.com/watch?v={video_id}");
  let output = app
    .shell()
    .command(ytdlp.to_string_lossy().to_string())
    .args(["--dump-json", "--skip-download", &target])
    .output()
    .await
    .map_err(|error| DownloaderError::Process(error.to_string()))?;

  if output.code != 0 {
    return Err(DownloaderError::Process(String::from_utf8_lossy(&output.stderr).to_string()).into());
  }

  let mut payload: Value = serde_json::from_slice(&output.stdout)
    .map_err(|error| DownloaderError::Serialization(error.to_string()))?;
  if let Some(object) = payload.as_object_mut() {
    object.insert("videoId".to_string(), Value::String(video_id.to_string()));
  }
  Ok(payload)
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

  let mut success = false;
  let mut cancelled = false;
  while let Some(event) = rx.recv().await {
    if is_job_cancelled(&state, job_id).await? {
      if let Err(err) = child.kill() {
        error!("failed to kill process after cancellation: {err}");
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
    if let Err(err) = child.kill() {
      error!("failed to kill process: {err}");
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
      args.extend([
        "--write-subs".to_string(),
        "--write-auto-subs".to_string(),
        "--sub-langs".to_string(),
        lang.to_string(),
        "--skip-download".to_string(),
        "--convert-subs".to_string(),
        sub_ext.to_string(),
      ]);
    }
  }
  args
}

fn default_download_dir() -> Option<String> {
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
