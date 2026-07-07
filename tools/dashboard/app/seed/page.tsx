type PageProps = {
  searchParams?: { message?: string; error?: string }
}

const seeds = [
  ['clinic', 'Seed Clinics'],
  ['patient', 'Seed Patients'],
  ['conversation', 'Seed Conversations'],
  ['all', 'Seed All']
]

export default function SeedPage({ searchParams }: PageProps) {
  return (
    <section className="w-full">
      <h1 className="text-2xl font-semibold">Seed Generator</h1>
      {searchParams?.message && <p className="mt-2 text-sm text-emerald-300">{searchParams.message}</p>}
      {searchParams?.error && <p className="mt-2 text-sm text-red-300">{searchParams.error}</p>}
      <div className="mt-5 rounded-md border border-amber-700 bg-amber-950/50 p-4 text-sm text-amber-100">Local/dev seed data only. Do not use production data.</div>
      <div className="mt-5 flex flex-wrap gap-3">
        {seeds.map(([kind, label]) => (
          <form key={kind} action="/api/actions" method="post">
            <input type="hidden" name="action" value="seed" />
            <input type="hidden" name="kind" value={kind} />
            <button className="rounded-md border border-slate-700 px-3 py-2">{label}</button>
          </form>
        ))}
      </div>
      <pre className="mt-5 rounded-lg border border-slate-800 bg-black p-4 text-sm">Seed IDs are written to /tools/logs/seed-YYYY-MM-DD.json.</pre>
    </section>
  )
}
