use regex::Regex;
use std::sync::OnceLock;

#[derive(Clone, Debug)]
pub struct ProgressUpdate {
  pub percent: f64,
  pub speed: Option<String>,
  pub eta: Option<String>,
}

pub fn parse_progress_line(line: &str) -> Option<ProgressUpdate> {
  if !line.contains("[download]") {
    return None;
  }

  let percent_regex =
    PERCENT_REGEX.get_or_init(|| Regex::new(r"\[download\]\s+([\d.]+)%").expect("valid regex"));
  let speed_regex = SPEED_REGEX.get_or_init(|| Regex::new(r"\bat\s+([^\s]+)").expect("valid regex"));
  let eta_regex = ETA_REGEX.get_or_init(|| Regex::new(r"\bETA\s+([0-9:]+)").expect("valid regex"));

  let percent = percent_regex
    .captures(line)?
    .get(1)?
    .as_str()
    .parse::<f64>()
    .ok()?;
  let speed = speed_regex
    .captures(line)
    .and_then(|captures| captures.get(1))
    .map(|value| value.as_str().to_string());
  let eta = eta_regex
    .captures(line)
    .and_then(|captures| captures.get(1))
    .map(|value| value.as_str().to_string());

  Some(ProgressUpdate { percent, speed, eta })
}

static PERCENT_REGEX: OnceLock<Regex> = OnceLock::new();
static SPEED_REGEX: OnceLock<Regex> = OnceLock::new();
static ETA_REGEX: OnceLock<Regex> = OnceLock::new();

#[cfg(test)]
mod tests {
  use super::parse_progress_line;

  #[test]
  fn parse_progress_line_with_speed_and_eta() {
    let value = parse_progress_line("[download]  12.4% of 150.00MiB at 1.20MiB/s ETA 00:43");
    let parsed = value.expect("expected progress");
    assert_eq!(parsed.percent, 12.4);
    assert_eq!(parsed.speed.as_deref(), Some("1.20MiB/s"));
    assert_eq!(parsed.eta.as_deref(), Some("00:43"));
  }

  #[test]
  fn parse_progress_line_without_eta() {
    let value = parse_progress_line("[download]  68.1% at 3.10MiB/s");
    let parsed = value.expect("expected progress");
    assert_eq!(parsed.percent, 68.1);
    assert_eq!(parsed.speed.as_deref(), Some("3.10MiB/s"));
    assert_eq!(parsed.eta, None);
  }

  #[test]
  fn parse_progress_line_without_speed() {
    let value = parse_progress_line("[download]  34.0% of ~1.40GiB ETA 10:15");
    let parsed = value.expect("expected progress");
    assert_eq!(parsed.percent, 34.0);
    assert_eq!(parsed.speed, None);
    assert_eq!(parsed.eta.as_deref(), Some("10:15"));
  }

  #[test]
  fn parse_progress_line_ignores_non_download_lines() {
    assert!(parse_progress_line("[Merger] Merging formats into \"demo.mp4\"").is_none());
  }
}
