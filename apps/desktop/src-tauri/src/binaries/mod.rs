use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn target_suffixed_name(name: &str) -> String {
  const TARGET_TRIPLE: &str = env!("TAURI_ENV_TARGET_TRIPLE");
  if let Some(stem) = name.strip_suffix(".exe") {
    return format!("{stem}-{TARGET_TRIPLE}.exe");
  }
  format!("{name}-{TARGET_TRIPLE}")
}

pub fn resolve_binary_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
  let resource_dir = app
    .path()
    .resource_dir()
    .map_err(|error| format!("failed to read resource dir: {error}"))?;

  let direct_path = resource_dir.join(name);
  if direct_path.exists() {
    return Ok(direct_path);
  }

  let suffixed_path = resource_dir.join(target_suffixed_name(name));
  if suffixed_path.exists() {
    return Ok(suffixed_path);
  }

  Err(format!(
    "binary not found: {} or {}",
    direct_path.display(),
    suffixed_path.display()
  ))
}
