use crate::{
  constants::{APP_VERSION, SERVER_HOST, SERVER_PORT},
  downloader::ytdlp::{enqueue_download, get_video_info},
  models::{DownloadJob, DownloadRequest, DownloadStatus},
  state::AppState,
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
use std::{collections::HashMap, net::SocketAddr};
use tauri::AppHandle;
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
}

#[derive(Serialize)]
struct DownloadResponse {
  #[serde(rename = "jobId")]
  job_id: String,
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
    .route("/api/status/:job_id", get(status))
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
  ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Result<Json<HealthResponse>, (StatusCode, String)> {
  validate_localhost(addr)?;
  Ok(Json(HealthResponse {
    status: "ok",
    version: APP_VERSION,
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

async fn cancel(
  State(context): State<HttpContext>,
  ConnectInfo(addr): ConnectInfo<SocketAddr>,
  Path(job_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
  validate_localhost(addr)?;
  let id = uuid::Uuid::parse_str(&job_id).map_err(|error| (StatusCode::BAD_REQUEST, error.to_string()))?;

  {
    let mut jobs = context.state.jobs.lock().await;
    if let Some(job) = jobs.get_mut(&id) {
      job.status = crate::models::DownloadStatus::Cancelled;
      job.completed_at = Some(chrono::Utc::now().to_rfc3339());
    }
  }

  let body = HashMap::from([("status", "cancelled")]);
  Ok(Json(body))
}
