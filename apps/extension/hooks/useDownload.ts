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
const NON_TERMINAL_STATUSES = new Set<DownloadJob['status']>(['queued', 'downloading', 'merging'])

export function useDownload(): UseDownloadState {
  const [job, setJob] = useState<DownloadJob>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const timerRef = useRef<number | undefined>(undefined)

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
      if (TERMINAL_STATUSES.has(latest.status)) {
        stopPolling()
      }
    },
    [stopPolling],
  )

  const startPolling = useCallback(
    (jobId: string): void => {
      stopPolling()
      void pollStatus(jobId).catch((pollError: unknown) => {
        stopPolling()
        setError(pollError instanceof Error ? pollError.message : 'Failed to fetch download status')
      })
      timerRef.current = window.setInterval(() => {
        void pollStatus(jobId).catch((pollError: unknown) => {
          stopPolling()
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

    try {
      const { jobId } = await createDownloadJob(request)
      startPolling(jobId)
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'Unknown download error')
    } finally {
      setLoading(false)
    }
  }

  const hydrateFromQueue = useCallback(async (): Promise<void> => {
    try {
      const queue = await getDownloadQueue()
      if (queue.length === 0) {
        setJob(undefined)
        stopPolling()
        return
      }

      const reversed = [...queue].reverse()
      const latestNonTerminal = reversed.find((value) => NON_TERMINAL_STATUSES.has(value.status))
      const selected = latestNonTerminal ?? reversed[0]
      if (selected === undefined) {
        return
      }

      setJob(selected)
      setError(undefined)

      if (NON_TERMINAL_STATUSES.has(selected.status)) {
        startPolling(selected.id)
      } else {
        stopPolling()
      }
    } catch {
      // Best-effort rehydrate: silently skip when desktop server is unavailable.
      stopPolling()
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
