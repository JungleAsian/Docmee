'use client'

type PillToggleSize = 'sm' | 'md'

interface PillToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
  size?: PillToggleSize
  className?: string
  onLabel?: string
  offLabel?: string
}

export function PillToggle({
  checked,
  onChange,
  label,
  disabled = false,
  size = 'md',
  className = '',
  onLabel = 'On',
  offLabel = 'Off',
}: PillToggleProps) {
  const trackSize = size === 'sm' ? 'h-7 w-[4.5rem] text-[10px]' : 'h-8 w-[5.25rem] text-[11px]'
  const knobSize = size === 'sm' ? 'h-5 w-5' : 'h-6 w-6'
  const knobOffset = size === 'sm' ? 'translate-x-[2.25rem]' : 'translate-x-[2.75rem]'

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex ${trackSize} shrink-0 items-center rounded-full border px-1 font-semibold uppercase tracking-wide transition focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-offset-gray-950 ${
        checked
          ? 'border-teal-600 bg-teal-600 text-white shadow-sm shadow-teal-500/20 dark:border-teal-400 dark:bg-teal-500'
          : 'border-gray-300 bg-gray-100 text-gray-700 shadow-sm dark:border-gray-600 dark:bg-gray-700/90 dark:text-gray-100'
      } ${className}`}
    >
      <span
        aria-hidden="true"
        className={`absolute left-1 top-1/2 ${knobSize} -translate-y-1/2 rounded-full bg-white shadow-sm ring-1 ring-black/10 transition-transform ${
          checked ? knobOffset : 'translate-x-0'
        }`}
      />
      <span
        aria-hidden="true"
        className={`relative z-10 flex w-full items-center ${
          checked ? 'justify-start pl-1 pr-7' : 'justify-end pl-7 pr-1'
        }`}
      >
        {checked ? onLabel : offLabel}
      </span>
      <span className="sr-only">
        {checked ? onLabel : offLabel}
      </span>
    </button>
  )
}
