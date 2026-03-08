export type DownloadFormat = 'mp4' | 'mp3' | 'srt' | 'vtt'

export type DownloadStatus =
  | 'queued'
  | 'downloading'
  | 'merging'
  | 'complete'
  | 'error'
  | 'cancelled'

export interface DownloadRequest {
  videoId: string
  title?: string
  url: string
  format: DownloadFormat
  quality?: '360p' | '720p' | '1080p' | '4k' | 'best'
  audioBitrateKbps?: 128 | 192 | 256 | 320
  embedThumbnail?: boolean
  subtitleLang?: string
  subtitleSource?: 'manual' | 'auto'
  outputDir?: string
}

export interface DownloadJob {
  id: string
  request: DownloadRequest
  status: DownloadStatus
  progress: number
  speed?: string
  eta?: string
  filename?: string
  outputPath?: string
  outputDirResolved?: string
  error?: string
  createdAt: string
  completedAt?: string
}

export interface DesktopAppInfo {
  version: string
  ytdlpVersion: string
  status: 'ready' | 'busy'
}

export interface DesktopHealth {
  reachable: boolean
  engineState: 'ready' | 'repairing' | 'unavailable'
  message?: string
}

export interface VideoInfo {
  videoId: string
  title: string
  durationSeconds?: number
  thumbnailUrl?: string
  subtitleTracks: SubtitleTrack[]
}

export interface SubtitleTrack {
  lang: string
  name: string
  source: 'manual' | 'auto'
}

export interface CopySubtitleRequest {
  videoId: string
  url: string
  format: 'srt' | 'vtt'
  subtitleLang: string
  subtitleSource: 'manual' | 'auto'
}

export interface CopySubtitleResponse {
  text: string
}
