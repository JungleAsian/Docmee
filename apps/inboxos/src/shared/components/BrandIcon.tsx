export type BrandIconName =
  | 'whatsapp'
  | 'meta'
  | 'facebook'
  | 'instagram'
  | 'google'
  | 'googleCalendar'
  | 'googleDrive'
  | 'googleSheets'
  | 'email'
  | 'openai'
  | 'chatgpt'
  | 'anthropic'
  | 'claude'
  | 'gemini'
  | 'customAi'
  | 'n8n'

const WRAP: Record<BrandIconName, string> = {
  whatsapp: 'bg-[#25D366] text-white',
  meta: 'bg-[#0866FF] text-white',
  facebook: 'bg-[#1877F2] text-white',
  instagram: 'bg-gradient-to-br from-[#f58529] via-[#dd2a7b] to-[#8134af] text-white',
  google: 'bg-white text-gray-700 ring-1 ring-gray-200 dark:bg-gray-950 dark:text-gray-100 dark:ring-gray-700',
  googleCalendar: 'bg-white text-gray-700 ring-1 ring-gray-200 dark:bg-gray-950 dark:text-gray-100 dark:ring-gray-700',
  googleDrive: 'bg-white text-gray-700 ring-1 ring-gray-200 dark:bg-gray-950 dark:text-gray-100 dark:ring-gray-700',
  googleSheets: 'bg-white text-gray-700 ring-1 ring-gray-200 dark:bg-gray-950 dark:text-gray-100 dark:ring-gray-700',
  email: 'bg-white text-gray-700 ring-1 ring-gray-200 dark:bg-gray-950 dark:text-gray-100 dark:ring-gray-700',
  openai: 'bg-gray-950 text-white dark:bg-white dark:text-gray-950',
  chatgpt: 'bg-[#10A37F] text-white',
  anthropic: 'bg-[#D8C7B3] text-[#191919]',
  claude: 'bg-[#D8C7B3] text-[#191919]',
  gemini: 'bg-white text-[#4285F4] ring-1 ring-gray-200 dark:bg-gray-950 dark:ring-gray-700',
  customAi: 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-950',
  n8n: 'bg-white text-[#FF6D5A] ring-1 ring-[#FF6D5A]/30 dark:bg-gray-950 dark:text-[#FF6D5A] dark:ring-[#FF6D5A]/40',
}

export function BrandIcon({
  name,
  className = 'h-8 w-8',
}: {
  name: BrandIconName
  className?: string
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-md ${WRAP[name]} ${className}`}
      aria-hidden="true"
    >
      <BrandGlyph name={name} />
    </span>
  )
}

function BrandGlyph({ name }: { name: BrandIconName }) {
  if (name === 'whatsapp') {
    return (
      <svg className="h-[19px] w-[19px]" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12.04 2A9.9 9.9 0 0 0 3.5 16.9L2.2 22l5.2-1.36A9.94 9.94 0 1 0 12.04 2Zm0 18.22a8.22 8.22 0 0 1-4.2-1.15l-.3-.18-3.08.8.82-3-.2-.31a8.24 8.24 0 1 1 6.96 3.84Zm4.52-6.16c-.25-.12-1.46-.72-1.69-.8-.23-.09-.4-.13-.56.12-.17.25-.64.8-.78.96-.14.17-.29.19-.54.07a6.72 6.72 0 0 1-3.35-2.93c-.25-.43.25-.4.72-1.33.08-.17.04-.31-.02-.43-.06-.13-.56-1.35-.77-1.84-.2-.48-.41-.41-.56-.42h-.48c-.17 0-.43.06-.66.31-.23.25-.87.85-.87 2.07s.89 2.4 1.01 2.57c.12.17 1.75 2.67 4.24 3.75.59.25 1.06.4 1.42.52.6.19 1.14.16 1.57.1.48-.07 1.46-.6 1.67-1.17.2-.58.2-1.07.14-1.17-.06-.11-.23-.17-.48-.29Z" />
      </svg>
    )
  }
  if (name === 'facebook') {
    return <span className="font-sans text-2xl font-bold leading-none">f</span>
  }
  if (name === 'instagram') {
    return (
      <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="4" width="16" height="16" rx="5" />
        <circle cx="12" cy="12" r="3.2" />
        <path d="M17.5 6.8h.01" />
      </svg>
    )
  }
  if (name === 'meta') {
    return (
      <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 15c1.7-5.3 3.7-8 6-8 1.4 0 2.7 1 4 3l1 1.5c1.2 1.8 2.2 2.5 3.2 2.5 1.4 0 2.5-1.2 2.8-3" />
        <path d="M20 9c-1.7 5.3-3.7 8-6 8-1.4 0-2.7-1-4-3l-1-1.5C7.8 10.7 6.8 10 5.8 10 4.4 10 3.3 11.2 3 14" />
      </svg>
    )
  }
  if (name === 'google' || name === 'googleCalendar' || name === 'googleDrive' || name === 'googleSheets') {
    if (name === 'google') {
      return (
        <svg className="h-[19px] w-[19px]" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
          <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.57 10.57 0 0 0 12 1 11 11 0 0 0 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38Z" />
        </svg>
      )
    }
    if (name === 'googleCalendar') {
      return (
        <svg className="h-[20px] w-[20px]" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#FFFFFF" d="M4 4h16v16H4z" />
          <path fill="#4285F4" d="M4 4h16v4H4z" />
          <path fill="#34A853" d="M4 8h4v12H4z" />
          <path fill="#FBBC05" d="M16 8h4v12h-4z" />
          <path fill="#EA4335" d="M8 16h8v4H8z" />
          <path fill="#1A73E8" d="M8 8h8v8H8z" opacity=".08" />
          <text x="12" y="15.2" textAnchor="middle" className="fill-[#3c4043] text-[7px] font-bold">31</text>
        </svg>
      )
    }
    if (name === 'googleDrive') {
      return (
        <svg className="h-[20px] w-[20px]" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#1E88E5" d="M8.05 4h7.9l5.45 9.43h-7.9L8.05 4Z" />
          <path fill="#43A047" d="M2.6 13.43 8.05 4l3.95 6.84-5.45 9.44L2.6 13.43Z" />
          <path fill="#FBC02D" d="M6.55 20.28 12 10.84h7.9l-5.45 9.44h-7.9Z" />
          <path fill="#1565C0" d="M13.5 13.43h7.9l-1.5-2.59H12l1.5 2.59Z" opacity=".9" />
          <path fill="#2E7D32" d="m8.05 4 3.95 6.84-1.5 2.59-3.95-6.85L8.05 4Z" opacity=".85" />
        </svg>
      )
    }
    return (
      <svg className="h-[20px] w-[20px]" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#0F9D58" d="M6 2h8l4 4v16H6z" />
        <path fill="#87CEAC" d="M14 2v5h5z" />
        <path fill="#FFFFFF" d="M8.5 10h7v1.6h-7zm0 3.2h7v1.6h-7zm0 3.2h7v1.6h-7z" />
        <path fill="#FFFFFF" d="M10.4 9.4H12v9h-1.6z" opacity=".85" />
      </svg>
    )
  }
  if (name === 'email') {
    return (
      <svg className="h-[20px] w-[20px]" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#EA4335" d="M3 6.5 12 13l9-6.5V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <path fill="#FBBC04" d="M3 6.5 12 13v4.5L3 11z" />
        <path fill="#34A853" d="M21 6.5 12 13v4.5l9-6.5z" />
        <path fill="#4285F4" d="M5 4h14a2 2 0 0 1 2 2v.5L12 13 3 6.5V6a2 2 0 0 1 2-2Z" />
        <path fill="#C5221F" d="M3 6.5 12 13l-2.1 1.55L3 9.55z" opacity=".9" />
      </svg>
    )
  }
  if (name === 'openai' || name === 'chatgpt') {
    return (
      <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3.2a3.4 3.4 0 0 1 3.3 4.2 3.4 3.4 0 0 1 4 4.5 3.4 3.4 0 0 1-1.8 6 3.4 3.4 0 0 1-5.5 2.4 3.4 3.4 0 0 1-5.3-3.8 3.4 3.4 0 0 1-2-5.6 3.4 3.4 0 0 1 3.8-4.8A3.4 3.4 0 0 1 12 3.2Z" />
        <path d="M8.5 6.2 15 10v7.6" />
        <path d="m18.5 11.4-6.5 3.7-6.5-3.7" />
        <path d="M8.5 17.8V10.3L15 6.6" />
      </svg>
    )
  }
  if (name === 'anthropic' || name === 'claude') {
    return (
      <svg className="h-[19px] w-[19px]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M13.46 3.4 21 20.6h-4.35l-1.42-3.5H8.65l-1.42 3.5H3L10.42 3.4h3.04Zm.38 10.2-1.9-4.7-1.9 4.7h3.8Z" />
        <path d="M16.95 3.4h3.95v17.2h-3.95V3.4Z" opacity=".88" />
      </svg>
    )
  }
  if (name === 'gemini') {
    return (
      <svg className="h-[19px] w-[19px]" viewBox="0 0 24 24" fill="none">
        <path d="M12 2.8c1.2 4.1 3.1 6 7.2 7.2-4.1 1.2-6 3.1-7.2 7.2C10.8 13.1 8.9 11.2 4.8 10 8.9 8.8 10.8 6.9 12 2.8Z" fill="#4285F4" />
        <path d="M17.2 14.2c.6 2 1.6 3 3.6 3.6-2 .6-3 1.6-3.6 3.6-.6-2-1.6-3-3.6-3.6 2-.6 3-1.6 3.6-3.6Z" fill="#A142F4" />
      </svg>
    )
  }
  if (name === 'customAi') return <span className="text-[10px] font-black">API</span>
  return (
    <svg className="h-[22px] w-[22px]" viewBox="0 0 48 24" fill="none" aria-hidden="true">
      <circle cx="7" cy="12" r="4" stroke="currentColor" strokeWidth="3" />
      <circle cx="24" cy="7" r="4" stroke="currentColor" strokeWidth="3" />
      <circle cx="24" cy="17" r="4" stroke="currentColor" strokeWidth="3" />
      <path d="M11 12h6.2c1.6 0 2.9-1.1 3.4-2.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M11 12h6.2c1.6 0 2.9 1.1 3.4 2.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <text x="31" y="15.5" fill="currentColor" fontFamily="Inter, Arial, sans-serif" fontSize="10" fontWeight="800">n8n</text>
    </svg>
  )
}
