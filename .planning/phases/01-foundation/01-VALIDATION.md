---
phase: 1
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-01
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner (`node:test`) — no install needed, available in Node 18+ |
| **Config file** | none — Wave 0 creates test file |
| **Quick run command** | `curl http://localhost:3000/health` |
| **Full suite command** | `node --test tests/webhook.test.js` |
| **Estimated runtime** | ~2 seconds |

---

## Sampling Rate

- **After every task commit:** Run `curl http://localhost:3000/health`
- **After every plan wave:** Run `node --test tests/webhook.test.js` (once created in Wave 0)
- **Before `/gsd-verify-work`:** Full suite must be green + manual Zoom URL validation challenge must pass
- **Max feedback latency:** ~2 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 0 | — | — | Test stubs created | setup | `ls tests/webhook.test.js` | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 1 | INFRA-01 | — | Server starts on PORT | smoke | `curl http://localhost:3000/health` | ❌ W0 | ⬜ pending |
| 1-01-03 | 01 | 1 | INFRA-04 | T-sig | Valid sig accepted; invalid sig → 403 | unit | `node --test tests/webhook.test.js` | ❌ W0 | ⬜ pending |
| 1-01-04 | 01 | 1 | INFRA-04 | T-replay | Expired timestamp (>5 min) → 403 | unit | `node --test tests/webhook.test.js` | ❌ W0 | ⬜ pending |
| 1-01-05 | 01 | 1 | INFRA-04 | T-timing | `timingSafeEqual` used, not `===` | unit | `node --test tests/webhook.test.js` | ❌ W0 | ⬜ pending |
| 1-01-06 | 01 | 1 | INFRA-04 | — | URL validation challenge returns `{ plainToken, encryptedToken }` | unit | `node --test tests/webhook.test.js` | ❌ W0 | ⬜ pending |
| 1-01-07 | 01 | 1 | INFRA-03 | — | POST /webhook sends 200 before any async work | unit | `node --test tests/webhook.test.js` | ❌ W0 | ⬜ pending |
| 1-01-08 | 01 | 1 | DEPLOY-01 | T-secrets | No hardcoded creds in source | lint | `grep -rn "secret\|token" index.js \| grep -v process.env` | manual | ⬜ pending |
| 1-01-09 | 01 | 2 | INFRA-02 | — | Zoom URL validation passes in Marketplace | manual | N/A — requires Zoom UI | manual | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/webhook.test.js` — stubs covering INFRA-03, INFRA-04 (signature verification, URL validation, timestamp check, 200-before-async, timingSafeEqual)
- [ ] No test framework install — Node.js 18+ built-in `node:test` module is sufficient (`require('node:test')`)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Zoom Marketplace app registered, Team Chat enabled, event subscription saved | INFRA-02 | Requires Zoom UI interaction and admin access | Follow Zoom registration sequence in RESEARCH.md; confirm "Validated" status next to webhook URL |
| `chat_message.sent` event received and logged from live Zoom message | INFRA-02 | Requires live Zoom account and real message | After app install, send a message in any monitored channel; check Railway logs for `[webhook] event received: chat_message.sent` |
| Advanced Chat Encryption not blocking webhooks | INFRA-02 | Account-level setting | Verify with Zoom admin that Advanced Chat Encryption is off; if webhooks don't arrive, check this first |

---

## How to Test Without a Live Zoom App

### Simulate URL validation challenge
```bash
node -e "
const crypto = require('crypto');
const secret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN || 'test_secret';
const timestamp = Math.floor(Date.now() / 1000).toString();
const body = JSON.stringify({ event: 'endpoint.url_validation', payload: { plainToken: 'testtoken123' } });
const msg = 'v0:' + timestamp + ':' + body;
const sig = 'v0=' + crypto.createHmac('sha256', secret).update(msg).digest('hex');
console.log('timestamp:', timestamp); console.log('sig:', sig); console.log('body:', body);
"
# Then: curl -X POST http://localhost:3000/webhook -H 'Content-Type: application/json' \
#   -H 'x-zm-request-timestamp: {TS}' -H 'x-zm-signature: {SIG}' -d '{BODY}'
# Expected: { plainToken: "testtoken123", encryptedToken: "..." }
```

### Simulate invalid signature rejection
```bash
curl -X POST http://localhost:3000/webhook \
  -H 'Content-Type: application/json' \
  -H 'x-zm-request-timestamp: 1000000000' \
  -H 'x-zm-signature: v0=invalidsig' \
  -d '{"event":"chat_message.sent"}'
# Expected: 403
```

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (webhook.test.js)
- [ ] No watch-mode flags in test commands
- [ ] Feedback latency < 2s (curl health) / < 5s (node test)
- [ ] `nyquist_compliant: true` set in frontmatter when complete

**Approval:** pending
