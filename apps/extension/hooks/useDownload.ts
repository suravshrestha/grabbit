import { useCallback, useEffect, useRef, useState } from 'react'
import type { DownloadJob, DownloadRequest } from '@/types'
import { createDownloadJob, getDownloadQueue } from '@/lib/ipc'
import { POLL_INTERVAL_MS } from '@/lib/constants'

interface UseDownloadState {
  jobs: DownloadJob[]
  focusedJob: DownloadJob | undefined
  setFocusedJob: (jobId: string) => void
  loading: boolean
  error: string | undefined
  startDownload: (request: DownloadRequest) => Promise<void>
}

const NON_TERMINAL_STATUSES = new Set<DownloadJob['status']>(['queued', 'downloading', 'merging'])

function pickFocusedJob(queue: DownloadJob[]): DownloadJob | undefined {
  const reversed = [...queue].reverse()
  return reversed.find((value) => NON_TERMINAL_STATUSES.has(value.status)) ?? reversed[0]
}

export function useDownload(): UseDownloadState {
  const [jobs, setJobs] = useState<DownloadJob[]>([])
  const [focusedJob, setFocusedJob] = useState<DownloadJob>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const timerRef = useRef<number | undefined>(undefined)
  const focusedJobIdRef = useRef<string>()

  const stopPolling = useCallback((): void => {
    if (timerRef.current !== undefined) {
      window.clearInterval(timerRef.current)
      timerRef.current = undefined
    }
  }, [])

  const refreshQueue = useCallback(async (): Promise<void> => {
    const queue = await getDownloadQueue()
    setJobs(queue)
    const selected =
      (focusedJobIdRef.current
        ? queue.find((entry) => entry.id === focusedJobIdRef.current)
        : undefined) ?? pickFocusedJob(queue)
    setFocusedJob(selected)
    if (selected) {
      focusedJobIdRef.current = selected.id
    } else {
      focusedJobIdRef.current = undefined
    }
  }, [])

  const startPolling = useCallback((): void => {
    stopPolling()
    timerRef.current = window.setInterval(() => {
      void refreshQueue().catch((pollError: unknown) => {
        setError(pollError instanceof Error ? pollError.message : 'Failed to fetch download queue')
      })
    }, POLL_INTERVAL_MS)
  }, [refreshQueue, stopPolling])

  const startDownload = async (request: DownloadRequest): Promise<void> => {
    setLoading(true)
    setError(undefined)

    try {
      const { jobId } = await createDownloadJob(request)
      focusedJobIdRef.current = jobId
      await refreshQueue()
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'Unknown download error')
    } finally {
      setLoading(false)
    }
  }

  const hydrateFromQueue = useCallback(async (): Promise<void> => {
    try {
      await refreshQueue()
      setError(undefined)
      startPolling()
    } catch {
      // Best-effort rehydrate: silently skip when desktop server is unavailable.
      stopPolling()
    }
  }, [refreshQueue, startPolling, stopPolling])

  useEffect(() => {
    void hydrateFromQueue()
    return () => stopPolling()
  }, [hydrateFromQueue, stopPolling])

  const focusJob = useCallback(
    (jobId: string): void => {
      focusedJobIdRef.current = jobId
      const selected = jobs.find((entry) => entry.id === jobId)
      if (selected) {
        setFocusedJob(selected)
      }
    },
    [jobs],
  )

  return {
    jobs,
    focusedJob,
    setFocusedJob: focusJob,
    loading,
    error,
    startDownload,
  }
}
