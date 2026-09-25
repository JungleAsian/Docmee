import { notFound } from 'next/navigation'
import { WorkflowCanvasDemo } from '@/shared/components/workflow/WorkflowCanvasDemo'

export const dynamic = 'force-dynamic'

export default function WorkflowCanvasPreviewPage() {
  if (process.env.NODE_ENV !== 'development' && process.env.DOCMEE_CANVAS_PREVIEW !== '1') notFound()
  return <WorkflowCanvasDemo />
}
