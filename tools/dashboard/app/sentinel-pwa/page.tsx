import { redirect } from 'next/navigation'

export default function SentinelPwaRedirect() {
  redirect('/sentinel-pwa/index.html')
}
