import type { SubtitleTrack } from '@grabbit/shared-types'

interface SubtitleTrackSelectorProps {
  tracks: SubtitleTrack[]
  value: string
  onChange: (value: string) => void
}

function toTrackValue(track: SubtitleTrack): string {
  return `${track.source}:${track.lang}`
}

export function SubtitleTrackSelector({
  tracks,
  value,
  onChange,
}: SubtitleTrackSelectorProps): JSX.Element {
  return (
    <label>
      Subtitle track
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {tracks.map((track) => (
          <option key={toTrackValue(track)} value={toTrackValue(track)}>
            {track.name} ({track.lang})
          </option>
        ))}
      </select>
    </label>
  )
}
