import type {
  CopySubtitleRequest,
  CopySubtitleResponse,
  DownloadJob,
  DownloadRequest,
  VideoInfo,
} from '@/types'
import { IPC_BASE_URL } from '@/lib/constants'

interface JobResponse {
  jobId: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${IPC_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    throw new Error(`IPC request failed with status ${response.status}`)
  }

  return (await response.json()) as T
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isSubtitleSource(value: unknown): value is 'manual' | 'auto' {
  return value === 'manual' || value === 'auto'
}

function isVideoInfo(value: unknown): value is VideoInfo {
  if (!isObject(value)) {
    return false
  }

  if (typeof value.videoId !== 'string' || typeof value.title !== 'string') {
    return false
  }

  if (!Array.isArray(value.subtitleTracks)) {
    return false
  }

  if (
    value.durationSeconds !== undefined &&
    value.durationSeconds !== null &&
    typeof value.durationSeconds !== 'number'
  ) {
    return false
  }

  if (
    value.thumbnailUrl !== undefined &&
    value.thumbnailUrl !== null &&
    typeof value.thumbnailUrl !== 'string'
  ) {
    return false
  }

  return value.subtitleTracks.every((track) => {
    if (!isObject(track)) {
      return false
    }
    return (
      typeof track.lang === 'string' &&
      typeof track.name === 'string' &&
      isSubtitleSource(track.source)
    )
  })
}

export async function checkDesktopHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${IPC_BASE_URL}/api/health`)
    return response.ok
  } catch {
    return false
  }
}

export async function fetchVideoInfo(videoId: string): Promise<VideoInfo> {
  const payload = await request<unknown>(`/api/info?videoId=${encodeURIComponent(videoId)}`)
  if (!isVideoInfo(payload)) {
    throw new Error('Desktop app is outdated. Restart or update Grabbit desktop app.')
  }
  return payload
}

export async function createDownloadJob(payload: DownloadRequest): Promise<JobResponse> {
  return request<JobResponse>('/api/download', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function getDownloadStatus(jobId: string): Promise<DownloadJob> {
  return request<DownloadJob>(`/api/status/${encodeURIComponent(jobId)}`)
}

export async function getDownloadQueue(): Promise<DownloadJob[]> {
  return request<DownloadJob[]>('/api/queue')
}

export async function openDownloadedFile(jobId: string): Promise<void> {
  await request<{ status: string }>(`/api/jobs/${encodeURIComponent(jobId)}/open-file`, {
    method: 'POST',
  })
}

export async function openDownloadFolder(jobId: string): Promise<void> {
  await request<{ status: string }>(`/api/jobs/${encodeURIComponent(jobId)}/open-folder`, {
    method: 'POST',
  })
}

export async function copySubtitle(payload: CopySubtitleRequest): Promise<CopySubtitleResponse> {
  return request<CopySubtitleResponse>('/api/subtitles/copy', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
