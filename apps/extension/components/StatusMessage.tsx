import { CheckCircle2, CircleAlert, Info } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface StatusMessageProps {
  message: string
  tone?: 'info' | 'error' | 'success'
}

export function StatusMessage({ message, tone = 'info' }: StatusMessageProps): JSX.Element {
  if (tone === 'error') {
    return (
      <Alert variant="destructive" className="border-destructive/30 bg-destructive/5">
        <CircleAlert />
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    )
  }

  if (tone === 'success') {
    return (
      <Alert className="border-success/40 bg-success/20 text-success-foreground">
        <CheckCircle2 className="text-success-foreground" />
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    )
  }

  return (
    <Alert className="border-info/40 bg-info/20 text-info-foreground">
      <Info className="text-info-foreground" />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}
