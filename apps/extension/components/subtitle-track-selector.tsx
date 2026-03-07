import type { SubtitleTrack } from '@grabbit/shared-types'

interface SubtitleTrackSelectorProps {
  tracks: SubtitleTrack[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

function toTrackValue(track: SubtitleTrack): string {
  return `${track.source}:${track.lang}`
}

function getTrackLabel(track: SubtitleTrack): string {
  return `${track.name} (${track.lang})${track.source === 'auto' ? ' • Auto' : ''}`
}

export function SubtitleTrackSelector({
  tracks,
  value,
  onChange,
  disabled,
}: SubtitleTrackSelectorProps): JSX.Element {
  return (
    <div className="grid gap-2">
      <label className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
        Subtitle Track
      </label>
      <select
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="styled-select border-input bg-card shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 py-2 text-sm outline-none transition-[color,box-shadow] focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {tracks.map((track) => (
          <option key={toTrackValue(track)} value={toTrackValue(track)}>
            {getTrackLabel(track)}
          </option>
        ))}
      </select>
    </div>
  )
}
