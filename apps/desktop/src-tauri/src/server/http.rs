use crate::{
  constants::{APP_VERSION, EVENT_QUEUE_UPDATED, SERVER_HOST, SERVER_PORT},
  downloader::ytdlp::{enqueue_download, fetch_subtitle_text, get_video_info},
  models::{DownloadFormat, DownloadJob, DownloadRequest, DownloadStatus, SubtitleSource},
  state::{AppState, EngineState},
};
use axum::{
  extract::{ConnectInfo, Path, Query, State},
  http::{Method, StatusCode},
  response::IntoResponse,
  routing::{delete, get, post},
  Json, Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{
  collections::HashMap,
  net::SocketAddr,
  path::{Path as FsPath, PathBuf},
  process::Command,
};
use tauri::{AppHandle, Emitter};
use tower_http::cors::{AllowOrigin, CorsLayer};
use uuid::Uuid;

#[derive(Clone)]
struct HttpContext {
  app: AppHandle,
  state: AppState,
}

#[derive(Serialize)]
struct HealthResponse {
  status: &'static str,
  version: &'static str,
  #[serde(rename = "engineState")]
  engine_state: &'static str,
  message: Option<String>,
}

#[derive(Serialize)]
struct DownloadResponse {
  #[serde(rename = "jobId")]
  job_id: String,
}

#[derive(Serialize)]
struct ActionResponse {
  status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CopySubtitleResponse {
  text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CopySubtitleRequest {
  video_id: String,
  url: String,
  format: DownloadFormat,
  subtitle_lang: String,
  subtitle_source: SubtitleSource,
}

#[derive(Deserialize)]
struct InfoQuery {
  #[serde(rename = "videoId")]
  video_id: String,
}

fn validate_localhost(addr: SocketAddr) -> Result<(), (StatusCode, String)> {
  if addr.ip().is_loopback() {
    Ok(())
  } else {
    Err((StatusCode::FORBIDDEN, "Only localhost clients are allowed".to_string()))
  }
}

pub async fn start_http_server(app: AppHandle, state: AppState) -> Result<(), String> {
  let context = HttpContext { app, state };

  let cors = CorsLayer::new()
    .allow_methods([Method::GET, Method::POST, Method::DELETE])
    .allow_headers(tower_http::cors::Any)
    .allow_origin(AllowOrigin::predicate(|origin, _| {
      if let Ok(value) = origin.to_str() {
        return value.starts_with("http://localhost:") || value.starts_with("chrome-extension://");
      }
      false
    }));

  let app = Router::new()
    .route("/api/health", get(health))
    .route("/api/info", get(info))
    .route("/api/download", post(download))
    .route("/api/subtitles/copy", post(copy_subtitle))
    .route("/api/queue", get(queue))
    .route("/api/status/:job_id", get(status))
    .route("/api/jobs/:job_id/open-file", post(open_file))
    .route("/api/jobs/:job_id/open-folder", post(open_folder))
    .route("/api/jobs/:job_id", delete(cancel))
    .layer(cors)
    .with_state(context);

  let addr = format!("{SERVER_HOST}:{SERVER_PORT}")
    .parse::<SocketAddr>()
    .map_err(|error| format!("invalid bind address {SERVER_HOST}:{SERVER_PORT}: {error}"))?;
  let listener = tokio::net::TcpListener::bind(addr)
    .await
    .map_err(|error| error.to_string())?;
  axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
    .await
    .map_err(|error| error.to_string())
}

async fn health(
  State(context): State<HttpContext>,
  ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Result<Json<HealthResponse>, (StatusCode, String)> {
  validate_localhost(addr)?;
  let (engine_state, message) = {
    let value = context.state.engine_status.lock().await;
    let state = match value.state {
      EngineState::Ready => "ready",
      EngineState::Repairing => "repairing",
      EngineState::Unavailable => "unavailable",
    };
    (state, value.message.clone())
  };
  Ok(Json(HealthResponse {
    status: "ok",
    version: APP_VERSION,
    engine_state,
    message,
  }))
}

async fn info(
  State(context): State<HttpContext>,
  ConnectInfo(addr): ConnectInfo<SocketAddr>,
  Query(query): Query<InfoQuery>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
  validate_localhost(addr)?;
  let value = get_video_info(&context.app, &query.video_id)
    .await
    .map_err(|error| (StatusCode::BAD_REQUEST, error))?;
  Ok(Json(value))
}

async fn download(
  State(context): State<HttpContext>,
  ConnectInfo(addr): ConnectInfo<SocketAddr>,
  Json(payload): Json<DownloadRequest>,
) -> Result<Json<DownloadResponse>, (StatusCode, String)> {
  validate_localhost(addr)?;
  let job = DownloadJob {
    id: Uuid::new_v4(),
    request: payload,
    status: DownloadStatus::Queued,
    progress: 0.0,
    speed: None,
    eta: None,
    filename: None,
    output_path: None,
    output_dir_resolved: None,
    error: None,
    created_at: Utc::now().to_rfc3339(),
    completed_at: None,
  };

  {
    let mut jobs = context.state.jobs.lock().await;
    jobs.insert(job.id, job.clone());
  }

  {
    let mut order = context.state.order.lock().await;
    order.push_back(job.id);
  }

  let _ = context.app.emit(EVENT_QUEUE_UPDATED, &job);
  enqueue_download(context.app.clone(), context.state.clone())
    .await
    .map_err(|error| (StatusCode::BAD_REQUEST, error))?;

  Ok(Json(DownloadResponse {
    job_id: job.id.to_string(),
  }))
}

async fn status(
  State(context): State<HttpContext>,
  ConnectInfo(addr): ConnectInfo<SocketAddr>,
  Path(job_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
  validate_localhost(addr)?;
  let id = uuid::Uuid::parse_str(&job_id).map_err(|error| (StatusCode::BAD_REQUEST, error.to_string()))?;
  let job = {
    let jobs = context.state.jobs.lock().await;
    jobs
      .get(&id)
      .cloned()
      .ok_or((StatusCode::NOT_FOUND, "Job not found".to_string()))?
  };
  Ok(Json(job))
}

async fn queue(
  State(context): State<HttpContext>,
  ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Result<Json<Vec<DownloadJob>>, (StatusCode, String)> {
  validate_localhost(addr)?;
  let order = context.state.order.lock().await;
  let jobs = context.state.jobs.lock().await;
  let queue = order
    .iter()
    .filter_map(|id| jobs.get(id).cloned())
    .collect::<Vec<DownloadJob>>();
  Ok(Json(queue))
}

async fn copy_subtitle(
  State(context): State<HttpContext>,
  ConnectInfo(addr): ConnectInfo<SocketAddr>,
  Json(payload): Json<CopySubtitleRequest>,
) -> Result<Json<CopySubtitleResponse>, (StatusCode, String)> {
  validate_localhost(addr)?;

  if payload.video_id.trim().is_empty() {
    return Err((StatusCode::BAD_REQUEST, "videoId is required".to_string()));
  }
  if payload.url.trim().is_empty() {
    return Err((StatusCode::BAD_REQUEST, "url is required".to_string()));
  }
  if !matches!(payload.format, DownloadFormat::Srt | DownloadFormat::Vtt) {
    return Err((StatusCode::BAD_REQUEST, "format must be srt or vtt".to_string()));
  }
  if payload.subtitle_lang.trim().is_empty() {
    return Err((StatusCode::BAD_REQUEST, "subtitleLang is required".to_string()));
  }

  let text = fetch_subtitle_text(
    &context.app,
    &payload.url,
    &payload.format,
    Some(payload.subtitle_lang.as_str()),
    Some(&payload.subtitle_source),
  )
  .await
  .map_err(|error| (StatusCode::BAD_REQUEST, error))?;

  Ok(Json(CopySubtitleResponse { text }))
}

async fn cancel(
  State(context): State<HttpContext>,
  ConnectInfo(addr): ConnectInfo<SocketAddr>,
  Path(job_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
  validate_localhost(addr)?;
  let id = uuid::Uuid::parse_str(&job_id).map_err(|error| (StatusCode::BAD_REQUEST, error.to_string()))?;

  let cancelled = {
    let mut jobs = context.state.jobs.lock().await;
    if let Some(job) = jobs.get_mut(&id) {
      job.status = crate::models::DownloadStatus::Cancelled;
      job.completed_at = Some(chrono::Utc::now().to_rfc3339());
      Some(job.clone())
    } else {
      None
    }
  };
  if let Some(job) = cancelled {
    let _ = context.app.emit(EVENT_QUEUE_UPDATED, &job);
  }

  let body = HashMap::from([("status", "cancelled")]);
  Ok(Json(body))
}

async fn open_file(
  State(context): State<HttpContext>,
  ConnectInfo(addr): ConnectInfo<SocketAddr>,
  Path(job_id): Path<String>,
) -> Result<Json<ActionResponse>, (StatusCode, String)> {
  validate_localhost(addr)?;
  let id = Uuid::parse_str(&job_id).map_err(|error| (StatusCode::BAD_REQUEST, error.to_string()))?;
  let job = get_completed_job(&context, id).await?;

  let output_path = job
    .output_path
    .ok_or((StatusCode::BAD_REQUEST, "Downloaded file path is unavailable".to_string()))?;
  let path = PathBuf::from(output_path);
  if !path.exists() {
    return Err((StatusCode::NOT_FOUND, "Downloaded file was not found on disk".to_string()));
  }
  if !path.is_file() {
    return Err((StatusCode::BAD_REQUEST, "Resolved output path is not a file".to_string()));
  }

  open_path(&path)?;
  Ok(Json(ActionResponse { status: "ok" }))
}

async fn open_folder(
  State(context): State<HttpContext>,
  ConnectInfo(addr): ConnectInfo<SocketAddr>,
  Path(job_id): Path<String>,
) -> Result<Json<ActionResponse>, (StatusCode, String)> {
  validate_localhost(addr)?;
  let id = Uuid::parse_str(&job_id).map_err(|error| (StatusCode::BAD_REQUEST, error.to_string()))?;
  let job = get_completed_job(&context, id).await?;

  let path = if let Some(output_dir) = job.output_dir_resolved {
    PathBuf::from(output_dir)
  } else if let Some(output_path) = job.output_path {
    FsPath::new(&output_path)
      .parent()
      .map(FsPath::to_path_buf)
      .ok_or((StatusCode::BAD_REQUEST, "Could not determine output folder".to_string()))?
  } else {
    return Err((StatusCode::BAD_REQUEST, "Output folder is unavailable".to_string()));
  };

  if !path.exists() {
    return Err((StatusCode::NOT_FOUND, "Output folder was not found on disk".to_string()));
  }
  if !path.is_dir() {
    return Err((StatusCode::BAD_REQUEST, "Resolved output folder is not a directory".to_string()));
  }

  open_path(&path)?;
  Ok(Json(ActionResponse { status: "ok" }))
}

async fn get_completed_job(
  context: &HttpContext,
  id: Uuid,
) -> Result<DownloadJob, (StatusCode, String)> {
  let jobs = context.state.jobs.lock().await;
  let job = jobs
    .get(&id)
    .cloned()
    .ok_or((StatusCode::NOT_FOUND, "Job not found".to_string()))?;
  if !matches!(job.status, DownloadStatus::Complete) {
    return Err((StatusCode::BAD_REQUEST, "Job is not complete yet".to_string()));
  }
  Ok(job)
}

fn open_path(path: &FsPath) -> Result<(), (StatusCode, String)> {
  let platform = if cfg!(target_os = "windows") {
    Platform::Windows
  } else if cfg!(target_os = "macos") {
    Platform::Macos
  } else {
    Platform::Linux
  };

  let (program, args) = build_open_command(platform, path, path.is_dir());
  let status = Command::new(program)
    .args(args)
    .status()
  .map_err(|error| {
    (
      StatusCode::INTERNAL_SERVER_ERROR,
      format!("Failed to open path '{}': {error}", path.display()),
    )
  })?;

  if !status.success() {
    return Err((
      StatusCode::INTERNAL_SERVER_ERROR,
      format!("Open command failed for '{}'", path.display()),
    ));
  }

  Ok(())
}

#[derive(Clone, Copy)]
enum Platform {
  Windows,
  Macos,
  Linux,
}

fn build_open_command(platform: Platform, path: &FsPath, is_dir: bool) -> (&'static str, Vec<String>) {
  match platform {
    Platform::Windows => {
      // Never invoke cmd.exe with user-derived paths. This avoids shell metacharacter parsing.
      if is_dir {
        ("explorer.exe", vec![path.to_string_lossy().into_owned()])
      } else {
        (
          "rundll32.exe",
          vec![
            "url.dll,FileProtocolHandler".to_string(),
            path.to_string_lossy().into_owned(),
          ],
        )
      }
    }
    Platform::Macos => ("open", vec![path.to_string_lossy().into_owned()]),
    Platform::Linux => ("xdg-open", vec![path.to_string_lossy().into_owned()]),
  }
}

#[cfg(test)]
mod tests {
  use super::{build_open_command, Platform};
  use std::path::Path;

  #[test]
  fn windows_file_open_does_not_use_cmd_shell() {
    let path = Path::new(r"C:\Downloads\name&calc.mp4");
    let (program, args) = build_open_command(Platform::Windows, path, false);
    assert_eq!(program, "rundll32.exe");
    assert_eq!(args[0], "url.dll,FileProtocolHandler");
    assert_eq!(args[1], r"C:\Downloads\name&calc.mp4");
  }

  #[test]
  fn windows_folder_open_uses_explorer() {
    let path = Path::new(r"C:\Downloads");
    let (program, args) = build_open_command(Platform::Windows, path, true);
    assert_eq!(program, "explorer.exe");
    assert_eq!(args, vec![r"C:\Downloads".to_string()]);
  }
}
