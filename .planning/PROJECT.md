# zoom.now

## What This Is

A Zoom Team Chat bot that automatically detects ServiceNow ticket numbers in chat messages and replies with a minimal, clickable link to the ticket. The bot works passively in any channel it's added to and also responds to direct messages. Built for Master Electronics, starting as a personal test and scaling to team- and company-wide deployment.

## Core Value

Any ServiceNow ticket number mentioned in Zoom chat becomes a clickable link with zero friction — no copy-pasting, no manually constructing URLs.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Bot detects ticket numbers matching configured prefixes (INC, RITM, REQ + extensible) using regex in chat messages
- [ ] Bot replies with a minimal formatted message listing all detected tickets: `🔗 INC0001234 → [Open in ServiceNow]`
- [ ] Multiple tickets in one message produce a single reply with all links listed
- [ ] Bot works in Team Chat channels (passive, auto-reply) and via direct message
- [ ] Bot never replies to other bots or apps (filter by message sender type)
- [ ] Deduplication: bot suppresses reply if the same ticket was already linked recently in the same channel
- [ ] Opt-out keyword: users can include a configurable keyword (e.g., `nobot`) to suppress the bot reply for that message
- [ ] Links resolve to the correct ServiceNow table per ticket prefix (INC → incident, RITM → sc_req_item, REQ → sc_request, etc.)
- [ ] ServiceNow domain and ticket prefix→table mapping are configurable via environment variables or config file
- [ ] Bot is deployable as a Zoom Marketplace internal app using Zoom's chatbot API

### Out of Scope

- Modifying the original message text — Zoom's API does not support editing other users' messages
- Fetching live ticket data from ServiceNow API — links only, no auth plumbing required
- Browser extension for Zoom web client — deferred to a potential v2 add-on
- Zoom Meetings chat integration — deferred to v2 after Team Chat is proven
- Public Zoom Marketplace listing — internal app only for now

## Context

- **Company**: Master Electronics
- **ServiceNow instance**: masterelectronics.service-now.com
- **Standard ticket URL pattern**: `https://masterelectronics.service-now.com/{table}.do?sysparm_query=number={TICKET}`
- **Ticket prefix → table mapping**: INC → incident, RITM → sc_req_item, REQ → sc_request, CHG → change_request, PRB → problem, TASK → task
- **Deployment path**: personal test → team rollout → company-wide (Zoom internal app install flow supports this)
- **Zoom API approach**: Zoom Team Chat App (chatbot) with webhook endpoint for `chat_message.sent` events

## Constraints

- **Infrastructure**: Bot requires a publicly accessible HTTPS webhook endpoint — cloud hosting required (Vercel, Railway, Render, or similar)
- **Zoom API**: Must implement Zoom webhook signature verification for security
- **Zoom App type**: Internal app (no Zoom Marketplace review required for company-wide internal rollout)
- **Ticket format**: ServiceNow standard format is PREFIX + 7 zero-padded digits (e.g., INC0001234) — regex must match this exactly to avoid false positives

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Bot reply instead of message modification | Zoom API does not expose message rendering or allow editing others' messages | — Pending |
| Single consolidated reply per message | Reduces noise when multiple tickets appear in one message | — Pending |
| Configurable prefix list and SNOW domain | Required for multi-team and company-wide rollout without code changes | — Pending |
| Internal Zoom app (not public marketplace) | Faster to deploy, no Zoom review process, sufficient for company rollout | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-01 after initialization*
