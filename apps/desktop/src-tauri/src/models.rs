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
#[serde(rename_all = "lowercase")]
pub enum SubtitleSource {
  Manual,
  Auto,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
  pub video_id: String,
  pub url: String,
  pub format: DownloadFormat,
  pub quality: Option<String>,
  pub subtitle_lang: Option<String>,
  pub subtitle_source: Option<SubtitleSource>,
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
  pub output_path: Option<String>,
  pub output_dir_resolved: Option<String>,
  pub error: Option<String>,
  pub created_at: String,
  pub completed_at: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleTrack {
  pub lang: String,
  pub name: String,
  pub source: SubtitleSource,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
  pub video_id: String,
  pub title: String,
  pub duration_seconds: Option<f64>,
  pub thumbnail_url: Option<String>,
  pub subtitle_tracks: Vec<SubtitleTrack>,
}
