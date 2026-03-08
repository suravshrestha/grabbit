mod binaries;
mod commands;
mod constants;
mod downloader;
mod models;
mod server;
mod state;

use crate::{commands::{cancel_job, download_video, get_queue}, server::http::start_http_server, state::AppState};
use tauri::Manager;
use tracing::error;

pub fn run() {
  tracing_subscriber::fmt().with_target(false).init();

  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_notification::init())
    .setup(|app| {
      let state = AppState::new();
      app.manage(state.clone());

      let app_handle = app.handle().clone();
      let state_for_server = state.clone();
      tauri::async_runtime::spawn(async move {
        if let Err(error) = start_http_server(app_handle, state_for_server).await {
          error!("http server failed: {error}");
        }
      });

      let repair_app = app.handle().clone();
      let repair_state = state.clone();
      tauri::async_runtime::spawn(async move {
        crate::binaries::ensure_engine_binaries_ready(repair_app, repair_state).await;
      });

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![download_video, get_queue, cancel_job])
    .run(tauri::generate_context!())
    .unwrap_or_else(|error| {
      error!("tauri runtime failed: {error}");
    });
}
