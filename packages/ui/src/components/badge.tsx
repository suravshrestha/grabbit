import type { ReactNode } from 'react'

interface BadgeProps {
  children: ReactNode
}

export function Badge({ children }: BadgeProps): JSX.Element {
  return <span className="grabbit-badge">{children}</span>
}
