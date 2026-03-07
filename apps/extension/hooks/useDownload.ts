import { useCallback, useEffect, useRef, useState } from 'react'
import type { DownloadJob, DownloadRequest } from '@/types'
import { createDownloadJob, getDownloadQueue, getDownloadStatus } from '@/lib/ipc'
import { POLL_INTERVAL_MS } from '@/lib/constants'

interface UseDownloadState {
  job: DownloadJob | undefined
  loading: boolean
  error: string | undefined
  startDownload: (request: DownloadRequest) => Promise<void>
}

const TERMINAL_STATUSES = new Set<DownloadJob['status']>(['complete', 'error', 'cancelled'])
const ACTIVE_STATUSES = new Set<DownloadJob['status']>(['queued', 'downloading', 'merging'])

export function useDownload(): UseDownloadState {
  const [job, setJob] = useState<DownloadJob>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const timerRef = useRef<number | undefined>(undefined)
  const currentJobIdRef = useRef<string | undefined>(undefined)

  const stopPolling = useCallback((): void => {
    if (timerRef.current !== undefined) {
      window.clearInterval(timerRef.current)
      timerRef.current = undefined
    }
  }, [])

  const pollStatus = useCallback(
    async (jobId: string): Promise<void> => {
      const latest = await getDownloadStatus(jobId)
      setJob(latest)
      currentJobIdRef.current = latest.id
      if (TERMINAL_STATUSES.has(latest.status)) {
        stopPolling()
        setLoading(false)
      }
    },
    [stopPolling],
  )

  const startPolling = useCallback(
    (jobId: string): void => {
      stopPolling()
      void pollStatus(jobId).catch((pollError: unknown) => {
        stopPolling()
        setLoading(false)
        setError(pollError instanceof Error ? pollError.message : 'Failed to fetch download status')
      })
      timerRef.current = window.setInterval(() => {
        void pollStatus(jobId).catch((pollError: unknown) => {
          stopPolling()
          setLoading(false)
          setError(
            pollError instanceof Error ? pollError.message : 'Failed to fetch download status',
          )
        })
      }, POLL_INTERVAL_MS)
    },
    [pollStatus, stopPolling],
  )

  const startDownload = async (request: DownloadRequest): Promise<void> => {
    setLoading(true)
    setError(undefined)
    stopPolling()

    try {
      const { jobId } = await createDownloadJob(request)
      currentJobIdRef.current = jobId
      startPolling(jobId)
    } catch (downloadError) {
      setLoading(false)
      setError(downloadError instanceof Error ? downloadError.message : 'Unknown download error')
    }
  }

  const hydrateFromQueue = useCallback(async (): Promise<void> => {
    try {
      const queue = await getDownloadQueue()
      if (queue.length === 0) {
        setJob(undefined)
        currentJobIdRef.current = undefined
        setLoading(false)
        stopPolling()
        return
      }

      const reversed = [...queue].reverse()
      const latestActive = reversed.find((value) => ACTIVE_STATUSES.has(value.status))
      const selected = latestActive ?? reversed[0]
      if (selected === undefined) {
        return
      }

      setJob(selected)
      setError(undefined)
      currentJobIdRef.current = selected.id

      if (ACTIVE_STATUSES.has(selected.status)) {
        setLoading(true)
        startPolling(selected.id)
      } else {
        setLoading(false)
        stopPolling()
      }
    } catch {
      // Best-effort rehydrate: silently skip when desktop server is unavailable.
      stopPolling()
      setLoading(false)
    }
  }, [startPolling, stopPolling])

  useEffect(() => {
    void hydrateFromQueue()
    return () => stopPolling()
  }, [hydrateFromQueue, stopPolling])

  return {
    job,
    loading,
    error,
    startDownload,
  }
}
