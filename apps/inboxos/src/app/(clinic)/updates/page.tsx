'use client'

import { useState } from 'react'
import { ProductUpdatesPageContent, type ProductUpdatesTab } from '@/shared/components/ProductUpdatesPageContent'
import { useI18n } from '@/shared/hooks/useI18n'
import { featuresForRole, updatesForRole } from '@/shared/productUpdates'
import { useAuthStore } from '@/shared/store/auth'

export default function ProductUpdatesPage() {
  const { language } = useI18n()
  const role = useAuthStore((state) => state.user?.role)
  const [activeTab, setActiveTab] = useState<ProductUpdatesTab>('updates')

  return (
    <ProductUpdatesPageContent
      language={language}
      activeTab={activeTab}
      releases={updatesForRole(role)}
      features={featuresForRole(role)}
      onTabChange={setActiveTab}
    />
  )
}
