use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "lowercase")]
pub enum DownloadStatus {
  Queued,
  Downloading,
  Merging,
  Complete,
  Error,
  Cancelled,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "lowercase")]
pub enum DownloadFormat {
  Mp4,
  Mp3,
  Srt,
  Vtt,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
  pub video_id: String,
  pub url: String,
  pub format: DownloadFormat,
  pub quality: Option<String>,
  pub subtitle_lang: Option<String>,
  pub output_dir: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DownloadJob {
  pub id: Uuid,
  pub request: DownloadRequest,
  pub status: DownloadStatus,
  pub progress: f64,
  pub speed: Option<String>,
  pub eta: Option<String>,
  pub filename: Option<String>,
  pub error: Option<String>,
  pub created_at: String,
  pub completed_at: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct DesktopAppInfo {
  pub version: String,
  pub ytdlp_version: String,
  pub status: String,
}
