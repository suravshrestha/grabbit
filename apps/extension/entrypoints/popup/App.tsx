import { useEffect, useMemo, useState } from 'react'
import type { DownloadFormat, DownloadRequest, VideoInfo } from '@grabbit/shared-types'
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

export function App(): JSX.Element {
  const currentTab = useCurrentTab()
  const desktopRunning = useDesktopApp()
  const { job, loading, error, startDownload } = useDownload()
  const [format, setFormat] = useState<DownloadFormat>('mp4')
  const [quality, setQuality] = useState<'720p' | '1080p' | '4k' | 'best'>('1080p')
  const [subtitleTrackValue, setSubtitleTrackValue] = useState('')
  const [videoInfo, setVideoInfo] = useState<VideoInfo>()
  const [infoError, setInfoError] = useState<string>()

  const videoId = useMemo(() => {
    if (!currentTab.url) {
      return null
    }
    return extractVideoId(currentTab.url)
  }, [currentTab.url])

  useEffect(() => {
    if (!desktopRunning || !videoId) {
      return
    }
    void (async (): Promise<void> => {
      try {
        const info = await fetchVideoInfo(videoId)
        setVideoInfo(info)
        setInfoError(undefined)
      } catch (fetchError) {
        setVideoInfo(undefined)
        setInfoError(fetchError instanceof Error ? fetchError.message : 'Failed to load video info')
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

  if (!desktopRunning) {
    return (
      <main style={{ width: 360, padding: 16 }}>
        <h1>Grabbit</h1>
        <StatusMessage message="Start Grabbit desktop app" tone="error" />
      </main>
    )
  }

  return (
    <main style={{ width: 360, padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h1>Grabbit</h1>
      <p>{videoInfo?.title ?? currentTab.title ?? 'No video detected'}</p>
      {!videoId && <StatusMessage message="Open a YouTube watch page first." tone="error" />}
      {infoError && <StatusMessage message={infoError} tone="error" />}

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
      <DownloadButton
        disabled={!videoId || (subtitleMode && !selectedSubtitleTrack)}
        loading={loading}
        onClick={() => void handleDownload()}
      />
      {job && (
        <>
          <ProgressBar progress={job.progress} />
          <StatusMessage message={`Status: ${job.status}`} />
        </>
      )}
      {error && <StatusMessage message={error} tone="error" />}
    </main>
  )
}
