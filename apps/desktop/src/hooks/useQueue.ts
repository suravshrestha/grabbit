import { useEffect, useState } from 'react'
import type { DownloadJob } from '@grabbit/shared-types'
import { cancelJob, getQueue } from '@/lib/tauri'

interface UseQueueState {
  jobs: DownloadJob[]
  refresh: () => Promise<void>
  cancel: (jobId: string) => Promise<void>
}

export function useQueue(): UseQueueState {
  const [jobs, setJobs] = useState<DownloadJob[]>([])

  const refresh = async (): Promise<void> => {
    const queue = await getQueue()
    setJobs(queue)
  }

  const cancel = async (jobId: string): Promise<void> => {
    await cancelJob(jobId)
    await refresh()
  }

  useEffect(() => {
    void refresh()
  }, [])

  return { jobs, refresh, cancel }
}
