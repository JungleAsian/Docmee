import type { Metadata, Viewport } from 'next'
import { Inter, Manrope } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import { ServiceWorkerRegister } from './sw-register'
import { HtmlLangSync } from './html-lang-sync'
import { ThemeInitScript } from '@/shared/components/ThemeInitScript'
import { DocmeePet } from '@/shared/components/DocmeePet'
import { AppFooter } from '@/shared/components/AppFooter'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

const manrope = Manrope({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-manrope',
})

export const metadata: Metadata = {
  title: 'Docmee InboxOS',
  description: 'Clinic messaging inbox',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, title: 'Docmee', statusBarStyle: 'default' },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#3b82f6',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <ThemeInitScript />
      </head>
      <body className={`${inter.className} ${manrope.variable} min-h-screen bg-[var(--crm-bg-color)] text-[var(--crm-text-main)]`}>
        <Providers>
          <HtmlLangSync />
          {children}
          <div className="docmee-root-footer">
            <AppFooter />
          </div>
          {/* Floating J.zel assistant — mounted at the root so it appears on every page. */}
          <DocmeePet />
        </Providers>
        <ServiceWorkerRegister />
      </body>
    </html>
  )
}
