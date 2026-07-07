'use client'

// Client-side providers shared by every route: a single TanStack Query client.
import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { InactivityLogout } from '@/shared/components/InactivityLogout'

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Inbox data is short-lived; refetch on focus and tolerate brief staleness.
            staleTime: 5_000,
            retry: 1,
            refetchOnWindowFocus: true,
          },
        },
      }),
  )
  return (
    <QueryClientProvider client={client}>
      <InactivityLogout />
      {children}
    </QueryClientProvider>
  )
}
