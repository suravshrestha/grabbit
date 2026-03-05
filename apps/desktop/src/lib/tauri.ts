import { invoke } from '@tauri-apps/api/core'
import type { DownloadJob } from '@grabbit/shared-types'

export async function getQueue(): Promise<DownloadJob[]> {
  return invoke<DownloadJob[]>('get_queue')
}

export async function cancelJob(jobId: string): Promise<void> {
  await invoke('cancel_job', { jobId })
}
