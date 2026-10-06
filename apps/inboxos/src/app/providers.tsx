'use client'

// Client-side providers shared by every route: a single TanStack Query client.
import { useState } from 'react'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { InactivityLogout } from '@/shared/components/InactivityLogout'

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => {
    const queryClient: QueryClient = new QueryClient({
      // Any successful save may introduce (or fix) a setup problem: refresh the
      // admin setup banner right away instead of waiting for the next focus.
      mutationCache: new MutationCache({
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: ['setup-check'] })
        },
      }),
      defaultOptions: {
        queries: {
          // Inbox data is short-lived; refetch on focus and tolerate brief staleness.
          staleTime: 5_000,
          retry: 1,
          refetchOnWindowFocus: true,
        },
      },
    })
    return queryClient
  })
  return (
    <QueryClientProvider client={client}>
      <InactivityLogout />
      {children}
    </QueryClientProvider>
  )
}
