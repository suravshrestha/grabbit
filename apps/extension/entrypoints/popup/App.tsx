import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  DownloadFormat,
  DownloadRequest,
  DownloadStatus,
  VideoInfo,
} from '@grabbit/shared-types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { DownloadButton } from '@/components/DownloadButton'
import { FormatPicker } from '@/components/FormatPicker'
import { ProgressBar } from '@/components/ProgressBar'
import { QualitySelector } from '@/components/QualitySelector'
import { StatusMessage } from '@/components/StatusMessage'
import { SubtitleTrackSelector } from '@/components/subtitle-track-selector'
import { useCurrentTab } from '@/hooks/useCurrentTab'
import { useDesktopApp } from '@/hooks/useDesktopApp'
import { useDownload } from '@/hooks/useDownload'
import { fetchVideoInfo, openDownloadFolder, openDownloadedFile } from '@/lib/ipc'
import { extractVideoId } from '@/lib/youtube'

function toSubtitleTrackValue(lang: string, source: 'manual' | 'auto'): string {
  return `${source}:${lang}`
}

const STATUS_TONE: Record<DownloadStatus, 'info' | 'error' | 'success'> = {
  queued: 'info',
  downloading: 'info',
  merging: 'info',
  complete: 'success',
  error: 'error',
  cancelled: 'error',
}

const STATUS_LABEL: Record<DownloadStatus, string> = {
  queued: 'Queued',
  downloading: 'Downloading',
  merging: 'Merging',
  complete: 'Completed',
  error: 'Failed',
  cancelled: 'Cancelled',
}

const ACTIVE_STATUSES = new Set<DownloadStatus>(['queued', 'downloading', 'merging'])

export function App(): JSX.Element {
  const currentTab = useCurrentTab()
  const desktopRunning = useDesktopApp()
  const { job, loading, error, startDownload } = useDownload()

  const [format, setFormat] = useState<DownloadFormat>('mp4')
  const [quality, setQuality] = useState<'720p' | '1080p' | '4k' | 'best'>('1080p')
  const [subtitleTrackValue, setSubtitleTrackValue] = useState('')
  const [videoInfo, setVideoInfo] = useState<VideoInfo>()
  const [infoError, setInfoError] = useState<string>()
  const [infoLoading, setInfoLoading] = useState(false)
  const [statusFlash, setStatusFlash] = useState(false)
  const [actionLoading, setActionLoading] = useState<'file' | 'folder' | null>(null)
  const [actionError, setActionError] = useState<string>()

  const downloadStatusRef = useRef<HTMLDivElement>(null)
  const prevJobIdRef = useRef<string | undefined>(undefined)

  const videoId = useMemo(() => {
    if (!currentTab.url) {
      return null
    }

    return extractVideoId(currentTab.url)
  }, [currentTab.url])

  useEffect(() => {
    if (!desktopRunning || !videoId) {
      setInfoLoading(false)
      return
    }

    let cancelled = false
    setInfoLoading(true)
    void (async (): Promise<void> => {
      try {
        const info = await fetchVideoInfo(videoId)
        if (cancelled) return
        setVideoInfo(info)
        setInfoError(undefined)
      } catch (fetchError) {
        if (cancelled) return
        setVideoInfo(undefined)
        setInfoError(fetchError instanceof Error ? fetchError.message : 'Failed to load video info')
      } finally {
        if (!cancelled) setInfoLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [desktopRunning, videoId])

  // Scroll to and flash the Download Status card when a new job starts
  useEffect(() => {
    if (job && job.id !== prevJobIdRef.current) {
      prevJobIdRef.current = job.id
      downloadStatusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setStatusFlash(true)
      setActionError(undefined)
      setActionLoading(null)
    }
    if (!job) {
      prevJobIdRef.current = undefined
      setActionError(undefined)
      setActionLoading(null)
    }
  }, [job])

  const subtitleTracks = videoInfo?.subtitleTracks ?? []
  const subtitleMode = format === 'srt' || format === 'vtt'
  const selectedSubtitleTrack = subtitleTracks.find(
    (track) => toSubtitleTrackValue(track.lang, track.source) === subtitleTrackValue,
  )

  useEffect(() => {
    if (!subtitleMode) {
      return
    }

    if (subtitleTracks.length === 0) {
      setSubtitleTrackValue('')
      return
    }

    if (!selectedSubtitleTrack) {
      const first = subtitleTracks[0]
      if (first) {
        setSubtitleTrackValue(toSubtitleTrackValue(first.lang, first.source))
      }
    }
  }, [selectedSubtitleTrack, subtitleMode, subtitleTracks])

  const handleDownload = async (): Promise<void> => {
    if (!videoId || !currentTab.url) {
      return
    }

    const payload: DownloadRequest = {
      videoId,
      url: currentTab.url,
      format,
    }

    if (format === 'mp4') {
      payload.quality = quality
    }

    if (subtitleMode && selectedSubtitleTrack) {
      payload.subtitleLang = selectedSubtitleTrack.lang
      payload.subtitleSource = selectedSubtitleTrack.source
    }

    await startDownload(payload)
  }

  const handleOpenFile = async (): Promise<void> => {
    if (!job) {
      return
    }
    setActionLoading('file')
    setActionError(undefined)
    try {
      await openDownloadedFile(job.id)
    } catch (openError) {
      setActionError(
        openError instanceof Error ? openError.message : 'Failed to open downloaded file',
      )
    } finally {
      setActionLoading(null)
    }
  }

  const handleOpenFolder = async (): Promise<void> => {
    if (!job) {
      return
    }
    setActionLoading('folder')
    setActionError(undefined)
    try {
      await openDownloadFolder(job.id)
    } catch (openError) {
      setActionError(
        openError instanceof Error ? openError.message : 'Failed to open download folder',
      )
    } finally {
      setActionLoading(null)
    }
  }

  const completedAtLabel =
    job?.completedAt === undefined ? undefined : new Date(job.completedAt).toLocaleString()

  const isDownloading = job !== undefined && ACTIVE_STATUSES.has(job.status)
  const controlsLocked = loading
  const canDownload = desktopRunning && !!videoId && (!subtitleMode || !!selectedSubtitleTrack)
  const downloadActionLabel = isDownloading ? 'Add to Queue' : 'Start Download'

  return (
    <main className="w-[360px] bg-[radial-gradient(circle_at_top,_#fff1f2,_#ffffff_48%)] p-3">
      <div className="grid gap-3">
        <Card className="gap-3 border-red-100/80 py-4 shadow-sm">
          <CardHeader className="px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Grabbit</CardTitle>
              <Badge variant={desktopRunning ? 'success' : 'destructive'}>
                {desktopRunning ? 'Desktop Online' : 'Desktop Offline'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="text-muted-foreground px-4 text-xs">
            Save videos, audio, and subtitles from your current YouTube tab.
          </CardContent>
        </Card>

        <Card className="gap-3 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">Current Video</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 px-4">
            {infoLoading ? (
              <div className="aspect-video w-full overflow-hidden rounded-lg">
                <Skeleton className="h-full w-full rounded-lg" />
              </div>
            ) : videoInfo?.thumbnailUrl ? (
              <div className="aspect-video w-full overflow-hidden rounded-lg">
                <img
                  alt={videoInfo.title}
                  className="h-full w-full object-cover"
                  src={videoInfo.thumbnailUrl}
                />
              </div>
            ) : (
              <div className="border-border text-muted-foreground flex h-20 items-center justify-center rounded-lg border border-dashed text-xs">
                {videoId
                  ? 'Thumbnail unavailable for this video.'
                  : 'Open a YouTube watch page first.'}
              </div>
            )}
            <p className="text-foreground line-clamp-2 text-sm font-medium">
              {videoInfo?.title ?? currentTab.title ?? 'No video detected'}
            </p>
          </CardContent>
        </Card>

        <Card className="gap-3 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">Download Options</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 px-4">
            <FormatPicker disabled={controlsLocked} value={format} onChange={setFormat} />
            {format === 'mp4' && (
              <QualitySelector disabled={controlsLocked} value={quality} onChange={setQuality} />
            )}
            {subtitleMode && subtitleTracks.length > 0 && (
              <SubtitleTrackSelector
                disabled={controlsLocked}
                tracks={subtitleTracks}
                value={subtitleTrackValue}
                onChange={setSubtitleTrackValue}
              />
            )}
            {subtitleMode && subtitleTracks.length === 0 && (
              <StatusMessage message="No subtitle tracks available for this video." tone="error" />
            )}
            <Separator className="my-1" />
            <DownloadButton
              disabled={!canDownload || controlsLocked}
              loading={loading}
              idleLabel={downloadActionLabel}
              loadingLabel="Adding to Queue..."
              onClick={() => void handleDownload()}
            />
          </CardContent>
        </Card>

        {!desktopRunning && (
          <StatusMessage message="Start the Grabbit desktop app to continue." tone="error" />
        )}
        {!videoId && desktopRunning && (
          <StatusMessage message="Open a YouTube watch page, then reopen the popup." tone="error" />
        )}
        {infoError && <StatusMessage message={infoError} tone="error" />}

        {job && (
          <div ref={downloadStatusRef}>
            <Card
              className={`gap-3 py-4 transition-shadow${statusFlash ? 'status-flash' : ''}`}
              onAnimationEnd={() => setStatusFlash(false)}
            >
              <CardHeader className="px-4">
                <CardTitle className="text-sm">Download Status</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 px-4">
                <ProgressBar progress={job.progress} />
                {isDownloading && (job.speed || job.eta) && (
                  <p className="text-muted-foreground text-xs tabular-nums">
                    {job.speed ? `Speed: ${job.speed}` : 'Speed: —'}
                    {' • '}
                    {job.eta ? `ETA: ${job.eta}` : 'ETA: —'}
                  </p>
                )}
                <StatusMessage
                  message={`Status: ${STATUS_LABEL[job.status]}`}
                  tone={STATUS_TONE[job.status]}
                />
                {job.status === 'complete' && (
                  <div className="bg-muted/40 grid gap-2 rounded-lg border px-3 py-2">
                    {job.filename && (
                      <p className="text-foreground break-all text-sm font-medium">
                        {job.filename}
                      </p>
                    )}
                    {job.outputDirResolved && (
                      <p className="text-muted-foreground break-all text-xs">
                        Folder: {job.outputDirResolved}
                      </p>
                    )}
                    {completedAtLabel && (
                      <p className="text-muted-foreground text-xs">Completed: {completedAtLabel}</p>
                    )}
                    <div className="flex gap-2">
                      <Button
                        disabled={actionLoading !== null}
                        onClick={() => void handleOpenFile()}
                        size="sm"
                        variant="outline"
                      >
                        {actionLoading === 'file' ? 'Opening…' : 'Open File'}
                      </Button>
                      <Button
                        disabled={actionLoading !== null}
                        onClick={() => void handleOpenFolder()}
                        size="sm"
                        variant="outline"
                      >
                        {actionLoading === 'folder' ? 'Opening…' : 'Open Folder'}
                      </Button>
                    </div>
                    {actionError && <StatusMessage message={actionError} tone="error" />}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {error && <StatusMessage message={error} tone="error" />}
      </div>
    </main>
  )
}
