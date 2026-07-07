'use client'

type ClaudeDesignButtonProps = {
  prompt: string
  label?: string
  className?: string
  // Compact renders a small icon+label chip that sizes to its text (no fixed
  // min-width), so it fits inside dense table action cells without wrapping.
  compact?: boolean
  // autoRun hands the prompt straight to Claude Code via the devtool action,
  // which runs the design/improvement and commits — instead of copying the
  // prompt and opening claude.ai/design for a manual paste.
  autoRun?: boolean
}

export function ClaudeDesignButton({ prompt, label = 'Open Claude Design', className = '', compact = false, autoRun = false }: ClaudeDesignButtonProps) {
  const base = compact
    ? 'inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-cyan-500 px-2.5 py-1 text-xs font-semibold leading-none text-slate-950 hover:bg-cyan-400'
    : 'min-h-11 min-w-[8rem] rounded-md bg-cyan-500 px-4 py-2 text-sm font-semibold leading-tight text-slate-950 hover:bg-cyan-400'

  if (autoRun) {
    return (
      <form action="/api/actions" method="post" className={compact ? 'inline-flex' : ''}>
        <input type="hidden" name="action" value="claude-design-run" />
        <input type="hidden" name="prompt" value={prompt} />
        <button
          type="submit"
          className={`${base} ${className}`}
          title={`${label} — hands the prompt to Claude Code and runs the design now`}
          aria-label={label}
        >
          {compact && <span aria-hidden="true">✦</span>}
          <span>{label}</span>
        </button>
      </form>
    )
  }

  async function openClaudeDesign() {
    try {
      await navigator.clipboard.writeText(prompt)
    } catch {
      // Clipboard can be blocked by browser permissions; opening Claude Design is still useful.
    }
    window.open('https://claude.ai/design', '_blank', 'noopener,noreferrer')
  }

  return (
    <button
      type="button"
      onClick={openClaudeDesign}
      className={`${base} ${className}`}
      title={`${label} — copies the prompt, then opens Claude Design`}
      aria-label={label}
    >
      {compact && <span aria-hidden="true">✦</span>}
      <span>{label}</span>
    </button>
  )
}
