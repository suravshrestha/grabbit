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
import { Mp3BitrateSelector } from '@/components/mp3-bitrate-selector'
import { ProgressBar } from '@/components/ProgressBar'
import { QualitySelector } from '@/components/QualitySelector'
import { StatusMessage } from '@/components/StatusMessage'
import { SubtitleTrackSelector } from '@/components/subtitle-track-selector'
import { useCurrentTab } from '@/hooks/useCurrentTab'
import { useDesktopApp } from '@/hooks/useDesktopApp'
import { useDownload } from '@/hooks/useDownload'
import {
  cancelDownloadJob,
  copySubtitle,
  fetchVideoInfo,
  openDownloadFolder,
  openDownloadedFile,
} from '@/lib/ipc'
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
  const desktopHealth = useDesktopApp()
  const { jobs, focusedJob, setFocusedJob, loading, error, startDownload } = useDownload()

  const [format, setFormat] = useState<DownloadFormat>('mp4')
  const [quality, setQuality] = useState<'720p' | '1080p' | '4k' | 'best'>('1080p')
  const [audioBitrateKbps, setAudioBitrateKbps] = useState<128 | 192 | 256 | 320>(320)
  const [subtitleTrackValue, setSubtitleTrackValue] = useState('')
  const [videoInfo, setVideoInfo] = useState<VideoInfo>()
  const [infoError, setInfoError] = useState<string>()
  const [infoLoading, setInfoLoading] = useState(false)
  const [statusFlash, setStatusFlash] = useState(false)
  const [copyFlash, setCopyFlash] = useState(false)
  const [actionLoading, setActionLoading] = useState<'file' | 'folder' | null>(null)
  const [actionError, setActionError] = useState<string>()
  const [copyLoading, setCopyLoading] = useState(false)
  const [copyError, setCopyError] = useState<string>()
  const [copySuccess, setCopySuccess] = useState<string>()
  const [cancelLoadingId, setCancelLoadingId] = useState<string>()
  const [cancelError, setCancelError] = useState<string>()

  const downloadOptionsRef = useRef<HTMLDivElement>(null)
  const downloadStatusRef = useRef<HTMLDivElement>(null)
  const prevJobIdRef = useRef<string | undefined>(undefined)

  const videoId = useMemo(() => {
    if (!currentTab.url) {
      return null
    }

    return extractVideoId(currentTab.url)
  }, [currentTab.url])

  useEffect(() => {
    if (!desktopHealth.reachable || desktopHealth.engineState !== 'ready' || !videoId) {
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
  }, [desktopHealth.engineState, desktopHealth.reachable, videoId])

  // Scroll to and flash the Download Status card when a new job starts
  useEffect(() => {
    const job = focusedJob
    let flashTimer: number | undefined
    if (job && job.id !== prevJobIdRef.current) {
      prevJobIdRef.current = job.id
      downloadStatusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setStatusFlash(true)
      flashTimer = window.setTimeout(() => setStatusFlash(false), 900)
      setActionError(undefined)
      setActionLoading(null)
    }
    if (!job) {
      prevJobIdRef.current = undefined
      setStatusFlash(false)
      setActionError(undefined)
      setActionLoading(null)
    }
    return () => {
      if (flashTimer !== undefined) {
        window.clearTimeout(flashTimer)
      }
    }
  }, [focusedJob])

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

  useEffect(() => {
    setCopyError(undefined)
    setCopySuccess(undefined)
  }, [subtitleMode, subtitleTrackValue, videoId])

  useEffect(() => {
    if (!copySuccess) {
      setCopyFlash(false)
      return
    }

    downloadOptionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setCopyFlash(true)
    const flashTimer = window.setTimeout(() => setCopyFlash(false), 900)
    return () => {
      window.clearTimeout(flashTimer)
    }
  }, [copySuccess])

  const handleDownload = async (): Promise<void> => {
    if (!videoId || !currentTab.url) {
      return
    }

    const payload: DownloadRequest = {
      videoId,
      url: currentTab.url,
      format,
    }

    const title = videoInfo?.title ?? currentTab.title
    if (title) {
      payload.title = title
    }

    if (format === 'mp4') {
      payload.quality = quality
    }

    if (format === 'mp3') {
      payload.audioBitrateKbps = audioBitrateKbps
      payload.embedThumbnail = true
    }

    if (subtitleMode && selectedSubtitleTrack) {
      payload.subtitleLang = selectedSubtitleTrack.lang
      payload.subtitleSource = selectedSubtitleTrack.source
    }

    await startDownload(payload)
  }

  const handleOpenFile = async (): Promise<void> => {
    const job = focusedJob
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
    const job = focusedJob
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

  const handleCopySubtitle = async (): Promise<void> => {
    if (!videoId || !currentTab.url || !selectedSubtitleTrack || !subtitleMode) {
      return
    }

    setCopyLoading(true)
    setCopyError(undefined)
    setCopySuccess(undefined)

    try {
      const { text } = await copySubtitle({
        videoId,
        url: currentTab.url,
        format: format === 'srt' ? 'srt' : 'vtt',
        subtitleLang: selectedSubtitleTrack.lang,
        subtitleSource: selectedSubtitleTrack.source,
      })
      await navigator.clipboard.writeText(text)
      setCopySuccess('Subtitle copied to clipboard.')
    } catch (copySubtitleError) {
      setCopyError(
        copySubtitleError instanceof Error ? copySubtitleError.message : 'Failed to copy subtitle',
      )
    } finally {
      setCopyLoading(false)
    }
  }

  const handleCancelJob = async (jobId: string): Promise<void> => {
    setCancelError(undefined)
    setCancelLoadingId(jobId)
    try {
      await cancelDownloadJob(jobId)
    } catch (cancelJobError) {
      setCancelError(cancelJobError instanceof Error ? cancelJobError.message : 'Failed to cancel')
    } finally {
      setCancelLoadingId(undefined)
    }
  }

  const job = focusedJob
  const desktopRunning = desktopHealth.reachable && desktopHealth.engineState === 'ready'
  const desktopRepairing = desktopHealth.reachable && desktopHealth.engineState === 'repairing'
  const completedAtLabel =
    job?.completedAt === undefined ? undefined : new Date(job.completedAt).toLocaleString()
  const hasActiveJobs = jobs.some((entry) => ACTIVE_STATUSES.has(entry.status))
  const isDownloading = job !== undefined && ACTIVE_STATUSES.has(job.status)
  const controlsLocked = loading
  const canDownload = desktopRunning && !!videoId && (!subtitleMode || !!selectedSubtitleTrack)
  const canCopySubtitle =
    desktopRunning &&
    !!videoId &&
    !!currentTab.url &&
    subtitleMode &&
    !!selectedSubtitleTrack &&
    !copyLoading
  const hasDuplicateActiveForCurrentVideo =
    videoId !== null &&
    jobs.some((entry) => entry.request.videoId === videoId && ACTIVE_STATUSES.has(entry.status))
  const downloadActionLabel = hasActiveJobs ? 'Add to Queue' : 'Start Download'
  const queueItems = [...jobs].reverse()

  return (
    <main className="mx-auto w-[360px] min-w-0 max-w-full overflow-x-hidden bg-[radial-gradient(circle_at_top,_#fff1f2,_#ffffff_48%)] p-3">
      <div className="grid min-w-0 gap-3">
        <Card className="gap-3 border-red-100/80 py-4 shadow-sm">
          <CardHeader className="px-4">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <CardTitle className="min-w-0 truncate text-base">Grabbit</CardTitle>
              <Badge
                className="max-w-32 truncate"
                variant={desktopRunning ? 'success' : 'destructive'}
              >
                {desktopRunning ? 'Desktop Online' : 'Desktop Offline'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="text-muted-foreground line-clamp-2 px-4 text-xs">
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

        <div ref={downloadOptionsRef}>
          <Card
            className={`gap-3 py-4 transition-colors ${copyFlash ? 'bg-primary/5 ring-primary/40 ring-2 ring-inset' : ''}`}
          >
            <CardHeader className="px-4">
              <CardTitle className="text-sm">Download Options</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 px-4">
              <FormatPicker disabled={controlsLocked} value={format} onChange={setFormat} />
              {format === 'mp4' && (
                <QualitySelector disabled={controlsLocked} value={quality} onChange={setQuality} />
              )}
              {format === 'mp3' && (
                <Mp3BitrateSelector
                  disabled={controlsLocked}
                  value={audioBitrateKbps}
                  onChange={setAudioBitrateKbps}
                />
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
                <StatusMessage
                  message="No subtitle tracks available for this video."
                  tone="error"
                />
              )}
              <Separator className="my-1" />
              {subtitleMode ? (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    disabled={!canCopySubtitle || controlsLocked}
                    onClick={() => void handleCopySubtitle()}
                    size="lg"
                    variant="outline"
                  >
                    {copyLoading ? 'Copying...' : 'Copy Subtitle'}
                  </Button>
                  <DownloadButton
                    disabled={!canDownload || controlsLocked || hasDuplicateActiveForCurrentVideo}
                    loading={loading}
                    idleLabel={downloadActionLabel}
                    loadingLabel="Adding to Queue..."
                    onClick={() => void handleDownload()}
                  />
                </div>
              ) : (
                <DownloadButton
                  disabled={!canDownload || controlsLocked || hasDuplicateActiveForCurrentVideo}
                  loading={loading}
                  idleLabel={downloadActionLabel}
                  loadingLabel="Adding to Queue..."
                  onClick={() => void handleDownload()}
                />
              )}
              {copySuccess && subtitleMode && (
                <StatusMessage message={copySuccess} tone="success" />
              )}
              {copyError && subtitleMode && <StatusMessage message={copyError} tone="error" />}
            </CardContent>
          </Card>
        </div>

        {!desktopHealth.reachable && (
          <StatusMessage message="Start the Grabbit desktop app to continue." tone="error" />
        )}
        {desktopRepairing && (
          <StatusMessage
            message={
              desktopHealth.message ?? 'Desktop is preparing download engine. Please wait...'
            }
            tone="info"
          />
        )}
        {!videoId && desktopRunning && (
          <StatusMessage message="Open a YouTube watch page, then reopen the popup." tone="error" />
        )}
        {infoError && <StatusMessage message={infoError} tone="error" />}

        {queueItems.length > 0 && (
          <Card className="gap-2 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">Queue</CardTitle>
            </CardHeader>
            <CardContent className="grid max-h-56 gap-2 overflow-x-hidden overflow-y-scroll px-4 [scrollbar-gutter:stable]">
              {queueItems.map((entry) => (
                <button
                  key={entry.id}
                  className={`bg-muted/30 w-full rounded-md border px-3 py-2 text-left transition-colors ${
                    job?.id === entry.id ? 'border-primary/50 bg-primary/5' : 'hover:bg-muted/50'
                  }`}
                  onClick={() => setFocusedJob(entry.id)}
                  type="button"
                >
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                    <p className="text-foreground block w-full min-w-0 truncate text-xs font-medium">
                      {entry.request.title ?? entry.filename ?? entry.request.videoId}
                    </p>
                    <span className="text-muted-foreground shrink-0 whitespace-nowrap text-[11px]">
                      {STATUS_LABEL[entry.status]}
                    </span>
                  </div>
                  <div className="text-muted-foreground mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] tabular-nums">
                    <span className="shrink-0">{entry.progress.toFixed(1)}%</span>
                    {ACTIVE_STATUSES.has(entry.status) && (
                      <span className="min-w-0 whitespace-normal break-words">
                        {entry.speed ? `Speed: ${entry.speed}` : 'Speed: —'}
                        {' • '}
                        {entry.eta ? `ETA: ${entry.eta}` : 'ETA: —'}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>
        )}

        {job && (
          <div ref={downloadStatusRef}>
            <Card
              className={`gap-3 py-4 transition-colors ${statusFlash ? 'bg-primary/5 ring-primary/40 ring-2 ring-inset' : ''}`}
            >
              <CardHeader className="px-4">
                <CardTitle className="text-sm">Download Status</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 px-4">
                <ProgressBar progress={job.progress} />
                {isDownloading && (job.speed || job.eta) && (
                  <p className="text-muted-foreground min-w-0 truncate text-xs tabular-nums">
                    {job.speed ? `Speed: ${job.speed}` : 'Speed: —'}
                    {' • '}
                    {job.eta ? `ETA: ${job.eta}` : 'ETA: —'}
                  </p>
                )}
                <StatusMessage
                  message={`Status: ${STATUS_LABEL[job.status]}`}
                  tone={STATUS_TONE[job.status]}
                />
                {ACTIVE_STATUSES.has(job.status) && (
                  <Button
                    disabled={cancelLoadingId === job.id}
                    onClick={() => void handleCancelJob(job.id)}
                    size="sm"
                    variant="outline"
                  >
                    {cancelLoadingId === job.id ? 'Cancelling…' : 'Cancel'}
                  </Button>
                )}
                {job.status === 'complete' && (
                  <div className="bg-muted/40 grid gap-2 rounded-lg border px-3 py-2">
                    {job.filename && (
                      <p
                        className="text-foreground truncate text-sm font-medium"
                        title={job.filename}
                      >
                        {job.filename}
                      </p>
                    )}
                    {job.outputDirResolved && (
                      <p
                        className="text-muted-foreground truncate text-xs"
                        title={job.outputDirResolved}
                      >
                        Folder: {job.outputDirResolved}
                      </p>
                    )}
                    {completedAtLabel && (
                      <p
                        className="text-muted-foreground truncate text-xs"
                        title={completedAtLabel}
                      >
                        Completed: {completedAtLabel}
                      </p>
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
                {cancelError && <StatusMessage message={cancelError} tone="error" />}
              </CardContent>
            </Card>
          </div>
        )}

        {error && <StatusMessage message={error} tone="error" />}
      </div>
    </main>
  )
}
