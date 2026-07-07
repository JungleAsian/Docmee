interface DocmeeLoaderProps {
  label?: string
  fullScreen?: boolean
}

export function DocmeeLoader({ label = 'Loading Docmee', fullScreen = false }: DocmeeLoaderProps) {
  return (
    <div className={fullScreen ? 'docmee-loader docmee-loader-full' : 'docmee-loader'} role="status" aria-live="polite">
      <div className="docmee-loader-avatar" aria-hidden="true" />
      <div className="docmee-loader-copy">
        <p className="docmee-loader-brand">Docmee</p>
        <p className="docmee-loader-label">{label}</p>
      </div>
    </div>
  )
}
