use crate::{
  downloader::ytdlp::enqueue_download,
  models::{DownloadJob, DownloadRequest, DownloadStatus},
  state::AppState,
};
use chrono::Utc;
use tauri::{AppHandle, State};
use uuid::Uuid;

#[tauri::command]
pub async fn download_video(
  app: AppHandle,
  state: State<'_, AppState>,
  request: DownloadRequest,
) -> Result<DownloadJob, String> {
  let job = DownloadJob {
    id: Uuid::new_v4(),
    request,
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
    let mut jobs = state.jobs.lock().await;
    jobs.insert(job.id, job.clone());
  }

  {
    let mut order = state.order.lock().await;
    order.push_back(job.id);
  }

  enqueue_download(app, state.inner().clone()).await?;
  Ok(job)
}
