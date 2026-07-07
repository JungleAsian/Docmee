'use client'

import { useEffect } from 'react'

export function FormSubmitFeedback() {
  useEffect(() => {
    function onSubmit(event: SubmitEvent) {
      const form = event.target instanceof HTMLFormElement ? event.target : null
      if (!form || form.dataset.noPending === 'true') return

      const submitter = event.submitter instanceof HTMLElement ? event.submitter : null
      form.dataset.devtoolsPending = 'true'

      if (submitter instanceof HTMLButtonElement) {
        submitter.dataset.wasEnabled = 'true'
        submitter.dataset.originalText = submitter.textContent ?? ''
        submitter.textContent = submitter.dataset.pendingText || 'Working...'
        submitter.setAttribute('aria-busy', 'true')
        submitter.classList.add('devtools-button-working')
      }

      window.setTimeout(() => {
        if (!form.isConnected) return
        form.dataset.devtoolsPending = 'false'
        if (submitter instanceof HTMLButtonElement) {
          submitter.textContent = submitter.dataset.originalText || submitter.textContent
          submitter.removeAttribute('aria-busy')
          submitter.classList.remove('devtools-button-working')
        }
      }, 60000)
    }

    window.addEventListener('submit', onSubmit, true)
    return () => window.removeEventListener('submit', onSubmit, true)
  }, [])

  return null
}
