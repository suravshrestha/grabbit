import { useEffect, useState } from 'react'

export interface CurrentTabState {
  id?: number
  url?: string
  title?: string
}

export function useCurrentTab(): CurrentTabState {
  const [tab, setTab] = useState<CurrentTabState>({})

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const active = tabs[0]
      if (!active) {
        return
      }

      setTab({
        id: active.id,
        url: active.url,
        title: active.title,
      })
    })
  }, [])

  return tab
}
