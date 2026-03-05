const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'])

export function extractVideoId(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    if (!YOUTUBE_HOSTS.has(url.hostname)) {
      return null
    }

    if (url.hostname === 'youtu.be') {
      return url.pathname.replace('/', '') || null
    }

    return url.searchParams.get('v')
  } catch {
    return null
  }
}

export function isYoutubeWatchUrl(rawUrl: string): boolean {
  return extractVideoId(rawUrl) !== null
}
