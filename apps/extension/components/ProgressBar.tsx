interface ProgressBarProps {
  progress: number
}

export function ProgressBar({ progress }: ProgressBarProps): JSX.Element {
  const safe = Math.min(100, Math.max(0, progress))
  return (
    <div>
      <div style={{ height: 8, background: '#e5e7eb', borderRadius: 8 }}>
        <div
          style={{
            height: '100%',
            width: `${safe}%`,
            borderRadius: 8,
            background: '#16a34a',
            transition: 'width 0.2s linear',
          }}
        />
      </div>
      <small>{safe.toFixed(1)}%</small>
    </div>
  )
}
