import { useEffect, useMemo, useState } from 'react'
import type {
  DownloadFormat,
  DownloadRequest,
  DownloadStatus,
  VideoInfo,
} from '@grabbit/shared-types'
import { Badge } from '@/components/ui/badge'
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
import { fetchVideoInfo } from '@/lib/ipc'
import { extractVideoId } from '@/lib/youtube'

function toSubtitleTrackValue(lang: string, source: 'manual' | 'auto'): string {
  return `${source}:${lang}`
}

function statusTone(status: DownloadStatus): 'info' | 'error' | 'success' {
  if (status === 'error' || status === 'cancelled') {
    return 'error'
  }
  if (status === 'complete') {
    return 'success'
  }
  return 'info'
}

function statusLabel(status: DownloadStatus): string {
  if (status === 'queued') {
    return 'Queued'
  }
  if (status === 'downloading') {
    return 'Downloading'
  }
  if (status === 'merging') {
    return 'Merging'
  }
  if (status === 'complete') {
    return 'Completed'
  }
  if (status === 'cancelled') {
    return 'Cancelled'
  }
  return 'Failed'
}

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

    setInfoLoading(true)
    void (async (): Promise<void> => {
      try {
        const info = await fetchVideoInfo(videoId)
        setVideoInfo(info)
        setInfoError(undefined)
      } catch (fetchError) {
        setVideoInfo(undefined)
        setInfoError(fetchError instanceof Error ? fetchError.message : 'Failed to load video info')
      } finally {
        setInfoLoading(false)
      }
    })()
  }, [desktopRunning, videoId])

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

  const canDownload = desktopRunning && !!videoId && (!subtitleMode || !!selectedSubtitleTrack)

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
              <div className="grid gap-2">
                <div className="bg-muted/40 border-border/80 aspect-video w-full overflow-hidden rounded-lg border p-1">
                  <Skeleton className="h-full w-full rounded-md" />
                </div>
                <p className="text-muted-foreground animate-pulse text-xs">
                  Loading video details…
                </p>
              </div>
            ) : videoInfo?.thumbnailUrl ? (
              <div className="bg-muted/40 border-border/80 aspect-video w-full overflow-hidden rounded-lg border p-1">
                <img
                  alt={videoInfo.title}
                  className="h-full w-full rounded-md object-contain"
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
            <FormatPicker value={format} onChange={setFormat} />
            {format === 'mp4' && <QualitySelector value={quality} onChange={setQuality} />}
            {subtitleMode && subtitleTracks.length > 0 && (
              <SubtitleTrackSelector
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
              disabled={!canDownload}
              loading={loading}
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
          <Card className="gap-3 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">Download Status</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 px-4">
              <ProgressBar progress={job.progress} />
              <StatusMessage
                message={`Status: ${statusLabel(job.status)}`}
                tone={statusTone(job.status)}
              />
            </CardContent>
          </Card>
        )}

        {error && <StatusMessage message={error} tone="error" />}
      </div>
    </main>
  )
}
