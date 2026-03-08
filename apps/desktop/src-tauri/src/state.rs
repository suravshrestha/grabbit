use crate::models::DownloadJob;
use std::{collections::{HashMap, VecDeque}, sync::Arc};
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Clone, Debug)]
pub enum EngineState {
  Ready,
  Repairing,
  Unavailable,
}

#[derive(Clone, Debug)]
pub struct EngineStatus {
  pub state: EngineState,
  pub message: Option<String>,
}

#[derive(Clone)]
pub struct AppState {
  pub jobs: Arc<Mutex<HashMap<Uuid, DownloadJob>>>,
  pub order: Arc<Mutex<VecDeque<Uuid>>>,
  pub active_job: Arc<Mutex<Option<Uuid>>>,
  pub engine_status: Arc<Mutex<EngineStatus>>,
}

impl AppState {
  pub fn new() -> Self {
    Self {
      jobs: Arc::new(Mutex::new(HashMap::new())),
      order: Arc::new(Mutex::new(VecDeque::new())),
      active_job: Arc::new(Mutex::new(None)),
      engine_status: Arc::new(Mutex::new(EngineStatus {
        state: EngineState::Unavailable,
        message: Some("Preparing download engine".to_string()),
      })),
    }
  }
}
