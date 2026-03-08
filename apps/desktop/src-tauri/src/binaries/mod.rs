use crate::state::{EngineState, AppState};
use std::{
  fs,
  path::{Path, PathBuf},
  process::Command,
};
use tauri::{AppHandle, Manager};

const YTDLP_LATEST_WINDOWS: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
const YTDLP_LATEST_UNIX: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";
const FFMPEG_MACOS_ZIP: &str = "https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip";
const FFMPEG_WINDOWS_ZIP: &str = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
const FFMPEG_LINUX_AMD64_TAR_XZ: &str = "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz";
const FFMPEG_LINUX_I686_TAR_XZ: &str = "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-i686-static.tar.xz";

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

  if let Ok(data_dir) = app.path().app_data_dir() {
    let app_data_path = data_dir.join("binaries").join(name);
    if app_data_path.exists() {
      return Ok(app_data_path);
    }
  }

  Err(format!(
    "binary not found: {} or {}",
    direct_path.display(),
    suffixed_path.display()
  ))
}

pub async fn ensure_engine_binaries_ready(app: AppHandle, state: AppState) {
  {
    let mut engine_status = state.engine_status.lock().await;
    engine_status.state = EngineState::Repairing;
    engine_status.message = Some("Preparing download engine".to_string());
  }

  if has_required_binaries(&app) {
    let mut engine_status = state.engine_status.lock().await;
    engine_status.state = EngineState::Ready;
    engine_status.message = None;
    return;
  }

  let repair_result = repair_missing_binaries(&app).await;
  let mut engine_status = state.engine_status.lock().await;
  match repair_result {
    Ok(()) => {
      engine_status.state = EngineState::Ready;
      engine_status.message = None;
    }
    Err(error) => {
      engine_status.state = EngineState::Unavailable;
      engine_status.message = Some(format!("Automatic repair failed: {error}"));
    }
  }
}

fn has_required_binaries(app: &AppHandle) -> bool {
  resolve_binary_path(app, yt_dlp_binary_name()).is_ok()
    && resolve_binary_path(app, ffmpeg_binary_name()).is_ok()
}

async fn repair_missing_binaries(app: &AppHandle) -> Result<(), String> {
  let target_dir = app
    .path()
    .app_data_dir()
    .map_err(|error| format!("failed to read app data dir: {error}"))?
    .join("binaries");
  fs::create_dir_all(&target_dir).map_err(|error| format!("failed to create binaries dir: {error}"))?;

  repair_ytdlp(&target_dir).await?;
  repair_ffmpeg(&target_dir).await?;
  Ok(())
}

async fn repair_ytdlp(target_dir: &Path) -> Result<(), String> {
  let url = if cfg!(target_os = "windows") {
    YTDLP_LATEST_WINDOWS
  } else {
    YTDLP_LATEST_UNIX
  };
  let destination = target_dir.join(yt_dlp_binary_name());
  download_to_path(url, &destination).await?;
  set_executable_if_needed(&destination)?;
  Ok(())
}

async fn repair_ffmpeg(target_dir: &Path) -> Result<(), String> {
  let archive_name = if cfg!(target_os = "linux") {
    "grabbit-ffmpeg.tar.xz"
  } else {
    "grabbit-ffmpeg.zip"
  };
  let archive_path = std::env::temp_dir().join(archive_name);
  let extract_dir = std::env::temp_dir().join(format!("grabbit-ffmpeg-extract-{}", uuid::Uuid::new_v4()));
  fs::create_dir_all(&extract_dir).map_err(|error| format!("failed to create temp extract dir: {error}"))?;

  let url = if cfg!(target_os = "windows") {
    FFMPEG_WINDOWS_ZIP
  } else if cfg!(target_os = "macos") {
    FFMPEG_MACOS_ZIP
  } else if cfg!(target_arch = "x86_64") {
    FFMPEG_LINUX_AMD64_TAR_XZ
  } else {
    FFMPEG_LINUX_I686_TAR_XZ
  };

  download_to_path(url, &archive_path).await?;
  extract_archive(&archive_path, &extract_dir)?;

  let source = find_file_by_name(&extract_dir, ffmpeg_binary_name())
    .ok_or_else(|| "ffmpeg binary was not found in the downloaded archive".to_string())?;
  let destination = target_dir.join(ffmpeg_binary_name());
  fs::copy(&source, &destination).map_err(|error| format!("failed to install ffmpeg: {error}"))?;
  set_executable_if_needed(&destination)?;

  let _ = fs::remove_file(archive_path);
  let _ = fs::remove_dir_all(extract_dir);
  Ok(())
}

async fn download_to_path(url: &str, destination: &Path) -> Result<(), String> {
  let response = reqwest::get(url)
    .await
    .map_err(|error| format!("failed to download {url}: {error}"))?;
  if !response.status().is_success() {
    return Err(format!("download failed for {url}: {}", response.status()));
  }

  let bytes = response
    .bytes()
    .await
    .map_err(|error| format!("failed reading download body for {url}: {error}"))?;
  fs::write(destination, bytes).map_err(|error| format!("failed to write '{}': {error}", destination.display()))
}

fn extract_archive(archive_path: &Path, extract_dir: &Path) -> Result<(), String> {
  let status = if cfg!(target_os = "windows") {
    Command::new("powershell")
      .args([
        "-NoProfile",
        "-Command",
        &format!(
          "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
          archive_path.display(),
          extract_dir.display()
        ),
      ])
      .status()
  } else if cfg!(target_os = "macos") {
    Command::new("unzip")
      .args(["-o", &archive_path.to_string_lossy(), "-d", &extract_dir.to_string_lossy()])
      .status()
  } else {
    Command::new("tar")
      .args(["-xJf", &archive_path.to_string_lossy(), "-C", &extract_dir.to_string_lossy()])
      .status()
  }
  .map_err(|error| format!("failed to extract ffmpeg archive: {error}"))?;

  if !status.success() {
    return Err("failed to extract ffmpeg archive".to_string());
  }

  Ok(())
}

fn find_file_by_name(root: &Path, expected: &str) -> Option<PathBuf> {
  let entries = fs::read_dir(root).ok()?;
  for entry in entries.flatten() {
    let path = entry.path();
    if path.is_file() {
      if path
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case(expected))
      {
        return Some(path);
      }
      continue;
    }
    if path.is_dir() {
      if let Some(found) = find_file_by_name(&path, expected) {
        return Some(found);
      }
    }
  }
  None
}

fn set_executable_if_needed(path: &Path) -> Result<(), String> {
  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    let mut permissions = fs::metadata(path)
      .map_err(|error| format!("failed to inspect '{}': {error}", path.display()))?
      .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions)
      .map_err(|error| format!("failed to set executable bit on '{}': {error}", path.display()))?;
  }
  Ok(())
}

fn yt_dlp_binary_name() -> &'static str {
  if cfg!(target_os = "windows") {
    "yt-dlp.exe"
  } else {
    "yt-dlp"
  }
}

fn ffmpeg_binary_name() -> &'static str {
  if cfg!(target_os = "windows") {
    "ffmpeg.exe"
  } else {
    "ffmpeg"
  }
}
