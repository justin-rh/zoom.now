# Roadmap: zoom.now

## Overview

A four-phase journey from zero to company-wide Zoom Team Chat bot. Phase 1 delivers a live, verified webhook endpoint — required before Zoom will accept the app configuration. Phase 2 delivers the core value: a user types a ServiceNow ticket number and the bot replies with a clickable link. Phase 3 hardens reply behavior with deduplication and opt-out. Phase 4 completes the rollout to the full company via Zoom admin install.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation** - Live HTTPS endpoint on Railway with Zoom app registered and webhook signature verification passing
- [ ] **Phase 2: Core Detection & Reply** - End-to-end working bot: ticket number detected, bot replies with clickable ServiceNow link
- [ ] **Phase 3: Noise Control** - Deduplication and opt-out suppress repeat and unwanted replies
- [ ] **Phase 4: Production Rollout** - Zoom admin installs bot company-wide; all config locked to env vars

## Phase Details

### Phase 1: Foundation
**Goal**: A live, publicly accessible HTTPS endpoint exists on Railway, passes Zoom's URL validation challenge, and verifies webhook signatures correctly — unblocking Zoom app configuration
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, DEPLOY-01
**Success Criteria** (what must be TRUE):
  1. Railway service is live at a public HTTPS URL with no cold-start delays
  2. POST /webhook responds HTTP 200 immediately before any async processing
  3. Zoom Marketplace app is registered with Team Chat feature enabled and `chat_message.sent` event subscription saved (requires endpoint validation to pass)
  4. Webhook signature verification rejects requests with invalid HMAC signatures and accepts valid ones (raw body preserved — not parsed JSON)
  5. All credentials and configuration (Zoom client ID/secret, bot JID) are supplied via Railway env vars with no hardcoded values in source
**Plans**: 2 plans

Plans:
- [x] 01-01-PLAN.md — Create test stubs and all project files (index.js, package.json, .env.example, .gitignore, railway.toml); npm install; tests green
- [ ] 01-02-PLAN.md — Deploy to Railway, complete Zoom Marketplace app registration, pass URL validation challenge

### Phase 2: Core Detection & Reply
**Goal**: Users can type a ServiceNow ticket number in any channel the bot monitors (or in a DM) and receive a single bot reply with a clickable link to the ticket
**Depends on**: Phase 1
**Requirements**: INFRA-05, DETECT-01, DETECT-02, DETECT-03, DETECT-04, BOT-01, BOT-02, BOT-03, BOT-04
**Success Criteria** (what must be TRUE):
  1. Typing `INC0001234` in a monitored channel produces exactly one bot reply: `🔗 INC0001234 → <url|Open in ServiceNow>` pointing to the correct ServiceNow table URL
  2. A message containing multiple ticket numbers (e.g., `INC0001234 and RITM0009876`) produces one consolidated reply listing all tickets
  3. Sending a DM to the bot with a ticket number produces the same reply (via `bot_notification` event)
  4. The bot never replies to its own messages (no infinite reply loop)
  5. Ticket prefix-to-table mapping and ServiceNow domain are read from env vars, not hardcoded
**Plans**: TBD

### Phase 3: Noise Control
**Goal**: The bot suppresses repeat ticket links in busy channels and respects per-message opt-out signals, making it quiet and non-intrusive in active conversations
**Depends on**: Phase 2
**Requirements**: BOT-05, BOT-06
**Success Criteria** (what must be TRUE):
  1. If the same ticket number is mentioned twice in the same channel within 60 minutes, the bot replies only the first time
  2. A message containing the configured opt-out keyword (default: `nobot`) with a ticket number receives no bot reply
  3. Dedup TTL and opt-out keyword are configurable via env vars
**Plans**: TBD

### Phase 4: Production Rollout
**Goal**: A Zoom account admin can install the bot company-wide so every employee's channels are covered without per-user action
**Depends on**: Phase 3
**Requirements**: DEPLOY-02
**Success Criteria** (what must be TRUE):
  1. Zoom account admin can install the bot for the entire Master Electronics Zoom account using the internal app OAuth consent flow
  2. After admin install, the bot passively monitors channels without requiring individual users to add it
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 1/2 | In progress | - |
| 2. Core Detection & Reply | 0/TBD | Not started | - |
| 3. Noise Control | 0/TBD | Not started | - |
| 4. Production Rollout | 0/TBD | Not started | - |
