import type {
  CopySubtitleRequest,
  CopySubtitleResponse,
  DesktopHealth,
  DownloadJob,
  DownloadRequest,
  VideoInfo,
} from '@/types'
import { IPC_BASE_URL } from '@/lib/constants'

interface JobResponse {
  jobId: string
}

interface HealthPayload {
  status: string
  version: string
  engineState?: 'ready' | 'repairing' | 'unavailable'
  message?: string
}

const BINARY_MISSING_MESSAGE =
  'Download engine files are missing. Grabbit will try to repair automatically. If this keeps failing, reinstall Grabbit.'

function normalizeBackendMessage(message: string): string {
  if (message.toLowerCase().includes('binary not found')) {
    return BINARY_MISSING_MESSAGE
  }
  return message
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
    let message = `IPC request failed with status ${response.status}`
    try {
      const text = await response.text()
      if (text.trim()) {
        message = text.trim()
      }
    } catch {
      // Ignore body-read failures and keep status fallback.
    }
    throw new Error(normalizeBackendMessage(message))
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

export async function checkDesktopHealth(): Promise<DesktopHealth> {
  try {
    const payload = await request<HealthPayload>('/api/health')
    const health: DesktopHealth = {
      reachable: true,
      engineState: payload.engineState ?? 'ready',
    }
    if (payload.message) {
      health.message = payload.message
    }
    return {
      ...health,
    }
  } catch {
    return {
      reachable: false,
      engineState: 'unavailable',
      message: 'Start the Grabbit desktop app to continue.',
    }
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

export async function cancelDownloadJob(jobId: string): Promise<void> {
  await request<{ status: string }>(`/api/jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
  })
}

export async function copySubtitle(payload: CopySubtitleRequest): Promise<CopySubtitleResponse> {
  return request<CopySubtitleResponse>('/api/subtitles/copy', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
