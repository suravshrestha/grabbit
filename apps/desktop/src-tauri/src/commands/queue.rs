use crate::{
  constants::EVENT_QUEUE_UPDATED,
  downloader::ytdlp::cleanup_cancelled_download_artifacts,
  state::AppState,
};
use tauri::{AppHandle, Emitter, State};
use tracing::warn;
use uuid::Uuid;

#[tauri::command]
pub async fn get_queue(state: State<'_, AppState>) -> Result<Vec<crate::models::DownloadJob>, String> {
  let order = state.order.lock().await;
  let jobs = state.jobs.lock().await;

  let list: Vec<crate::models::DownloadJob> = order
    .iter()
    .filter_map(|id| jobs.get(id))
    .cloned()
    .collect();

  Ok(list)
}

#[tauri::command]
pub async fn cancel_job(app: AppHandle, state: State<'_, AppState>, job_id: String) -> Result<(), String> {
  let id = Uuid::parse_str(&job_id).map_err(|error| error.to_string())?;
  let cancelled = {
    let mut jobs = state.jobs.lock().await;
    let job = jobs.get_mut(&id).ok_or("Job not found")?;
    job.status = crate::models::DownloadStatus::Cancelled;
    job.completed_at = Some(chrono::Utc::now().to_rfc3339());
    job.clone()
  };

  if let Err(err) = cleanup_cancelled_download_artifacts(state.inner(), id).await {
    warn!("failed to clean cancelled artifacts for job {id}: {err}");
  }

  let _ = app.emit(EVENT_QUEUE_UPDATED, &cancelled);
  Ok(())
}
