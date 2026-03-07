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
const QUEUE_EVENTS = [...DOWNLOAD_EVENTS, 'download://queue-updated'] as const
const FALLBACK_REFRESH_MS = 2_000

export function useQueue(): UseQueueState {
  const [jobs, setJobs] = useState<DownloadJob[]>([])
  const isMounted = useRef(true)
  const isRefreshing = useRef(false)

  const refresh = useCallback(async (): Promise<void> => {
    if (isRefreshing.current) {
      return
    }

    isRefreshing.current = true
    try {
      const queue = await getQueue()
      if (isMounted.current) {
        setJobs(queue)
      }
    } finally {
      isRefreshing.current = false
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
      QUEUE_EVENTS.map((event) =>
        listen<DownloadJob>(event, () => {
          void refresh()
        }),
      ),
    )
    const pollTimer = window.setInterval(() => {
      void refresh().catch(() => {})
    }, FALLBACK_REFRESH_MS)

    return () => {
      isMounted.current = false
      window.clearInterval(pollTimer)
      void unlisten.then((fns) => fns.forEach((fn) => fn()))
    }
  }, [refresh])

  return { jobs, refresh, cancel }
}
