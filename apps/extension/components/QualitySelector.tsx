interface QualitySelectorProps {
  value: '720p' | '1080p' | '4k' | 'best'
  onChange: (quality: '720p' | '1080p' | '4k' | 'best') => void
}

export function QualitySelector({ value, onChange }: QualitySelectorProps): JSX.Element {
  return (
    <label>
      Quality
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as '720p' | '1080p' | '4k' | 'best')}
      >
        <option value="720p">720p</option>
        <option value="1080p">1080p</option>
        <option value="4k">4K</option>
        <option value="best">Best</option>
      </select>
    </label>
  )
}
