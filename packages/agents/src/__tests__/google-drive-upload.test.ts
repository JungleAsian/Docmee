import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const create = vi.hoisted(() => vi.fn())

vi.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: class { setCredentials() {} on() {} } },
    drive: () => ({ files: { create } }),
  },
}))

import { createGoogleDriveOps } from '../drive/google-drive-client.js'

describe('Google Drive create-only upload', () => {
  beforeEach(() => {
    create.mockReset()
    create.mockResolvedValue({
      data: {
        id: 'drive-new', name: 'scan.png', mimeType: 'image/png', size: '8',
        modifiedTime: '2026-09-05T12:00:00.000Z', webViewLink: 'https://drive.google.com/file/d/drive-new/view',
      },
    })
  })

  it('creates one new file from a stream and returns normalized metadata', async () => {
    const ops = createGoogleDriveOps({ accessToken: 'at', refreshToken: 'rt' })
    const result = await ops.uploadFile({
      name: 'scan.png', mimeType: 'image/png', body: Readable.from([Buffer.from('12345678')]),
    })

    expect(result).toEqual({
      id: 'drive-new', name: 'scan.png', mimeType: 'image/png', byteSize: 8,
      modifiedTime: '2026-09-05T12:00:00.000Z', webViewLink: 'https://drive.google.com/file/d/drive-new/view',
    })
    expect(create).toHaveBeenCalledWith({
      requestBody: { name: 'scan.png' },
      media: { mimeType: 'image/png', body: expect.any(Readable) },
      fields: 'id,name,mimeType,size,modifiedTime,webViewLink',
    })
  })
})
