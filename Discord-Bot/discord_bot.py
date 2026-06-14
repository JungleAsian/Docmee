# -*- coding: utf-8 -*-
"""
Docmee Discord status bot.

Posts TWO status updates to two Discord channels, hourly, as a full bot
(bot token over the Discord REST API):

  * #docmee-eng   -> full TECHNICAL digest (gates, commits, security action
                     items, open blockers, code-scan drift)
  * #docmee-team  -> plain-language NON-TECHNICAL summary for colleagues
                     (no jargon, no commit hashes, no SEC ids)

Data sources (the same ones the dashboards already parse):
  * Dashboard/build_dashboard.py  build_data()  -> tracker xlsx + git state
  * Security-Command-Center/findings.json        -> security posture
  * Security-Command-Center/scan-state.json       -> live code-scan metadata

It only posts when something meaningful CHANGED since the last run (a content
signature is stored in state.json) so the hourly schedule never spams the
channels with identical messages. Pass --force to post regardless, and
--dry-run to print the messages to the console without sending.

Secrets/config come from .env (gitignored) — see .env.example.
No third-party packages required beyond openpyxl (already used by the
dashboard); Discord calls use the stdlib urllib.
"""
import json
import sys
import pathlib
import hashlib
import argparse
import urllib.request
import urllib.error

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent                                  # ...\Docmee
DASHBOARD = ROOT / "Dashboard"
SECCTR = ROOT / "Security-Command-Center"
STATE_FILE = HERE / "state.json"
ENV_FILE = HERE / ".env"

DISCORD_API = "https://discord.com/api/v10"

# Brand colours for the embed stripe (decimal RGB).
COLOR_TECH = 0x5865F2   # Discord blurple
COLOR_TEAM = 0x57F287   # green


# --------------------------------------------------------------------------- #
# config
# --------------------------------------------------------------------------- #
def load_env():
    """Minimal .env parser (KEY=VALUE per line, # comments, optional quotes)."""
    cfg = {}
    if ENV_FILE.exists():
        for raw in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            v = v.strip().strip('"').strip("'")
            cfg[k.strip()] = v
    return cfg


# --------------------------------------------------------------------------- #
# data gathering
# --------------------------------------------------------------------------- #
def gather():
    """Pull the dashboard data dict + security findings + scan state."""
    sys.path.insert(0, str(DASHBOARD))
    import build_dashboard  # noqa: E402  (path injected above)
    data = build_dashboard.build_data()

    findings = json.loads((SECCTR / "findings.json").read_text(encoding="utf-8"))
    scan = json.loads((SECCTR / "scan-state.json").read_text(encoding="utf-8"))
    return data, findings, scan


def derive(data, findings, scan):
    """Reduce the raw sources into the few facts both messages need."""
    head = data["headline"]
    commits = data["git"]["commits"]

    # Security: action-required, high-confidence items (the Action Plan).
    actions = [f for f in findings["findings"]
               if f.get("assessment") == "action" and f.get("confidence", 0) >= 8]
    # sort: Critical > High > Medium-High > Medium, then by confidence
    sev_rank = {"Critical": 0, "High": 1, "Medium-High": 2, "Medium": 3}
    actions.sort(key=lambda f: (sev_rank.get(f.get("severity"), 9),
                                -f.get("confidence", 0)))
    locked = sum(1 for f in findings["findings"] if f.get("assessment") == "holds")

    # Open delivery blockers from the action tracker (X-items not done/locked).
    open_blockers = [a for a in data["tracker"]["actions"]
                     if a.get("status", "").lower() not in
                     ("done", "locked", "resolved", "closed", "mitigated")]

    return {
        "generated": data["generated"],
        "branch": data["project"]["branch"],
        "status": data["project"]["status"],
        "gates_passed": head["gates_passed"],
        "gates_total": head["gates_total"],
        "decisions": head["decisions"],
        "gaps_total": head["gaps_total"],
        "gaps_locked": head["gaps_locked"],
        "risks": head["risks"],
        "sprint0": data.get("sprint0", []),
        "commits": commits,
        "head_commit": commits[0]["hash"] if commits else "",
        "sec_actions": actions,
        "sec_locked": locked,
        "open_blockers": open_blockers,
        "scan": scan,
        "audit_date": findings["meta"].get("audit_date", ""),
    }


def signature(d):
    """Stable hash of the facts that should trigger a new post when changed."""
    payload = {
        "branch": d["branch"],
        "gates": (d["gates_passed"], d["gates_total"]),
        "gaps": (d["gaps_total"], d["gaps_locked"]),
        "decisions": d["decisions"],
        "head": d["head_commit"],
        "sprint0": sorted((t["id"], t["status"]) for t in d["sprint0"]),
        "sec_actions": sorted(f["id"] for f in d["sec_actions"]),
        "blockers": sorted(a["id"] for a in d["open_blockers"]),
        "scan": (d["scan"].get("drift"), d["scan"].get("unanalyzed"),
                 d["scan"].get("head")),
    }
    blob = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- #
# message composition
# --------------------------------------------------------------------------- #
EMOJI_STATUS = {"done": "✅", "doing": "🔄", "todo": "⬜", "blocked": "⛔"}


def technical_message(d):
    lines = []
    lines.append(f"**🛠️ Docmee — Engineering status** · `{d['generated']}`")
    lines.append(f"Branch `{d['branch']}` · {d['status']}")
    lines.append("")

    lines.append("**Progress**")
    lines.append(f"• Gates passed: **{d['gates_passed']}/{d['gates_total']}**")
    lines.append(f"• Decisions sealed: **{d['decisions']}** · "
                 f"Gaps locked: **{d['gaps_locked']}/{d['gaps_total']}** · "
                 f"Risks tracked: **{d['risks']}**")
    lines.append("")

    if d["sprint0"]:
        lines.append("**Sprint 0 tickets**")
        for t in d["sprint0"]:
            mark = EMOJI_STATUS.get(t["status"].lower(), "•")
            lines.append(f"{mark} `{t['id']}` ({t['agent']}) {t['title']} — "
                         f"_{t['status']}_")
        lines.append("")

    if d["commits"]:
        lines.append("**Recent commits**")
        for c in d["commits"][:4]:
            lines.append(f"• `{c['hash']}` {c['date']} — {c['subject']}")
        lines.append("")

    lines.append(f"**Security — action plan ({len(d['sec_actions'])} open, "
                 f"{d['sec_locked']} locked)** · audited {d['audit_date']}")
    if d["sec_actions"]:
        for f in d["sec_actions"][:8]:
            lines.append(f"• `{f['id']}` **{f['severity']}** "
                         f"(conf {f['confidence']}) — {f['title']}")
        if len(d["sec_actions"]) > 8:
            lines.append(f"• …and {len(d['sec_actions']) - 8} more")
    else:
        lines.append("• None outstanding 🎉")
    lines.append("")

    if d["open_blockers"]:
        lines.append(f"**Open delivery items ({len(d['open_blockers'])})**")
        for a in d["open_blockers"][:6]:
            lines.append(f"• `{a['id']}` {a['item']} — _{a['status']}_ "
                         f"(owner: {a.get('owner', '?')})")
        if len(d["open_blockers"]) > 6:
            lines.append(f"• …and {len(d['open_blockers']) - 6} more")
        lines.append("")

    sc = d["scan"]
    lines.append(f"**Code scan** · head `{sc.get('head', '?')}` · "
                 f"drift **{sc.get('drift', '?')}** · "
                 f"unanalyzed **{sc.get('unanalyzed', '?')}**")

    return {"embeds": [{
        "title": "Docmee — Engineering status",
        "description": _clamp("\n".join(lines), 4096),
        "color": COLOR_TECH,
    }]}


def team_message(d):
    """Plain-language summary: no commit hashes, no SEC ids, no jargon."""
    done = [t for t in d["sprint0"] if t["status"].lower() == "done"]
    doing = [t for t in d["sprint0"] if t["status"].lower() == "doing"]

    lines = []
    lines.append("**📣 Docmee — Project update**")
    lines.append("Here's where things stand right now, in plain terms.")
    lines.append("")

    # Headline progress in human words.
    if d["gates_total"]:
        pct = round(100 * d["gates_passed"] / d["gates_total"])
        lines.append(f"**Overall:** we're in *{_phase_phrase(d['status'])}*. "
                     f"About **{pct}%** of our quality checkpoints so far are "
                     f"passing, and **{d['decisions']}** key product decisions "
                     f"are locked in.")
    else:
        lines.append(f"**Overall:** we're in *{_phase_phrase(d['status'])}*.")
    lines.append("")

    if done:
        lines.append("**✅ Recently finished**")
        for t in done:
            lines.append(f"• {_humanize(t['title'])}")
        lines.append("")

    if doing:
        lines.append("**🔄 In progress now**")
        for t in doing:
            lines.append(f"• {_humanize(t['title'])}")
        lines.append("")

    # Security, reassuringly and without jargon.
    n = len(d["sec_actions"])
    if n:
        lines.append(
            f"**🔐 Security:** our security advisor has flagged **{n}** "
            f"item{'s' if n != 1 else ''} to handle before we go live with real "
            f"patients, and **{d['sec_locked']}** safeguards are already locked "
            f"in. These are planned hardening steps — not active problems, since "
            f"we have no live patient traffic yet.")
    else:
        lines.append("**🔐 Security:** no outstanding pre-launch items — all "
                     "known safeguards are in place. 🎉")
    lines.append("")

    # Blockers in friendly terms.
    if d["open_blockers"]:
        lines.append(f"**⏳ What we're waiting on:** {len(d['open_blockers'])} "
                     "open item(s), including:")
        for a in d["open_blockers"][:3]:
            lines.append(f"• {_humanize(a['item'])}")
    else:
        lines.append("**⏳ What we're waiting on:** nothing blocking right now.")
    lines.append("")
    lines.append(f"_Last updated {d['generated']}._")

    return {"embeds": [{
        "title": "Docmee — Project update",
        "description": _clamp("\n".join(lines), 4096),
        "color": COLOR_TEAM,
    }]}


def _phase_phrase(status):
    s = status.lower()
    if "sprint 0" in s:
        return "the setup sprint (laying the foundations)"
    return status


def _humanize(text):
    """Light de-jargoning for the non-technical channel."""
    repl = {
        "Auth/login against mock": "Login flow (against a test server)",
        "RLS test harness": "data-isolation safety tests",
        "App shell + design system": "the web app's foundation and visual design",
        "RLS": "data isolation between clinics",
        "API": "backend service",
        "KB": "knowledge base",
        "i18n": "Spanish/English language support",
        "Fastify": "backend",
        "Next.js 14": "the web app",
        "Supabase": "the database",
        "CRUD": "create/edit",
        "endpoint": "feature",
        "scaffold": "initial setup",
        "mock server": "a stand-in test server",
        "against mock": "against a test server",
        "contract v0": "the agreed data format",
        "Finalize the agreed data format": "Agreed the data format between frontend and backend",
        "WABA": "WhatsApp Business",
    }
    out = text
    for k, v in repl.items():
        out = out.replace(k, v)
    return out


def _clamp(text, limit):
    return text if len(text) <= limit else text[: limit - 1] + "…"


# --------------------------------------------------------------------------- #
# dashboard (native embeds, edited in place to stay a single live panel)
# --------------------------------------------------------------------------- #
def _bar(done, total, width=12):
    if total <= 0:
        return "▱" * width
    filled = max(0, min(width, round(width * done / total)))
    return "▰" * filled + "▱" * (width - filled)


def dashboard_payload(data):
    """Replicate the HTML dashboard's content as Discord-native embeds."""
    h, proj, tr = data["headline"], data["project"], data["tracker"]
    gen = data["generated"]

    overview = {
        "title": "📊 Docmee Command Center",
        "description": f"{proj['tagline']}\n**Status:** {proj['status']}\n"
                       f"**Branch:** `{proj['branch']}`",
        "color": COLOR_TECH,
        "fields": [
            {"name": "Phases sealed",
             "value": f"{h['phases_sealed']}/{h['phases_total']}", "inline": True},
            {"name": "Gates passed",
             "value": f"{_bar(h['gates_passed'], h['gates_total'], 10)}\n"
                      f"{h['gates_passed']}/{h['gates_total']}", "inline": True},
            {"name": "Decisions",
             "value": f"{h['decisions']} ({h['decisions_flagged']} flagged)",
             "inline": True},
            {"name": "Gaps locked",
             "value": f"{h['gaps_locked']}/{h['gaps_total']}", "inline": True},
            {"name": "Risks", "value": str(h["risks"]), "inline": True},
            {"name": "Security items", "value": str(h["security"]), "inline": True},
        ],
    }

    ticket_lines = []
    for t in data.get("sprint0", []):
        mark = EMOJI_STATUS.get(t["status"].lower(), "•")
        ticket_lines.append(f"{mark} `{t['id']}` ({t['agent']}) — {t['title']} "
                            f"_({t['status']})_")
    sprint0 = {
        "title": "🎫 Sprint 0 — current tickets",
        "description": "\n".join(ticket_lines) or "—",
        "color": 0x1ABC9C,
    }

    ag = data.get("agents", {})

    def _pkgs(a):
        return "\n".join(f"• `{p['path']}` — {p['desc']}" for p in a["packages"])
    agents = {
        "title": "🤝 Agent lanes",
        "color": 0xF1C40F,
        "fields": [
            {"name": f"{ag['prime']['name']} · {ag['prime']['role']}",
             "value": _pkgs(ag["prime"]), "inline": True},
            {"name": f"{ag['alpha']['name']} · {ag['alpha']['role']}",
             "value": _pkgs(ag["alpha"]), "inline": True},
        ],
    } if ag else None

    rows = []
    for p in data["phases"]:
        rows.append(f"{p['id']:<4} {p['short'][:16]:<16} "
                    f"w{p['wstart']:>2}-{p['wend']:<2} "
                    f"{_bar(p['gates_passed'], p['gates_total'], 8)} "
                    f"{p['gates_passed']}/{p['gates_total']}")
    phases = {
        "title": "🗺️ Phase timeline (26 weeks)",
        "description": "```\n" + "\n".join(rows) + "\n```",
        "color": 0x9B59B6,
    }

    sec_st = tr.get("sec_status", {})
    sec_pri = tr.get("sec_priority", {})
    security = {
        "title": "🔐 Security posture",
        "description": "By status — " +
                       (" · ".join(f"**{k}** {v}" for k, v in sec_st.items()) or "—"),
        "color": 0xE74C3C,
        "fields": [{
            "name": "By priority",
            "value": (" · ".join(f"{k}: {v}" for k, v in sec_pri.items()) or "—"),
            "inline": False,
        }],
    }

    rp = tr.get("risk_priority", {})
    risks = {
        "title": "⚠️ Risk register",
        "description": f"{len(tr.get('risks', []))} risks tracked",
        "color": 0xE67E22,
        "fields": [{
            "name": "By priority",
            "value": (" · ".join(f"{k}: {v}" for k, v in rp.items()) or "—"),
            "inline": False,
        }],
    }

    # Bucket the free-text action-tracker statuses into clean categories.
    buckets = {}
    for raw, n in tr.get("action_status", {}).items():
        s = (raw or "").lower()
        if s.startswith(("done", "closed", "resolved", "mitigated", "locked")):
            label = "Done"
        elif "progress" in s or s.startswith("doing"):
            label = "In progress"
        elif "not started" in s or s.startswith("todo"):
            label = "Not started"
        elif "block" in s or "wait" in s:
            label = "Blocked / waiting"
        elif "park" in s:
            label = "Parked"
        else:
            label = "Other"
        buckets[label] = buckets.get(label, 0) + n
    order = ["Done", "In progress", "Blocked / waiting", "Not started", "Parked", "Other"]
    delivery = {
        "title": "📦 Delivery tracker",
        "description": (" · ".join(f"**{k}**: {buckets[k]}"
                                   for k in order if k in buckets) or "—"),
        "color": 0x3498DB,
        "footer": {"text": f"Live dashboard · auto-updates · generated {gen}"},
    }

    embeds = [overview, sprint0, phases]
    if agents:
        embeds.append(agents)
    embeds += [security, risks, delivery]
    return {"embeds": embeds}


# --------------------------------------------------------------------------- #
# discord
# --------------------------------------------------------------------------- #
def post(channel_id, token, body):
    url = f"{DISCORD_API}/channels/{channel_id}/messages"
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bot {token}",
            "Content-Type": "application/json",
            "User-Agent": "DocmeeStatusBot (local, 1.0)",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.status


def upsert(channel_id, token, body, message_id=None):
    """Edit an existing bot message in place, or create one. Returns the id.

    If the stored message was deleted (404), transparently recreates it.
    """
    headers = {
        "Authorization": f"Bot {token}",
        "Content-Type": "application/json",
        "User-Agent": "DocmeeStatusBot (local, 1.0)",
    }
    if message_id:
        url = f"{DISCORD_API}/channels/{channel_id}/messages/{message_id}"
        method = "PATCH"
    else:
        url = f"{DISCORD_API}/channels/{channel_id}/messages"
        method = "POST"
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"),
                                 method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))["id"]
    except urllib.error.HTTPError as e:
        if message_id and e.code == 404:        # message was deleted — recreate
            return upsert(channel_id, token, body, None)
        raise


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser(description="Post Docmee status to Discord.")
    ap.add_argument("--force", action="store_true",
                    help="post even if nothing changed since the last run")
    ap.add_argument("--dry-run", action="store_true",
                    help="print the messages instead of sending them")
    args = ap.parse_args()

    # Windows consoles default to cp1252 and choke on emoji when printing.
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    cfg = load_env()
    token = cfg.get("DISCORD_BOT_TOKEN", "")
    ch_tech = cfg.get("DISCORD_CHANNEL_TECH", "")
    ch_team = cfg.get("DISCORD_CHANNEL_TEAM", "")
    ch_dash = cfg.get("DISCORD_CHANNEL_DASHBOARD", "")

    data, findings, scan = gather()
    d = derive(data, findings, scan)
    sig = signature(d)

    msg_tech = technical_message(d)
    msg_team = team_message(d)
    dash = dashboard_payload(data)

    if args.dry_run:
        print("===== TECHNICAL (#docmee-eng) =====\n")
        print(msg_tech["embeds"][0]["description"])
        print("\n===== NON-TECHNICAL (#docmee-team) =====\n")
        print(msg_team["embeds"][0]["description"])
        print("\n===== DASHBOARD (#docmee-dashboard) =====\n")
        for emb in dash["embeds"]:
            print(f"[{emb['title']}]")
            print(emb.get("description", ""))
            for f in emb.get("fields", []):
                print(f"  • {f['name']}: {f['value']}")
            print()
        print(f"[signature {sig[:12]}]")
        return

    # persistent state (last signature + the live dashboard message id)
    state = {}
    if STATE_FILE.exists():
        try:
            state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except Exception:
            state = {}
    last = state.get("sig", "")

    need_digest = (sig != last) or args.force
    # update the dashboard when data changed, or when it hasn't been created yet
    need_dash = bool(ch_dash) and (need_digest or not state.get("dashboard_msg_id"))

    if not need_digest and not need_dash:
        print(f"No change since last post (sig {sig[:12]}) — skipping.")
        return

    if not token:
        sys.exit("DISCORD_BOT_TOKEN missing — copy .env.example to .env and fill it in.")
    if need_digest and (not ch_tech or not ch_team):
        sys.exit("DISCORD_CHANNEL_TECH / DISCORD_CHANNEL_TEAM missing in .env.")

    try:
        if need_digest:
            post(ch_tech, token, msg_tech)
            print(f"Posted technical update to {ch_tech}.")
            post(ch_team, token, msg_team)
            print(f"Posted team update to {ch_team}.")
        if need_dash:
            mid = state.get("dashboard_msg_id")
            new_mid = upsert(ch_dash, token, dash, mid)
            state["dashboard_msg_id"] = new_mid
            print(f"{'Updated' if mid else 'Created'} dashboard panel in {ch_dash}.")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        sys.exit(f"Discord API error {e.code}: {body}")
    except urllib.error.URLError as e:
        sys.exit(f"Network error talking to Discord: {e.reason}")

    state["sig"] = sig
    state["generated"] = d["generated"]
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    print(f"Done (sig {sig[:12]}).")


if __name__ == "__main__":
    main()
