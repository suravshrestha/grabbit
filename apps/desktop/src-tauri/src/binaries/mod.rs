use crate::state::{EngineState, AppState};
use sha2::{Digest, Sha256};
use std::{
  fs,
  path::{Path, PathBuf},
  process::Command,
};
use tauri::{AppHandle, Manager};

const YTDLP_WINDOWS_URL: &str =
  "https://github.com/yt-dlp/yt-dlp/releases/download/2026.03.03/yt-dlp.exe";
const YTDLP_WINDOWS_SHA256: &str =
  "554e868ca1df425d4fe90c224980f0862fe20e28dced6256461f16752d7a1218";
const YTDLP_UNIX_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/download/2026.03.03/yt-dlp";
const YTDLP_UNIX_SHA256: &str =
  "bc7b7b6a8a438571117efef98a0f9a12e634f6bbcd834896cddb6a1deedc9c4d";

const FFMPEG_MACOS_ZIP: &str = "https://deolaha.ca/pub/ffmpeg/ffmpeg-8.0.1.zip";
const FFMPEG_MACOS_ZIP_SHA256: &str =
  "470e482f6e290eac92984ac12b2d67bad425b1e5269fd75fb6a3536c16e824e4";
const FFMPEG_WINDOWS_ZIP: &str =
  "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.0.1-essentials_build.zip";
const FFMPEG_WINDOWS_ZIP_SHA256: &str =
  "e2aaeaa0fdbc397d4794828086424d4aaa2102cef1fb6874f6ffd29c0b88b673";
const FFMPEG_LINUX_AMD64_TAR_XZ: &str = "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz";
const FFMPEG_LINUX_AMD64_TAR_XZ_SHA256: &str =
  "abda8d77ce8309141f83ab8edf0596834087c52467f6badf376a6a2a4c87cf67";
const FFMPEG_LINUX_I686_TAR_XZ: &str = "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-i686-static.tar.xz";
const FFMPEG_LINUX_I686_TAR_XZ_SHA256: &str =
  "d8f700bd46b4d43aee157a4924cd3aeaeaa09ce62d64bcc1c0824e69859a51ec";
const FFMPEG_LINUX_ARM64_TAR_XZ: &str = "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz";
const FFMPEG_LINUX_ARM64_TAR_XZ_SHA256: &str =
  "f4149bb2b0784e30e99bdda85471c9b5930d3402014e934a5098b41d0f7201b1";

#[derive(Debug)]
struct DownloadArtifact {
  url: &'static str,
  sha256: &'static str,
}

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

  let yt_dlp_missing = resolve_binary_path(app, yt_dlp_binary_name()).is_err();
  let ffmpeg_missing = resolve_binary_path(app, ffmpeg_binary_name()).is_err();

  if yt_dlp_missing {
    repair_ytdlp(&target_dir).await?;
  }
  if ffmpeg_missing {
    repair_ffmpeg(&target_dir).await?;
  }
  Ok(())
}

async fn repair_ytdlp(target_dir: &Path) -> Result<(), String> {
  let artifact = if cfg!(target_os = "windows") {
    DownloadArtifact {
      url: YTDLP_WINDOWS_URL,
      sha256: YTDLP_WINDOWS_SHA256,
    }
  } else {
    DownloadArtifact {
      url: YTDLP_UNIX_URL,
      sha256: YTDLP_UNIX_SHA256,
    }
  };
  let destination = target_dir.join(yt_dlp_binary_name());
  download_to_path(artifact.url, artifact.sha256, &destination).await?;
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

  let artifact = if cfg!(target_os = "windows") {
    DownloadArtifact {
      url: FFMPEG_WINDOWS_ZIP,
      sha256: FFMPEG_WINDOWS_ZIP_SHA256,
    }
  } else if cfg!(target_os = "macos") {
    DownloadArtifact {
      url: FFMPEG_MACOS_ZIP,
      sha256: FFMPEG_MACOS_ZIP_SHA256,
    }
  } else {
    ffmpeg_linux_archive(std::env::consts::ARCH)?
  };

  download_to_path(artifact.url, artifact.sha256, &archive_path).await?;
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

async fn download_to_path(url: &str, expected_sha256: &str, destination: &Path) -> Result<(), String> {
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

  verify_sha256(&bytes, expected_sha256)
    .map_err(|error| format!("checksum verification failed for {url}: {error}"))?;

  fs::write(destination, bytes).map_err(|error| format!("failed to write '{}': {error}", destination.display()))
}

fn verify_sha256(bytes: &[u8], expected_sha256: &str) -> Result<(), String> {
  let digest = Sha256::digest(bytes);
  let actual = format!("{digest:x}");
  if actual.eq_ignore_ascii_case(expected_sha256) {
    return Ok(());
  }
  Err(format!(
    "expected {expected_sha256}, got {actual}"
  ))
}

fn extract_archive(archive_path: &Path, extract_dir: &Path) -> Result<(), String> {
  let status = if cfg!(target_os = "windows") {
    Command::new("powershell")
      .args(windows_expand_archive_args(archive_path, extract_dir))
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

fn ffmpeg_linux_archive(arch: &str) -> Result<DownloadArtifact, String> {
  match arch {
    "x86_64" => Ok(DownloadArtifact {
      url: FFMPEG_LINUX_AMD64_TAR_XZ,
      sha256: FFMPEG_LINUX_AMD64_TAR_XZ_SHA256,
    }),
    "x86" | "i686" => Ok(DownloadArtifact {
      url: FFMPEG_LINUX_I686_TAR_XZ,
      sha256: FFMPEG_LINUX_I686_TAR_XZ_SHA256,
    }),
    "aarch64" => Ok(DownloadArtifact {
      url: FFMPEG_LINUX_ARM64_TAR_XZ,
      sha256: FFMPEG_LINUX_ARM64_TAR_XZ_SHA256,
    }),
    other => Err(format!("unsupported linux architecture: {other}")),
  }
}

fn windows_expand_archive_args(archive_path: &Path, extract_dir: &Path) -> Vec<String> {
  vec![
    "-NoProfile".to_string(),
    "-Command".to_string(),
    "Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force".to_string(),
    archive_path.to_string_lossy().to_string(),
    extract_dir.to_string_lossy().to_string(),
  ]
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

#[cfg(test)]
mod tests {
  use super::{
    ffmpeg_linux_archive, verify_sha256, windows_expand_archive_args, FFMPEG_LINUX_AMD64_TAR_XZ,
    FFMPEG_LINUX_ARM64_TAR_XZ, FFMPEG_LINUX_I686_TAR_XZ,
  };
  use std::path::Path;

  #[test]
  fn linux_archive_url_selects_expected_variants() {
    assert_eq!(ffmpeg_linux_archive("x86_64").unwrap().url, FFMPEG_LINUX_AMD64_TAR_XZ);
    assert_eq!(ffmpeg_linux_archive("x86").unwrap().url, FFMPEG_LINUX_I686_TAR_XZ);
    assert_eq!(ffmpeg_linux_archive("i686").unwrap().url, FFMPEG_LINUX_I686_TAR_XZ);
    assert_eq!(ffmpeg_linux_archive("aarch64").unwrap().url, FFMPEG_LINUX_ARM64_TAR_XZ);
  }

  #[test]
  fn linux_archive_url_rejects_unsupported_arch() {
    let error = ffmpeg_linux_archive("armv7").unwrap_err();
    assert!(error.contains("unsupported linux architecture"));
  }

  #[test]
  fn windows_expand_archive_uses_literal_path_arguments() {
    let args = windows_expand_archive_args(Path::new("C:\\Users\\o'connor\\archive.zip"), Path::new("C:\\tmp\\extract"));
    assert_eq!(args[0], "-NoProfile");
    assert_eq!(args[1], "-Command");
    assert_eq!(
      args[2],
      "Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force"
    );
    assert_eq!(args[3], "C:\\Users\\o'connor\\archive.zip");
    assert_eq!(args[4], "C:\\tmp\\extract");
  }

  #[test]
  fn verify_sha256_accepts_matching_digest() {
    let bytes = b"hello";
    let digest = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
    assert!(verify_sha256(bytes, digest).is_ok());
  }

  #[test]
  fn verify_sha256_rejects_mismatch() {
    let result = verify_sha256(b"hello", "0000000000000000000000000000000000000000000000000000000000000000");
    assert!(result.is_err());
  }
}
