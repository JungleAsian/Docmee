# DevTools remote access over Tailscale (private HTTPS)

The DevTools dashboard is an **unauthenticated control plane** — `/api/actions`
spawns daemons, runs deploys, kills process trees, and rewrites `.env`. It must
never be reachable from the public internet. To use it from another of *your own*
devices, expose it over your **tailnet** with `tailscale serve` (private HTTPS),
not a public tunnel.

## Why Serve, not Funnel / ngrok / Cloudflare / `dev:mobile`

| Method | Reach | Verdict |
|---|---|---|
| `tailscale serve` | Your tailnet only | ✅ Use this |
| `tailscale funnel` | Public internet | ❌ Never for this tool |
| ngrok / Cloudflare Tunnel | Public internet | ❌ Public |
| `dev:mobile` (`-H 0.0.0.0`) | Whole LAN, plain HTTP | ❌ Disabled on purpose |

The dashboard stays bound to `127.0.0.1`; Serve terminates TLS and proxies in
over the tailnet. Keeping Next on loopback is what makes the identity gate sound
(see below) — **do not** run it on `0.0.0.0`.

## One-time tailnet setup (admin console — your steps)

1. Tailscale admin → enable **MagicDNS** and **HTTPS certificates**.
2. Tailscale admin → **ACLs**: restrict TCP `4000`/the served host to your own
   user/devices so no one else on the tailnet can reach it.

## Turning it on

```sh
# Start the dashboard (loopback only) as usual, then:
pnpm tool devtools serve     # tailscale serve --bg --https=443 http://127.0.0.1:4000
pnpm tool devtools status    # show the current Serve config + tailnet URL
pnpm tool devtools serve --off
```

It prints your URL, e.g. `https://<machine>.<tailnet>.ts.net`.

## The operator allowlist (required)

When reached over the tailnet, Tailscale injects an **authoritative**
`Tailscale-User-Login` header (a remote user can't forge it). The dashboard
middleware (`tools/dashboard/middleware.ts`):

- **allows** requests with **no** such header — those can only be local loopback
  (you, on this machine), because Next binds to `127.0.0.1`;
- **requires** any request that *has* the header to match
  `DEVTOOLS_ALLOWED_TS_USERS`, else returns **403** (fail-closed when the list is
  empty).

Set it before anyone else joins the tailnet:

```sh
# tools/dashboard/.env.local  (copy from .env.local.example), then restart
DEVTOOLS_ALLOWED_TS_USERS=you@example.com
```

> Until this is set, every tailnet request gets 403 — local `127.0.0.1` access is
> unaffected, so you can still work locally while you configure it.

## Threat model in one line

Serve narrows reach from "the internet" to "my tailnet"; the identity allowlist
narrows it further to "me", and the existing CSRF check stops cross-site drive-by
requests. A local process on this machine is already outside the trust boundary
(it has shell access), so loopback stays trusted.
