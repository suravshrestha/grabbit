export type DownloadFormat = 'mp4' | 'mp3' | 'srt' | 'vtt'

export type DownloadStatus = 'queued' | 'downloading' | 'merging' | 'complete' | 'error' | 'cancelled'

export interface DownloadRequest {
  videoId: string
  url: string
  format: DownloadFormat
  quality?: '360p' | '720p' | '1080p' | '4k' | 'best'
  subtitleLang?: string
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
  error?: string
  createdAt: string
  completedAt?: string
}

export interface DesktopAppInfo {
  version: string
  ytdlpVersion: string
  status: 'ready' | 'busy'
}

export interface VideoInfo {
  videoId: string
  title: string
  durationSeconds?: number
  thumbnailUrl?: string
}
