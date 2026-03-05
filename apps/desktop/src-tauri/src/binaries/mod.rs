use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub fn resolve_binary_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
  let resource_dir = app
    .path()
    .resource_dir()
    .map_err(|error| format!("failed to read resource dir: {error}"))?;

  let path = resource_dir.join(name);
  if !path.exists() {
    return Err(format!("binary not found: {}", path.display()));
  }

  Ok(path)
}
