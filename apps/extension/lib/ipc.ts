import type { DownloadJob, DownloadRequest, VideoInfo } from '@/types'
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

export async function checkDesktopHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${IPC_BASE_URL}/api/health`)
    return response.ok
  } catch {
    return false
  }
}

export async function fetchVideoInfo(videoId: string): Promise<VideoInfo> {
  return request<VideoInfo>(`/api/info?videoId=${encodeURIComponent(videoId)}`)
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
