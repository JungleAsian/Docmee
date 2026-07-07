import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/ui/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
} satisfies Config
