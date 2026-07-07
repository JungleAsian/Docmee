import Link from 'next/link'

export default function NotFound() {
  return (
    <section className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-center justify-center text-center">
      <p className="text-6xl font-semibold tracking-tight text-cyan-300">404</p>
      <h1 className="mt-4 text-xl font-semibold text-slate-100">Page not found</h1>
      <p className="mt-2 text-sm leading-6 text-slate-400">
        This DevTools route doesn&apos;t exist or has moved. Use the navigation, or jump back to the dashboard.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Link
          href="/docmee-deployment"
          className="min-h-11 rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500"
        >
          Back to dashboard
        </Link>
        <Link
          href="/ready"
          className="min-h-11 rounded-md border border-slate-700 px-4 py-2 text-sm text-sky-300 hover:bg-slate-800"
        >
          Open Ready
        </Link>
      </div>
    </section>
  )
}
