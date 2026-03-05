use crate::models::DownloadJob;
use std::{collections::{HashMap, VecDeque}, sync::Arc};
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Clone)]
pub struct AppState {
  pub jobs: Arc<Mutex<HashMap<Uuid, DownloadJob>>>,
  pub order: Arc<Mutex<VecDeque<Uuid>>>,
  pub active_job: Arc<Mutex<Option<Uuid>>>,
}

impl AppState {
  pub fn new() -> Self {
    Self {
      jobs: Arc::new(Mutex::new(HashMap::new())),
      order: Arc::new(Mutex::new(VecDeque::new())),
      active_job: Arc::new(Mutex::new(None)),
    }
  }
}
