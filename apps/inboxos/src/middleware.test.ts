import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from './middleware'

describe('authenticated route middleware', () => {
  it('redirects an anonymous product-updates request to login', () => {
    const response = middleware(new NextRequest('https://app.docmee.test/updates'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://app.docmee.test/login?next=%2Fupdates')
  })

  it('allows an authenticated product-updates request', () => {
    const request = new NextRequest('https://app.docmee.test/updates', {
      headers: { cookie: 'docmee-session=1' },
    })

    expect(middleware(request).headers.get('location')).toBeNull()
  })
})
