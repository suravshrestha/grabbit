import { defineBackground } from '#imports'
import { checkDesktopHealth, fetchVideoInfo } from '@/lib/ipc'
import { MESSAGE_TYPES } from '@/lib/constants'

interface ExtensionMessage {
  type: string
  videoId?: string
}

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender: chrome.runtime.MessageSender, sendResponse): boolean => {
    if (message.type === MESSAGE_TYPES.CHECK_DESKTOP_APP) {
      void checkDesktopHealth().then((isRunning) => {
        sendResponse({ isRunning })
      })
      return true
    }

    if (message.type === MESSAGE_TYPES.GET_VIDEO_INFO && message.videoId) {
      void fetchVideoInfo(message.videoId)
        .then((info) => sendResponse({ info }))
        .catch((error: unknown) => {
          const value = error instanceof Error ? error.message : 'Failed to fetch video info'
          sendResponse({ error: value })
        })
      return true
    }

    sendResponse({ error: 'Unsupported message type' })
    return false
  },
)

void chrome.alarms.create('grabbit-keep-alive', { periodInMinutes: 1 })
chrome.alarms.onAlarm.addListener(() => {
  void chrome.runtime.getPlatformInfo()
})

export default defineBackground(() => {})
