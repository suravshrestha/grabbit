import { defineContentScript } from '#imports'
import { MESSAGE_TYPES } from '@/lib/constants'

interface YoutubeInitialData {
  videoDetails?: {
    title?: string
    videoId?: string
  }
}

export default defineContentScript({
  matches: ['*://www.youtube.com/watch*'],
  main(): void {
    const unsafeWindow = window as Window & { ytInitialData?: YoutubeInitialData }
    const initialData = unsafeWindow.ytInitialData
    const payload = {
      title: initialData?.videoDetails?.title,
      videoId: initialData?.videoDetails?.videoId,
    }

    void chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.CONTENT_VIDEO_METADATA,
      payload,
    })
  },
})
