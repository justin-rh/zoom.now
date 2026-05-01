# Project Research Summary

**Project:** zoom.now -- Zoom Team Chat ServiceNow ticket link bot
**Domain:** Zoom Team Chat webhook bot / internal tooling
**Researched:** 2026-05-01
**Confidence:** MEDIUM-HIGH

## Executive Summary

zoom.now is a passive Zoom Team Chat bot that detects ServiceNow ticket numbers in channel messages and replies with clickable links. This is a well-understood class of bot (chat linkification), but Zoom has several non-obvious platform constraints. The most important: a standard chatbot app only receives events when directly addressed -- to passively read all channel messages, the app must be a General App with both the Team Chat feature AND an account-level Event Subscription for chat_message.sent. This is the primary architectural decision and must be correct from the start.

The recommended implementation is a single Node.js 18 + Express server deployed on Railway (always-on, no cold starts). The server handles two Zoom mechanisms on one HTTP endpoint: the chat_message.sent event subscription (passive channel listening) and bot_notification events (slash commands). Outbound replies use the Client Credentials OAuth flow to obtain an imchat:bot-scoped token -- the only type accepted by /v2/im/chat/messages. The system is stateless except for an in-memory deduplication Map; no database needed for MVP.

The key risks are infrastructure-related: Zoom permanently disables webhook subscriptions if the endpoint misses its 3-second response timeout (ruling out serverless/cold-start hosting), and getting signature verification wrong at the raw-body level silences the bot entirely. Both are fully preventable with known techniques and must be addressed in Phase 1 before any feature work.

---

## Key Findings

### Recommended Stack

Node.js 18 LTS + Express 4 + axios + built-in crypto. This is the only runtime with official Zoom SDK support; all Zoom sample repos target it. Do not use @zoomus/chatbot (archived November 2024) or @zoom/rivet as the primary dependency (v0.3.0, early-stage API churn risk) -- raw Express + axios is more stable for a focused MVP. Deploy on Railway ($5/mo Hobby plan): always-on containers, GitHub push-to-deploy, HTTPS included. Vercel and Render free tier are ruled out due to cold-start behavior that permanently disables the Zoom webhook subscription.

**Core technologies:**
- Node.js 18 LTS: runtime -- only runtime with official Zoom SDK; all Zoom samples target it
- Express 4: HTTP server -- used in all Zoom official Node.js samples; minimal boilerplate
- axios: HTTP client -- calling Zoom /v2/im/chat/messages send endpoint
- Node.js crypto (built-in): HMAC-SHA256 webhook signature verification -- zero install cost
- dotenv: env var management -- all secrets must be env vars, never hardcoded
- Railway: hosting -- always-on, no cold start, $5/mo, GitHub deploy

**Do not use:** Vercel, Render free tier, Python, @zoomus/chatbot, Server-to-Server OAuth app type, Redis/DB at MVP.

### Expected Features

**Must have (table stakes -- ship in v1):**
- Passive regex detection for INC, RITM, REQ, CHG, PRB, TASK (7-digit zero-padded, word boundaries, case-insensitive: /\b(INC|RITM|REQ|CHG|PRB|TASK)\d{7}\b/gi)
- Single consolidated reply per message with all detected ticket links (never one reply per ticket)
- Clickable links using Zoom hyperlink syntax: <url|Display Text> with is_markdown_support: true at top-level of POST body
- Account-level app install so replies are visible to everyone in the channel
- Bot self-filter: never process events where sender is the bot itself (infinite loop prevention)
- nobot opt-out keyword -- checked before any other processing
- In-memory deduplication keyed on channel_id:ticket_number, 60-minute TTL
- Webhook signature verification (HMAC-SHA256) with 5-minute timestamp replay window
- Configurable ServiceNow domain and prefix-to-table map via env vars
- /snow help slash command

**Should have (v1.1):**
- /snow status command (admin diagnostics)
- Message card formatting with section header
- Configurable dedup TTL

**Defer to v2+:**
- ServiceNow live ticket data fetch (requires SNOW OAuth, significant scope increase)
- Unfurl link enhancement (intercept SNOW URLs pasted in chat)
- Zoom Meetings chat integration

**Anti-features (do not build):**
- Per-ticket replies (creates reply storms in busy channels)
- Thread replies (broken in 1:1 DMs; confusing UX in channels)
- User-level app install (messages show as only-visible-to-you)
- Globally common slash command names like /help

### Architecture Approach

Single Express server, single POST /webhook endpoint handling both passive channel listening (chat_message.sent events from Event Subscription) and slash commands (bot_notification events). Both configured in one General App on marketplace.zoom.us. Processing pipeline: verify signature > handle URL validation challenge > filter bots/opt-outs > regex scan > dedup check > fetch/cache token > send reply. Server must respond 200 immediately before any async work (3-second Zoom timeout).

**Major components:**
1. Webhook receiver (POST /webhook) -- signature verification, event routing, immediate 200 response
2. Event processor -- bot filter, nobot check, regex parser, dedup lookup
3. Token manager -- Client Credentials grant, 1-hour cache; re-request on expiry (no refresh token in Client Credentials flow)
4. Reply sender -- builds hyperlink-formatted message, POSTs to /v2/im/chat/messages
5. Dedup store -- in-memory Map keyed on channel_id:ticket, with periodic TTL cleanup

**Key payload fields:**
- payload.object.message -- text to regex-scan for ticket numbers
- payload.object.sender_type -- must be "user" to process (skip if bot/app)
- payload.object.to_jid -- use as to_jid in reply POST body
- payload.object.channel_id -- dedup key scope
- payload.account_id -- required in reply POST body

### Top 5 Pitfalls

1. **Raw body destroyed before signature verification** -- express.json() middleware parses the body before HMAC verification runs, invalidating the signature. Fix: use express.raw({ type: 'application/json' }) on the webhook route only; specify explicit utf8 encoding when converting the Buffer (emoji break ASCII/latin1 decoding). This silences the entire bot if wrong.

2. **Bot reply infinite loop** -- chat_message.sent fires for the bot's own reply messages too. Fix: check sender_type != "user" OR sender JID == ZOOM_BOT_JID and return 200 immediately. Must be in place before any production testing.

3. **Wrong token type for sending messages** -- Client Credentials grant (grant_type=client_credentials) is the only token that works with /v2/im/chat/messages. Authorization Code flow tokens return 401/7004. Cache token with expiry; re-request (not refresh) when expired.

4. **Webhook endpoint permanently disabled after timeout** -- Zoom retries failed deliveries twice then permanently disables the subscription; Marketplace fields become greyed out; recovery requires creating a new app entirely. Fix: respond 200 immediately before async processing; use always-on hosting (Railway).

5. **Dedup keyed globally instead of per-channel** -- a global ticket_number key suppresses bot replies in unrelated channels. Fix: always key as channel_id:ticket_number with 30-60 minute TTL.

---

## Implications for Roadmap

### Phase 1: Foundation and Webhook Infrastructure
**Rationale:** Everything else depends on a verified, secure endpoint that Zoom trusts. Must be deployed before feature work -- Zoom will not send events to an unvalidated URL.
**Delivers:** Live HTTPS endpoint on Railway, Zoom General App created with Team Chat feature and Event Subscription enabled, signature verification passing, URL validation challenge working, raw payloads confirmed in logs.
**Avoids:** Raw body destruction (Pitfall 1), timestamp replay (Pitfall 2), endpoint disablement (Pitfall 4), missing Team Chat enable step, unicode encoding issues.

**Critical gate before Phase 2:** Send a real test message and inspect the raw payload. Confirm actual sender_type field values and exact event name from live data before writing the event parser.

### Phase 2: Core Detection and Reply
**Rationale:** With real field values confirmed from Phase 1, implement the core value loop. These features are tightly coupled and should ship as one working slice.
**Delivers:** End-to-end working flow -- user types INC0001234 in a channel, bot replies with a clickable ServiceNow link.
**Addresses:** Regex detection, consolidated reply, bot self-filter, nobot opt-out, prefix-to-table map, SNOW domain config, hyperlink formatting.
**Avoids:** Infinite loop (bot filter), regex false positives (word boundaries + /gi), unknown prefix crashes.

### Phase 3: Deduplication and Slash Commands
**Rationale:** Dedup prevents the most common UX annoyance (repeat links flooding a busy channel). Slash commands add discoverability. Both are low-complexity and ship together.
**Delivers:** Bot suppresses repeat ticket links within 60-minute window per channel; /snow help explains the bot to users.
**Avoids:** Wrong dedup key scope, duplicate webhook event delivery.

### Phase 4: Production Hardening and Rollout
**Rationale:** Personal test to company-wide deployment requires Zoom admin coordination outside of code. Separated as its own phase due to the external dependency.
**Delivers:** Production Railway deployment locked down, Zoom admin installs app company-wide via OAuth consent, runbook for recovering from subscription disablement.
**Avoids:** Cold-start hosting (already solved by Railway choice), admin approval coordination gap.

### Phase Ordering Rationale

- Phase 1 must be live before Zoom Marketplace app config can be saved (Zoom validates the endpoint URL on save -- chicken-and-egg).
- Phase 2 depends on real payload field names confirmed in Phase 1. Do not skip the logging gate.
- Dedup (Phase 3) could ship with Phase 2, but the core reply loop should be validated first to avoid suppression logic masking bugs.
- Rollout (Phase 4) involves external coordination and must not block development completion.

### Research Flags

**Needs validation during implementation:**
- Phase 1: Confirm exact sender_type string value for bot-originated messages by logging live payloads.
- Phase 1: Confirm actual event name (chat_message.sent vs channel_message.sent) from live subscription.
- Phase 1 pre-work: Verify Advanced Chat Encryption status on Master Electronics Zoom account. If enabled, chat_message.sent webhooks are blocked; fallback is requiring bot channel membership.

**Standard patterns (no research needed):**
- Phase 3: In-memory Map dedup with TTL is well-understood.
- Phase 4: Railway deployment and env var management are standard ops.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Node.js + Express confirmed by official Zoom repos; Railway constraint confirmed by Zoom timeout docs |
| Features | MEDIUM-HIGH | API behavior confirmed via Zoom developer forum employee responses |
| Architecture | MEDIUM | Payload field names inferred from sample repos + forum posts; official API docs were inaccessible during research |
| Pitfalls | HIGH | All critical pitfalls from official Zoom developer forum with employee/MVP confirmation |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Exact sender_type value for bot messages:** Field confirmed to exist; exact string not clearly documented. Confirm from live payload in Phase 1.
- **chat_message.sent vs channel_message.sent event name:** Minor inconsistency between sources. Confirm from live payload in Phase 1.
- **Advanced Chat Encryption on Master Electronics account:** If enabled, passive channel listening is blocked entirely. Verify with Zoom admin before Phase 1 app setup.
- **imchat:bot scope requires Admin Level OAuth toggle in app config:** Easy to miss; causes silent 7010 errors. Verify explicitly during Phase 1 app configuration.
- **Rate limit ceiling (~6,000 req/day):** Community-observed, not officially documented. Not a concern for MVP but worth monitoring at company-wide scale.

---

## Sources

### Primary (HIGH confidence)
- zoom/chatbot-nodejs-quickstart (official Zoom repo) -- Express + client_credentials pattern
- zoom/webhook-sample (official Zoom repo) -- HMAC-SHA256 verification algorithm
- zoom/node.js-chatbot README (official Zoom repo) -- @zoomus/chatbot deprecation confirmed
- zoom/rivet-javascript (official Zoom repo) -- @zoom/rivet v0.3.0 as official replacement
- Zoom Developer Forum: error 7010 / Admin Level OAuth -- imchat:bot scope requirement
- Zoom Developer Forum: emoji webhook signature failure -- UTF-8 encoding requirement
- Zoom Developer Forum: endpoint disabled greyed out -- timeout/retry/permanent-disable behavior
- Zoom Developer Forum: thread reply events in 1:1 DMs confirmed Nov 2025

### Secondary (MEDIUM confidence)
- Zoom Developer Forum: passive channel listening -- account-level app + event subscription required
- Cerebras blog: Building a Zoom Team Chat AI assistant (2024) -- General App + Team Chat surface
- Zoom Developer Forum: rate limit 429 / 6,000/day ceiling -- community-observed

### Tertiary (MEDIUM-LOW confidence)
- Reconstructed chat_message.sent payload schema -- inferred from sample repos and forum posts; treat field names as provisional until validated against live payloads in Phase 1.

---
*Research completed: 2026-05-01*
*Ready for roadmap: yes*
