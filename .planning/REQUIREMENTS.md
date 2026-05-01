# Requirements — zoom.now

## v1 Requirements

### Infrastructure

- [ ] **INFRA-01**: Express server with HTTPS webhook endpoint, deployed on Railway (always-on — no cold starts)
- [ ] **INFRA-02**: Zoom General App registered in Zoom Marketplace with Team Chat feature enabled and `chat_message.sent` event subscription configured
- [ ] **INFRA-03**: All webhook events respond with HTTP 200 immediately before any async processing
- [ ] **INFRA-04**: HMAC-SHA256 webhook signature verification using raw request body (not parsed JSON)
- [ ] **INFRA-05**: Client credentials token acquisition with in-memory 1-hour cache and auto-refresh before expiry

### Detection

- [ ] **DETECT-01**: Regex detects ticket numbers matching `INC|RITM|REQ` prefix + 7 digits, case-insensitive, with word boundaries to avoid false positives
- [ ] **DETECT-02**: All ticket matches in a single message are collected and included in one consolidated bot reply
- [ ] **DETECT-03**: Prefix-to-ServiceNow-table mapping is configurable (INC → incident, RITM → sc_req_item, REQ → sc_request)
- [ ] **DETECT-04**: ServiceNow domain is configurable via environment variable (default: masterelectronics.service-now.com)

### Bot Behavior

- [ ] **BOT-01**: Bot passively monitors channels where it has been added and auto-replies when ticket numbers are detected (`chat_message.sent` event)
- [ ] **BOT-02**: Bot responds to direct messages containing ticket numbers (`bot_notification` event)
- [ ] **BOT-03**: Bot never replies to messages originating from bots or apps (filters by sender type and bot JID)
- [ ] **BOT-04**: Reply format is minimal — a single message listing all detected tickets: `🔗 INC0001234 → <url|Open in ServiceNow>`
- [ ] **BOT-05**: Opt-out keyword (configurable, default: `nobot`) in a message suppresses the bot reply for that message
- [ ] **BOT-06**: Deduplication suppresses reply if the same ticket was already linked in the same channel within a configurable TTL window (default: 60 min), keyed as `channel_id:ticket_number`

### Deployment

- [ ] **DEPLOY-01**: All configuration (ServiceNow domain, ticket prefixes, dedup TTL, opt-out keyword, Zoom credentials) provided via environment variables — no hardcoded values
- [ ] **DEPLOY-02**: Bot installable as a Zoom internal app, allowing a Zoom account admin to deploy it company-wide

---

## v2 Requirements (Deferred)

- Additional ticket prefixes (CHG, PRB, TASK, SCTASK) — configurable from v1 env vars, just not in the default set
- Browser extension for Zoom web client (app.zoom.us) linkification
- Zoom Meetings chat integration
- ServiceNow link unfurling (May 2024 Zoom API) — intercepts pasted SNOW URLs and enriches them
- Slash command: `/snow INC0001234` → bot replies with link on demand
- Live ticket data fetch from ServiceNow API (title, status, assignee in the reply card)

---

## Out of Scope

- Modifying original message text — Zoom API does not allow editing other users' messages
- Public Zoom Marketplace listing — internal app only; no Zoom review required
- Authenticating users against ServiceNow — links only, no user auth plumbing
- Multi-tenant SaaS mode — single-tenant (Master Electronics) for all phases

---

## Traceability

| REQ-ID | Phase | Status |
|--------|-------|--------|
| INFRA-01 | Phase 1 | Pending |
| INFRA-02 | Phase 1 | Pending |
| INFRA-03 | Phase 1 | Pending |
| INFRA-04 | Phase 1 | Pending |
| DEPLOY-01 | Phase 1 | Pending |
| INFRA-05 | Phase 2 | Pending |
| DETECT-01 | Phase 2 | Pending |
| DETECT-02 | Phase 2 | Pending |
| DETECT-03 | Phase 2 | Pending |
| DETECT-04 | Phase 2 | Pending |
| BOT-01 | Phase 2 | Pending |
| BOT-02 | Phase 2 | Pending |
| BOT-03 | Phase 2 | Pending |
| BOT-04 | Phase 2 | Pending |
| BOT-05 | Phase 3 | Pending |
| BOT-06 | Phase 3 | Pending |
| DEPLOY-02 | Phase 4 | Pending |
