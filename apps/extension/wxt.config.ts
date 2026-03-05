import { defineConfig } from 'wxt'

export default defineConfig({
  extensionApi: 'chrome',
  manifest: {
    name: 'Grabbit',
    description: 'Download YouTube videos, audio, and subtitles through Grabbit desktop.',
    permissions: ['tabs', 'cookies', 'activeTab', 'alarms'],
    host_permissions: ['*://*.youtube.com/*', 'http://localhost:47891/*'],
    action: {
      default_title: 'Grabbit',
      default_popup: 'entrypoints/popup/index.html',
    },
  },
  vite: () => ({
    resolve: {
      alias: {
        '@': new URL('./', import.meta.url).pathname,
      },
    },
  }),
})
