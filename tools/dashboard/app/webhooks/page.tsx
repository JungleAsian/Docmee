type PageProps = { searchParams?: { message?: string; error?: string } }

const scenarios = [
  {
    payload: 'text-message',
    title: 'Incoming patient message',
    description: 'Checks that Docmee can receive a normal WhatsApp text and start the conversation flow.',
    expected: 'A conversation is created and the assistant prepares a reply.',
    group: 'Messages'
  },
  {
    payload: 'voice-note',
    title: 'Voice note',
    description: 'Checks that a patient voice message is accepted for transcription handling.',
    expected: 'The voice note is queued for transcription.',
    group: 'Messages'
  },
  {
    payload: 'new-patient',
    title: 'New patient',
    description: 'Checks the first-time patient path.',
    expected: 'Docmee treats the sender as a new patient.',
    group: 'Patients'
  },
  {
    payload: 'returning-patient',
    title: 'Returning patient',
    description: 'Checks recognition for a patient who already exists.',
    expected: 'Docmee recognizes the patient and continues from existing context.',
    group: 'Patients'
  },
  {
    payload: 'booking-request',
    title: 'Book appointment',
    description: 'Checks the appointment request path.',
    expected: 'A scheduling request is created for review or automation.',
    group: 'Appointments'
  },
  {
    payload: 'reschedule-request',
    title: 'Reschedule appointment',
    description: 'Checks the appointment reschedule path.',
    expected: 'A reschedule request is created.',
    group: 'Appointments'
  },
  {
    payload: 'cancel-request',
    title: 'Cancel appointment',
    description: 'Checks the cancellation path.',
    expected: 'A cancellation request is captured.',
    group: 'Appointments'
  },
  {
    payload: 'emergency',
    title: 'Emergency message',
    description: 'Checks that urgent messages are routed away from normal automation.',
    expected: 'Human handoff is triggered or flagged.',
    group: 'Safety'
  },
  {
    payload: 'stop-optout',
    title: 'Stop messages',
    description: 'Checks opt-out handling when a patient asks to stop messages.',
    expected: 'The patient is marked as opted out.',
    group: 'Safety'
  }
]

const groups = Array.from(new Set(scenarios.map((scenario) => scenario.group)))

export default function WebhooksPage({ searchParams }: PageProps) {
  return (
    <section className="w-full">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Webhook Console</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            Run realistic service tests without editing JSON. Pick a scenario and DevTools sends the correct test event for you.
          </p>
        </div>
        <form action="/api/actions" method="post">
          <input type="hidden" name="action" value="webhook-send" />
          <input type="hidden" name="payload" value="text-message" />
          <button className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">
            Quick Test
          </button>
        </form>
      </div>

      {searchParams?.message && <p className="mt-3 rounded-md border border-emerald-700/60 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200">{searchParams.message}</p>}
      {searchParams?.error && <p className="mt-3 rounded-md border border-red-700/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">{searchParams.error}</p>}

      <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-5">
          {groups.map((group) => (
            <section key={group} className="rounded-md border border-slate-800 bg-slate-900 p-4">
              <h2 className="text-sm font-semibold">{group}</h2>
              <div className="mt-3 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {scenarios.filter((scenario) => scenario.group === group).map((scenario) => (
                  <form key={scenario.payload} action="/api/actions" method="post" className="rounded-md border border-slate-800 bg-slate-950/40 p-4">
                    <input type="hidden" name="action" value="webhook-send" />
                    <input type="hidden" name="payload" value={scenario.payload} />
                    <div className="flex min-h-full flex-col">
                      <div>
                        <h3 className="font-medium text-slate-100">{scenario.title}</h3>
                        <p className="mt-2 text-sm text-slate-400">{scenario.description}</p>
                        <p className="mt-3 rounded-md bg-slate-900 px-3 py-2 text-xs text-slate-300">
                          Expected: {scenario.expected}
                        </p>
                      </div>
                      <button className="mt-4 min-h-11 rounded-md bg-cyan-500 px-3 py-2 text-sm font-medium text-slate-950 hover:bg-cyan-400">
                        Run Test
                      </button>
                    </div>
                  </form>
                ))}
              </div>
            </section>
          ))}
        </div>

        <aside className="rounded-md border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-sm font-semibold">What This Checks</h2>
          <div className="mt-3 space-y-3 text-sm text-slate-400">
            <p>DevTools sends a safe sample event to the local Docmee webhook endpoint.</p>
            <p>No programming is needed. The payload is selected for you based on the test card.</p>
            <p>If a test fails, open Diagnostics or Settings to check the local API URL.</p>
          </div>
          <div className="mt-4 rounded-md border border-slate-800 bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Current target</div>
            <div className="mt-1 break-all text-sm text-slate-200">WEBHOOK_TARGET or local default</div>
          </div>
        </aside>
      </div>
    </section>
  )
}
