import { useEffect, useMemo, useState } from 'react'
import type { DownloadFormat, DownloadRequest, VideoInfo } from '@grabbit/shared-types'
import { DownloadButton } from '@/components/DownloadButton'
import { FormatPicker } from '@/components/FormatPicker'
import { ProgressBar } from '@/components/ProgressBar'
import { QualitySelector } from '@/components/QualitySelector'
import { StatusMessage } from '@/components/StatusMessage'
import { useCurrentTab } from '@/hooks/useCurrentTab'
import { useDesktopApp } from '@/hooks/useDesktopApp'
import { useDownload } from '@/hooks/useDownload'
import { fetchVideoInfo } from '@/lib/ipc'
import { extractVideoId } from '@/lib/youtube'

export function App(): JSX.Element {
  const currentTab = useCurrentTab()
  const desktopRunning = useDesktopApp()
  const { job, loading, error, startDownload } = useDownload()
  const [format, setFormat] = useState<DownloadFormat>('mp4')
  const [quality, setQuality] = useState<'720p' | '1080p' | '4k' | 'best'>('1080p')
  const [subtitleLang, setSubtitleLang] = useState('en')
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
      } catch (fetchError) {
        setInfoError(fetchError instanceof Error ? fetchError.message : 'Failed to load video info')
      }
    })()
  }, [desktopRunning, videoId])

  const handleDownload = async (): Promise<void> => {
    if (!videoId || !currentTab.url) {
      return
    }

    const payload: DownloadRequest = {
      videoId,
      url: currentTab.url,
      format,
      quality: format === 'mp4' ? quality : undefined,
      subtitleLang: format === 'srt' || format === 'vtt' ? subtitleLang : undefined,
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
      {(format === 'srt' || format === 'vtt') && (
        <label>
          Subtitle language
          <input value={subtitleLang} onChange={(event) => setSubtitleLang(event.target.value)} />
        </label>
      )}
      <DownloadButton disabled={!videoId} loading={loading} onClick={() => void handleDownload()} />
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
