'use client'

// Entry redirect: route the user to their default surface once the auth store has
// hydrated — Admin Studio admins land in /studio, everyone else in /inbox.
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/shared/store/auth'
import { DocmeeLoader } from '@/shared/components/DocmeeLoader'

export default function Page() {
  const router = useRouter()
  const hydrated = useAuthStore((s) => s.hydrated)
  const user = useAuthStore((s) => s.user)
  const accessToken = useAuthStore((s) => s.accessToken)

  useEffect(() => {
    if (!hydrated) return
    if (!accessToken || !user) {
      router.replace('/login')
    } else if (user.role === 'ia_studio_admin') {
      router.replace('/studio/clinics')
    } else {
      router.replace('/inbox')
    }
  }, [hydrated, accessToken, user, router])

  return <DocmeeLoader label="Opening your workspace" fullScreen />
}
