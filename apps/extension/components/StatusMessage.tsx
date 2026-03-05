interface StatusMessageProps {
  message: string
  tone?: 'info' | 'error' | 'success'
}

export function StatusMessage({ message, tone = 'info' }: StatusMessageProps): JSX.Element {
  const color = tone === 'error' ? '#b91c1c' : tone === 'success' ? '#166534' : '#1d4ed8'
  return <p style={{ color, marginTop: 8 }}>{message}</p>
}
