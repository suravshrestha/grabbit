import { CheckCircle2, CircleAlert, Info } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

interface StatusMessageProps {
  message: string
  tone?: 'info' | 'error' | 'success'
}

export function StatusMessage({ message, tone = 'info' }: StatusMessageProps): JSX.Element {
  if (tone === 'error') {
    return (
      <Alert variant="destructive" className="border-destructive/30 bg-destructive/5">
        <CircleAlert />
        <AlertTitle>Action needed</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    )
  }

  if (tone === 'success') {
    return (
      <Alert className="border-green-200 bg-green-50 text-green-900">
        <CheckCircle2 className="text-green-700" />
        <AlertTitle>Done</AlertTitle>
        <AlertDescription className="text-green-800">{message}</AlertDescription>
      </Alert>
    )
  }

  return (
    <Alert className="border-blue-200 bg-blue-50 text-blue-900">
      <Info className="text-blue-700" />
      <AlertTitle>Info</AlertTitle>
      <AlertDescription className="text-blue-800">{message}</AlertDescription>
    </Alert>
  )
}
