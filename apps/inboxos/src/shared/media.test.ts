import { describe, it, expect } from 'vitest'
import { isImageMessage, messageMediaPath } from './media'

describe('media helpers (Req 3)', () => {
  it('isImageMessage is true only for image content', () => {
    expect(isImageMessage({ contentType: 'image' })).toBe(true)
    expect(isImageMessage({ contentType: 'text' })).toBe(false)
    expect(isImageMessage({ contentType: 'audio' })).toBe(false)
    expect(isImageMessage({ contentType: 'interactive' })).toBe(false)
  })

  it('messageMediaPath builds the authenticated proxy path', () => {
    expect(messageMediaPath('conv-1', 'msg-9')).toBe('/conversations/conv-1/messages/msg-9/media')
  })
})
