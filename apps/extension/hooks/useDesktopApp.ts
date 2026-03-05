import { useEffect, useState } from 'react'
import { checkDesktopHealth } from '@/lib/ipc'

export function useDesktopApp(): boolean {
  const [isRunning, setIsRunning] = useState(false)

  useEffect(() => {
    void (async (): Promise<void> => {
      const healthy = await checkDesktopHealth()
      setIsRunning(healthy)
    })()
  }, [])

  return isRunning
}
