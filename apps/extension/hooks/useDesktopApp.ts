import { useEffect, useState } from 'react'
import type { DesktopHealth } from '@/types'
import { checkDesktopHealth } from '@/lib/ipc'

const DESKTOP_HEALTH_POLL_MS = 2000

const DEFAULT_HEALTH: DesktopHealth = {
  reachable: false,
  engineState: 'unavailable',
  message: 'Start the Grabbit desktop app to continue.',
}

export function useDesktopApp(): DesktopHealth {
  const [health, setHealth] = useState<DesktopHealth>(DEFAULT_HEALTH)

  useEffect(() => {
    let cancelled = false

    const loadHealth = async (): Promise<void> => {
      const nextHealth = await checkDesktopHealth()
      if (!cancelled) {
        setHealth(nextHealth)
      }
    }

    void loadHealth()
    const timer = window.setInterval(() => {
      void loadHealth()
    }, DESKTOP_HEALTH_POLL_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  return health
}
