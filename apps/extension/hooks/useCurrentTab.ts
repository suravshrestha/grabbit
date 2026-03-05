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

      const next: CurrentTabState = {}
      if (active.id !== undefined) {
        next.id = active.id
      }
      if (active.url !== undefined) {
        next.url = active.url
      }
      if (active.title !== undefined) {
        next.title = active.title
      }
      setTab(next)
    })
  }, [])

  return tab
}
