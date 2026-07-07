// Two-step WhatsApp Cloud API media fetch (Req 3). Mirrors @docmee/channels
// media-downloader, inlined here so apps/api needn't depend on the channels
// package: resolve the short-lived media URL, then download the binary. Both
// calls are bearer-gated. Used by the authenticated inbox media proxy so a
// secretary can view a patient's image without the bytes ever being stored.

const GRAPH_API_VERSION = process.env['META_GRAPH_API_VERSION'] || 'v24.0'

export interface FetchedMedia {
  buffer: ArrayBuffer
  mimeType: string
}

export async function fetchWhatsAppMedia(
  mediaId: string,
  accessToken: string,
): Promise<FetchedMedia> {
  // Step 1: resolve the short-lived media URL.
  const urlRes = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!urlRes.ok) throw new Error(`Media URL fetch failed: ${urlRes.status}`)
  const { url, mime_type: mimeType } = (await urlRes.json()) as { url: string; mime_type: string }

  // Step 2: download the binary (the lookup URL also requires the bearer token).
  const mediaRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!mediaRes.ok) throw new Error(`Media download failed: ${mediaRes.status}`)

  return { buffer: await mediaRes.arrayBuffer(), mimeType }
}
