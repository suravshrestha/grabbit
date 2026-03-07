import { useCallback, useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import type { DownloadJob } from '@grabbit/shared-types'
import { cancelJob, getQueue } from '@/lib/tauri'

interface UseQueueState {
  jobs: DownloadJob[]
  refresh: () => Promise<void>
  cancel: (jobId: string) => Promise<void>
}

const DOWNLOAD_EVENTS = ['download://progress', 'download://complete', 'download://error'] as const

export function useQueue(): UseQueueState {
  const [jobs, setJobs] = useState<DownloadJob[]>([])
  const isMounted = useRef(true)

  const refresh = useCallback(async (): Promise<void> => {
    const queue = await getQueue()
    if (isMounted.current) {
      setJobs(queue)
    }
  }, [])

  const cancel = async (jobId: string): Promise<void> => {
    await cancelJob(jobId)
    await refresh()
  }

  useEffect(() => {
    isMounted.current = true
    void refresh()

    const unlisten = Promise.all(
      DOWNLOAD_EVENTS.map((event) =>
        listen<DownloadJob>(event, () => {
          void refresh()
        }),
      ),
    )

    return () => {
      isMounted.current = false
      void unlisten.then((fns) => fns.forEach((fn) => fn()))
    }
  }, [refresh])

  return { jobs, refresh, cancel }
}
