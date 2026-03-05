use regex::Regex;

#[derive(Clone, Debug)]
pub struct ProgressUpdate {
  pub percent: f64,
  pub speed: Option<String>,
  pub eta: Option<String>,
}

pub fn parse_progress_line(line: &str) -> Option<ProgressUpdate> {
  let regex = Regex::new(r"\[download\]\s+(\d{1,3}(?:\.\d+)?)%\s+of.*?(?:at\s+([^\s]+))?.*?(?:ETA\s+([0-9:]+))?")
    .ok()?;
  let captures = regex.captures(line)?;
  let percent = captures.get(1)?.as_str().parse::<f64>().ok()?;
  let speed = captures.get(2).map(|value| value.as_str().to_string());
  let eta = captures.get(3).map(|value| value.as_str().to_string());

  Some(ProgressUpdate { percent, speed, eta })
}
