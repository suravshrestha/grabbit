import { useEffect, useRef, useState } from 'react'
import type { DownloadJob, DownloadRequest } from '@/types'
import { createDownloadJob, getDownloadStatus } from '@/lib/ipc'
import { POLL_INTERVAL_MS } from '@/lib/constants'

interface UseDownloadState {
  job: DownloadJob | undefined
  loading: boolean
  error: string | undefined
  startDownload: (request: DownloadRequest) => Promise<void>
}

export function useDownload(): UseDownloadState {
  const [job, setJob] = useState<DownloadJob>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const timerRef = useRef<number | undefined>(undefined)

  const stopPolling = (): void => {
    if (timerRef.current !== undefined) {
      window.clearInterval(timerRef.current)
      timerRef.current = undefined
    }
  }

  const startDownload = async (request: DownloadRequest): Promise<void> => {
    setLoading(true)
    setError(undefined)
    stopPolling()

    try {
      const { jobId } = await createDownloadJob(request)
      const fetchStatus = async (): Promise<void> => {
        const latest = await getDownloadStatus(jobId)
        setJob(latest)
        if (['complete', 'error', 'cancelled'].includes(latest.status)) {
          stopPolling()
          setLoading(false)
        }
      }

      await fetchStatus()
      timerRef.current = window.setInterval(() => {
        void fetchStatus()
      }, POLL_INTERVAL_MS)
    } catch (downloadError) {
      setLoading(false)
      setError(downloadError instanceof Error ? downloadError.message : 'Unknown download error')
    }
  }

  useEffect(() => {
    return () => stopPolling()
  }, [])

  return {
    job,
    loading,
    error,
    startDownload,
  }
}
