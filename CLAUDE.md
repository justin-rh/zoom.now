# zoom.now — Project Guide

## What This Is

A Zoom Team Chat bot (Node.js + Express on Railway) that detects ServiceNow ticket numbers in messages and replies with minimal clickable links. Built for Master Electronics.

ServiceNow instance: `masterelectronics.service-now.com`
Ticket prefixes: INC, RITM, REQ (configurable via env vars)

## GSD Workflow

This project uses the GSD framework for spec-driven, phase-based development.

**Current state:** Run `/gsd-progress` to see which phase is active.
**Next phase:** Run `/gsd-discuss-phase 1` or `/gsd-plan-phase 1` to begin.

### Phase Overview

| Phase | Goal |
|-------|------|
| 1. Foundation | Live HTTPS endpoint on Railway, Zoom app registered, signature verification passing |
| 2. Core Detection & Reply | Ticket number → clickable ServiceNow link via bot reply |
| 3. Noise Control | Deduplication + opt-out keyword |
| 4. Production Rollout | Company-wide install via Zoom admin |

## Critical Implementation Notes

These constraints come from research — violating them causes hard-to-debug failures:

1. **Raw body for HMAC** — Do NOT apply `express.json()` globally. The webhook route needs the raw request body for Zoom's HMAC-SHA256 signature verification. Use `express.raw()` on the webhook route only.

2. **200 OK immediately** — Zoom's webhook timeout is 3 seconds. Call `res.sendStatus(200)` before any async processing. Failures cause Zoom to eventually permanently disable the subscription.

3. **Client credentials token only** — Use `grant_type=client_credentials` for bot message sends. OAuth authorization code tokens will fail silently with error 7004.

4. **Self-reply filter** — Zoom fires `chat_message.sent` for the bot's own messages. Always check sender type + bot JID before processing to prevent infinite reply loops.

5. **Dedup key** — Key on `channel_id:ticket_number`, not `ticket_number` alone.

6. **Passive listening** — Channel monitoring requires a `chat_message.sent` event subscription on the General App, NOT the chatbot Bot Endpoint URL (which only handles DMs/slash commands).

## Environment Variables

```
ZOOM_CLIENT_ID=
ZOOM_CLIENT_SECRET=
ZOOM_BOT_JID=
ZOOM_WEBHOOK_SECRET_TOKEN=
SNOW_DOMAIN=masterelectronics.service-now.com
TICKET_PREFIXES=INC,RITM,REQ
DEDUP_TTL_MINUTES=60
OPT_OUT_KEYWORD=nobot
```

## Planning Docs

| Artifact | Location |
|----------|----------|
| Project context | `.planning/PROJECT.md` |
| Config | `.planning/config.json` |
| Research | `.planning/research/` |
| Requirements | `.planning/REQUIREMENTS.md` |
| Roadmap | `.planning/ROADMAP.md` |
| State | `.planning/STATE.md` |
