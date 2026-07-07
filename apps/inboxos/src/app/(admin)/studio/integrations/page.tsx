'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function IntegrationsPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/studio/channels')
  }, [router])

  return (
    <div className="clinic-page clinic-page-md">
      <p className="text-sm text-gray-500">Opening Channels & Integrations...</p>
    </div>
  )
}
