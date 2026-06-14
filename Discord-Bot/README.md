# Docmee Discord Status Bot

Posts two hourly status updates to Discord, as a real bot, with no token cost:

| Channel (you choose) | Audience | Content |
|---|---|---|
| `#docmee-eng` (tech) | Engineers | Gates, Sprint-0 tickets, recent commits, security action plan, open delivery items, code-scan drift |
| `#docmee-team` (team) | Non-technical colleagues | Plain-language progress, what's done / in progress, security in friendly terms, what we're waiting on |

It reads the **same data the dashboards already use** — the tracker xlsx (via
`Dashboard/build_dashboard.py`), `Security-Command-Center/findings.json`, and
`scan-state.json` — so there's a single source of truth. It posts **only when
something changed**, so the hourly schedule never spams the channels.

---

## One-time setup

### 1. Create the bot
1. Go to <https://discord.com/developers/applications> → **New Application** (name it e.g. "Docmee Status").
2. Open the **Bot** tab → **Reset Token** → **Copy** the token.
3. Open **OAuth2 → URL Generator** → tick scope **`bot`** → under permissions tick **Send Messages** (and **Embed Links**).
4. Open the generated URL at the bottom and invite the bot to your Docmee server.

### 2. Get the two channel IDs
In Discord: **User Settings → Advanced → Developer Mode = ON**. Then right-click
each target channel → **Copy Channel ID**. Make sure the bot can see both channels.

### 3. Configure
```powershell
cd C:\Users\Mikazuki\Desktop\Docmee\Discord-Bot
Copy-Item .env.example .env
notepad .env   # paste the token + the two channel IDs
```

### 4. Test before scheduling
```powershell
python discord_bot.py --dry-run   # prints both messages, sends nothing
python discord_bot.py --force     # posts once to both channels right now
```

### 5. Schedule it hourly
```powershell
.\register-hourly-task.ps1     # per-user task, no admin needed
```
Manage it:
```powershell
Get-ScheduledTask -TaskName DocmeeDiscordBot   # inspect
Start-ScheduledTask -TaskName DocmeeDiscordBot # run now
.\unregister-hourly-task.ps1                   # remove
```

---

## Flags
- `--dry-run` — print both messages to the console; send nothing.
- `--force` — post even if nothing changed since the last run.
- (no flag) — post only if the status signature changed since `state.json`.

## Notes
- **Secrets**: the token lives only in `.env`, which is gitignored. Never commit it.
- **No persistent connection**: this uses the bot token over the Discord REST
  API, so nothing runs between hourly fires. If you later want slash commands or
  two-way replies, the *same* bot application upgrades to a gateway connection.
- **Dependencies**: Python 3 + `openpyxl` (already installed for the dashboards).
  Discord calls use the standard library only.
- **Customising wording**: edit `technical_message()` / `team_message()` in
  `discord_bot.py`. The non-technical de-jargoning map is `_humanize()`.
