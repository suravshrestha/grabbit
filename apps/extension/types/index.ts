import type {
  CopySubtitleRequest,
  CopySubtitleResponse,
  DownloadJob,
  DownloadRequest,
  VideoInfo,
} from '@grabbit/shared-types'

export type MessageType = 'CHECK_DESKTOP_APP' | 'GET_VIDEO_INFO' | 'CONTENT_VIDEO_METADATA'

export interface ApiResponse<T> {
  data: T
}

export interface DownloadResponse {
  jobId: string
}

export interface HealthResponse {
  status: 'ok'
  version: string
}

export type { CopySubtitleRequest, CopySubtitleResponse, DownloadJob, DownloadRequest, VideoInfo }
