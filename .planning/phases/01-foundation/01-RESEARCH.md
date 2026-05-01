# Phase 1: Foundation - Research

**Researched:** 2026-05-01
**Domain:** Zoom webhook infrastructure — Express/Node.js on Railway
**Confidence:** HIGH (core algorithms verified from official Zoom sample repo and multiple corroborating sources)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** JavaScript (CommonJS) — no TypeScript. No build step. Railway deploys `node index.js` directly.
- **D-02:** Single file at root (`index.js`) for Phase 1. No `src/` directory.
- **D-03:** Supporting files at root: `package.json`, `.env.example`, `.gitignore`.
- **D-04:** `console.log` / `console.error` with prefix notation (`[webhook]`, `[verify]`, `[health]`). No logging library.
- **D-05:** `GET /health` returns `{ status: 'ok', ts: Date.now() }`.

### Claude's Discretion
- Exact package versions — use current stable releases of express at planning time
- `.gitignore` contents — standard Node patterns + `.env`
- `package.json` scripts — `start: node index.js` minimum; planner may add `dev` script with nodemon if useful

### Deferred Ideas (OUT OF SCOPE)
- None from discussion phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INFRA-01 | Express server with HTTPS webhook endpoint, deployed on Railway (always-on — no cold starts) | Railway railway.toml with restartPolicyType ALWAYS + healthcheckPath verified |
| INFRA-02 | Zoom General App registered in Zoom Marketplace with Team Chat feature enabled and `chat_message.sent` event subscription configured | Zoom Marketplace registration sequence documented with exact steps |
| INFRA-03 | All webhook events respond with HTTP 200 immediately before any async processing | Express res.sendStatus(200) before async work — pattern documented |
| INFRA-04 | HMAC-SHA256 webhook signature verification using raw request body (not parsed JSON) | Exact algorithm verified from official zoom/webhook-sample; express.raw() pattern documented |
| DEPLOY-01 | All configuration provided via environment variables — no hardcoded values | Complete .env.example structure documented; Railway env var injection verified |
</phase_requirements>

---

## Summary

Phase 1 is pure infrastructure: an Express server that can receive Zoom webhook events, verify their authenticity, respond to the URL validation challenge, and stay alive on Railway without cold starts. No ticket detection, no bot replies.

The single most important technical constraint is the **raw body requirement for HMAC-SHA256 signature verification**. Zoom signs the exact bytes of the request body as it sends them. If Express parses the body into an object and you re-serialize with `JSON.stringify`, you get a match in practice (Zoom sends compact JSON), but the safer and project-mandated approach is `express.raw({ type: '*/*' })` on the webhook route — preserving the raw Buffer and converting to a UTF-8 string for the HMAC input. This approach is confirmed correct by PITFALLS.md and CLAUDE.md.

The **URL validation challenge** is a distinct event (`endpoint.url_validation`) with its own response format: HMAC-SHA256 of the `plainToken` using the webhook secret token, returned as `{ plainToken, encryptedToken }`. This fires when you click "Validate" in the Zoom Marketplace UI and periodically every 72 hours. The endpoint must respond within 3 seconds.

Railway deployment is straightforward: `railway.toml` with `startCommand = "node index.js"`, `restartPolicyType = "ALWAYS"`, and `healthcheckPath = "/health"`. Railway injects `PORT` automatically — use `process.env.PORT || 3000`.

**Primary recommendation:** Single `index.js` using `express.raw({ type: '*/*' })` on the `/webhook` POST route. Verify signature first, respond 200 immediately, then route on `event` type. Health check on `GET /health`. Deploy to Railway with the provided `railway.toml`.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Webhook receipt + signature verification | API / Backend (Node.js) | — | HMAC verification requires server-side secret; never in browser |
| URL validation challenge response | API / Backend (Node.js) | — | Zoom sends POST to the registered endpoint; server responds |
| Health check endpoint | API / Backend (Node.js) | Railway platform | Railway uses `/health` for liveness monitoring |
| Environment variable config | Railway platform (env injection) | Node.js `process.env` | Railway injects; app reads via `process.env` |
| HTTPS termination | Railway platform | — | Railway provides TLS at the edge; app serves plain HTTP internally |

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express | 5.2.1 | HTTP server framework | Latest stable (verified npm registry 2026-05-01); all Zoom official Node.js samples use Express |
| dotenv | 17.4.2 | Load `.env` file into `process.env` | Standard Node.js env var pattern; required for local dev |
| crypto | built-in | HMAC-SHA256 computation | Node.js built-in; no install needed |

### Supporting (Dev Only)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| nodemon | 3.1.14 | Auto-restart on file changes | Local development only; not on Railway |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| express | Fastify, Hono | All Zoom official samples use Express; no benefit switching for a single-route server |
| dotenv | Manual `process.env` | dotenv is the standard; Railway injects env vars without dotenv in production, but dotenv is needed for local `.env` file |
| express.raw() | express.json({ verify: callback }) | Both work; raw() is simpler and more explicit for a webhook-only route |

**Version verification:** Confirmed against npm registry on 2026-05-01.
- `express`: 5.2.1 [VERIFIED: npm registry]
- `dotenv`: 17.4.2 [VERIFIED: npm registry]
- `nodemon`: 3.1.14 [VERIFIED: npm registry]

**Note on Express 5 vs 4:** Express 5 is the current stable release (5.2.1 as of 2026-05-01). Key differences relevant to this project:
- `res.json(obj, status)` syntax is REMOVED — must use `res.status(200).json(obj)` or `res.sendStatus(200)`
- `req.body` returns `undefined` (not `{}`) when no body parser is configured — fine since we use `express.raw()` which populates `req.body` as a Buffer
- `express.raw()`, `express.json()` API is unchanged from v4
- Async error handling improved — route errors auto-forward to error middleware

**Installation:**
```bash
npm install express dotenv
npm install -D nodemon
```

---

## Architecture Patterns

### System Architecture Diagram

```
Zoom Platform
     │
     │  POST /webhook (JSON body, x-zm-signature, x-zm-request-timestamp headers)
     ▼
Railway (TLS termination → plain HTTP to container)
     │
     ▼
index.js — Express server (process.env.PORT)
     │
     ├── GET /health
     │     └── res.json({ status: 'ok', ts: Date.now() })
     │
     └── POST /webhook  [express.raw({ type: '*/*' })]
           │
           ├── 1. VERIFY TIMESTAMP (replay attack window: 5 min)
           │         reject 403 if expired
           │
           ├── 2. VERIFY HMAC-SHA256 SIGNATURE
           │         message = "v0:{timestamp}:{rawBodyUTF8}"
           │         expected = "v0=" + HMAC-SHA256(ZOOM_WEBHOOK_SECRET_TOKEN, message)
           │         compare with x-zm-signature header (timing-safe)
           │         reject 403 if mismatch
           │
           ├── 3. PARSE body as JSON (JSON.parse(req.body))
           │
           ├── 4a. IF event === "endpoint.url_validation"
           │         encryptedToken = HMAC-SHA256(ZOOM_WEBHOOK_SECRET_TOKEN, plainToken)
           │         res.status(200).json({ plainToken, encryptedToken })
           │         RETURN (no further processing)
           │
           └── 4b. ALL OTHER EVENTS
                     res.sendStatus(200)   ← IMMEDIATE, before any async work
                     // Phase 2+ async processing begins here
                     console.log('[webhook]', event, body.event_ts)
```

### Recommended Project Structure
```
zoom.now/
├── index.js          # Single file — Express server, all Phase 1 logic
├── package.json      # Dependencies and scripts
├── .env.example      # Template for required environment variables
├── .gitignore        # Excludes .env, node_modules
└── railway.toml      # Railway deployment configuration
```

### Pattern 1: Webhook Route with Raw Body
**What:** Use `express.raw({ type: '*/*' })` as route-level middleware so `req.body` is a raw Buffer. Parse JSON manually after signature verification.

**When to use:** Always on the webhook route — required for correct HMAC verification regardless of body content.

**Example:**
```javascript
// Source: CLAUDE.md + PITFALLS.md (project research, verified pattern)
const express = require('express');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Health check — no body parsing needed
app.get('/health', (req, res) => {
  res.json({ status: 'ok', ts: Date.now() });
});

// Webhook route — raw body preserved for HMAC verification
app.post('/webhook', express.raw({ type: '*/*' }), (req, res) => {
  const timestamp = req.headers['x-zm-request-timestamp'];
  const signature = req.headers['x-zm-signature'];
  const rawBody = req.body.toString('utf8'); // explicit utf8 — emoji-safe

  // Step 1: Replay attack prevention (5-minute window)
  const ageMs = Date.now() - parseInt(timestamp, 10) * 1000;
  if (ageMs > 5 * 60 * 1000) {
    console.error('[verify] request expired:', ageMs, 'ms old');
    return res.status(403).json({ error: 'Request expired' });
  }

  // Step 2: HMAC-SHA256 signature verification
  const message = `v0:${timestamp}:${rawBody}`;
  const expectedSig = 'v0=' + crypto
    .createHmac('sha256', process.env.ZOOM_WEBHOOK_SECRET_TOKEN)
    .update(message)
    .digest('hex');

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSig);
  if (sigBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    console.error('[verify] signature mismatch');
    return res.status(403).json({ error: 'Invalid signature' });
  }

  // Step 3: Parse body now that signature is verified
  const body = JSON.parse(rawBody);

  // Step 4a: URL validation challenge
  if (body.event === 'endpoint.url_validation') {
    const plainToken = body.payload.plainToken;
    const encryptedToken = crypto
      .createHmac('sha256', process.env.ZOOM_WEBHOOK_SECRET_TOKEN)
      .update(plainToken)
      .digest('hex');
    console.log('[webhook] URL validation challenge responded');
    return res.status(200).json({ plainToken, encryptedToken });
  }

  // Step 4b: All other events — respond 200 IMMEDIATELY
  res.sendStatus(200);
  console.log('[webhook] event received:', body.event, body.event_ts);
  // Phase 2+ async processing will go here
});

app.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`);
});
```

### Pattern 2: URL Validation Challenge
**What:** Zoom sends `endpoint.url_validation` when you save the webhook URL in Marketplace. Your server must respond with `{ plainToken, encryptedToken }` within 3 seconds.

**Critical distinction:** The URL validation challenge uses `plainToken` as the HMAC *input* (not the full `v0:timestamp:body` format used for regular webhook signature verification). These are two different HMAC computations.

| Operation | HMAC Input | HMAC Key | Output |
|-----------|-----------|----------|--------|
| Signature verification | `"v0:{timestamp}:{rawBody}"` | `ZOOM_WEBHOOK_SECRET_TOKEN` | Compare to `x-zm-signature` |
| URL validation response | `plainToken` (from body) | `ZOOM_WEBHOOK_SECRET_TOKEN` | Return as `encryptedToken` |

**Source:** [VERIFIED: zoom/webhook-sample official repo via WebFetch]

### Anti-Patterns to Avoid
- **Global `express.json()` before webhook route:** Parses body into object before HMAC verification runs. Re-serializing with `JSON.stringify` may work when Zoom sends compact JSON but is fragile — emoji and unicode in message text can cause encoding divergence.
- **`res.sendStatus(200)` after async work:** Zoom's 3-second timeout will fire before your processing completes, triggering retries and eventual webhook disablement.
- **String equality for signature comparison:** Use `crypto.timingSafeEqual()` to prevent timing attacks. Never use `===` on signature strings.
- **`latin1` or default encoding for Buffer → string:** Use `'utf8'` explicitly; messages containing emoji will fail HMAC verification with wrong encoding (Pitfall 12 in PITFALLS.md).
- **Missing timestamp check:** Implementing HMAC without the 5-minute replay attack window is a security hole (Pitfall 2 in PITFALLS.md).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTPS/TLS | Custom TLS config | Railway platform TLS | Railway terminates TLS at the edge; app serves HTTP on PORT |
| Timing-safe comparison | String `===` or custom timing loop | `crypto.timingSafeEqual()` | Built into Node.js; hand-rolled timing protection is error-prone |
| Environment variable loading | Custom file parser | `dotenv` | dotenv is the established standard; handles quoting, comments, multiline |
| Process supervision / always-on | pm2 or custom daemon | Railway `restartPolicyType = "ALWAYS"` | Railway restarts container automatically; no pm2 needed on Railway |

**Key insight:** Railway handles TLS, process supervision, and deployment — the application code only needs to listen on `process.env.PORT` and serve HTTP.

---

## Common Pitfalls

### Pitfall 1: Body Already Parsed When Signature Check Runs
**What goes wrong:** If `express.json()` is applied globally (e.g., `app.use(express.json())`), the body is parsed before reaching the webhook route. The raw bytes are gone. You must call `JSON.stringify(req.body)` to reconstruct the string, which works when Zoom sends compact JSON but can fail for emoji-containing messages due to encoding differences.

**Why it happens:** Developers follow general Express tutorials that recommend `app.use(express.json())` at the top.

**How to avoid:** Apply `express.raw({ type: '*/*' })` as route-level middleware on the `/webhook` route only (not globally). Do NOT call `app.use(express.json())` anywhere in this single-file server.

**Warning signs:** Signature verification always fails with real Zoom events; works when you manually construct the request body in tests.

### Pitfall 2: Responding 200 After Async Processing
**What goes wrong:** Any database write, API call, or async operation before `res.sendStatus(200)` can exceed Zoom's 3-second timeout. Zoom marks the delivery failed, retries at 5 min, then 90 min, then permanently disables the subscription. Recovery requires creating a new app.

**How to avoid:** `res.sendStatus(200)` must be the first thing called after signature verification and event routing. All async work happens after the response is sent.

### Pitfall 3: URL Validation Challenge Before Server is Live
**What goes wrong:** Zoom sends the validation challenge the moment you click "Validate" in the Marketplace. If the server isn't live at a public HTTPS URL at that moment, validation fails and you cannot save the event subscription.

**How to avoid:** Deploy to Railway and verify the server is live (curl `/health`) BEFORE clicking "Validate" in the Zoom Marketplace UI.

### Pitfall 4: Wrong Encoding for Buffer → String
**What goes wrong:** `req.body.toString()` uses UTF-8 by default, but calling `.toString('latin1')` or `.toString('binary')` will produce a different string for emoji, producing a different HMAC and causing verification failure for any message containing non-ASCII characters.

**How to avoid:** Always `req.body.toString('utf8')` — explicit encoding.

### Pitfall 5: Missing Team Chat Enable Step
**What goes wrong:** Zoom app created but Team Chat surface not explicitly enabled under Features → Surface → Team Chat. The `imchat:bot` scope never appears. Event subscriptions for `chat_message.sent` won't be available.

**How to avoid:** Follow the Zoom registration sequence in exact order (documented below). Enable Team Chat surface before adding Event Subscription.

### Pitfall 6: Railway Not Restarting After Crash
**What goes wrong:** Default Railway restart policy may be `ON_FAILURE` which does not restart on all failure modes. If the Node.js process exits cleanly (unhandled promise rejection in older Node), Railway won't restart.

**How to avoid:** Set `restartPolicyType = "ALWAYS"` in `railway.toml`.

---

## Zoom Webhook Signature Verification — Complete Algorithm

[VERIFIED: zoom/webhook-sample GitHub repo (official Zoom repository)]

### Regular Webhook Events

**Headers Zoom sends on every POST:**
- `x-zm-signature`: `v0={hex-encoded-hmac}` 
- `x-zm-request-timestamp`: Unix epoch seconds (integer as string)
- `Content-Type`: `application/json`

**Message string to HMAC:**
```
v0:{x-zm-request-timestamp}:{raw-request-body-as-utf8-string}
```

**Algorithm:**
```
signature = "v0=" + HMAC-SHA256(ZOOM_WEBHOOK_SECRET_TOKEN, message).hexdigest()
```

**Verification:** Compare computed `signature` with `x-zm-signature` header using timing-safe comparison.

**Replay attack window:** Reject if `Date.now() - (x-zm-request-timestamp * 1000) > 5 * 60 * 1000` (5 minutes).

### URL Validation Challenge (endpoint.url_validation)

**Trigger:** Fires when you click "Validate" in Zoom Marketplace event subscription UI, and periodically every 72 hours.

**Zoom sends:**
```json
{
  "event": "endpoint.url_validation",
  "event_ts": 1619827392000,
  "payload": {
    "plainToken": "qgg8vlPmX7TkqGZD3TdSaZ"
  }
}
```

**Your server must respond (within 3 seconds):**
```json
{
  "plainToken": "qgg8vlPmX7TkqGZD3TdSaZ",
  "encryptedToken": "<HMAC-SHA256(ZOOM_WEBHOOK_SECRET_TOKEN, plainToken) as hex>"
}
```

**Critical:** The URL validation challenge is signed with the regular `v0:timestamp:body` format like any other webhook. Verify the signature first, THEN compute the `encryptedToken` response. Both the regular signature check AND the URL validation response use the same `ZOOM_WEBHOOK_SECRET_TOKEN`, but the HMAC *inputs* differ:
- Regular verification: HMAC of `"v0:{ts}:{body}"`
- URL validation response: HMAC of `plainToken` string alone

---

## Railway Deployment Configuration

[VERIFIED: docs.railway.com/config-as-code/reference via WebFetch]

### railway.toml (complete)
```toml
[build]
builder = "RAILPACK"

[deploy]
startCommand = "node index.js"
healthcheckPath = "/health"
healthcheckTimeout = 300
restartPolicyType = "ALWAYS"
```

**Notes:**
- `builder = "RAILPACK"` — Railway's default auto-detection; correctly identifies Node.js projects and runs `npm install` automatically.
- `startCommand = "node index.js"` — Overrides Railway's default (which would use `npm start` from package.json). Either works; explicit is safer.
- `healthcheckPath = "/health"` — Railway polls this endpoint to determine if the deployment is healthy. Must return 2xx.
- `healthcheckTimeout = 300` — Seconds Railway waits for health check to pass on first deploy.
- `restartPolicyType = "ALWAYS"` — Restarts the container whenever the process exits for any reason. Critical for always-on behavior.

### PORT Handling
Railway injects `PORT` as an environment variable automatically. [VERIFIED: docs.railway.com/guides/express via WebFetch]

```javascript
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[server] listening on port ${PORT}`));
```

The `|| 3000` fallback is for local development where `PORT` is not set by Railway.

### Environment Variables on Railway
Set via the Railway Dashboard → Service → Variables tab. Variables set in the dashboard are injected into `process.env` at runtime. The `railway.toml` does NOT need to list them — it only controls build/deploy behavior.

**Deployment flow:**
1. Push to GitHub → Railway auto-deploys from the linked branch
2. Or: `railway up` from CLI (requires `npm install -g @railway/cli`)

---

## Zoom General App Registration Sequence

[MEDIUM confidence — reconstructed from official forum guidance and community documentation; exact UI labels may differ slightly from current Marketplace UI]

**Pre-condition:** Railway service must be live at a public HTTPS URL before clicking Validate.

**Step-by-step:**

1. Go to [marketplace.zoom.us](https://marketplace.zoom.us) → Sign in → **Develop** menu → **Build App**
2. Select **General App** → Click **Create**
3. Set **App Name** (e.g., "zoom.now" or "Master Electronics ServiceNow Bot")
4. Under **Select how the app is managed**: select **Admin-managed** → Save

5. **Enable Team Chat surface:**
   - Navigate to **Features** → **Surface** → **Team Chat**
   - Toggle **Team Chat Subscription** ON
   - Set **Bot Name** (visible to users)
   - Enable **Admin Level OAuth** (required for `imchat:bot` scope to appear)
   - Note the **Bot JID** (looks like `abc123@xmpp.zoom.us`) — this is your `ZOOM_BOT_JID`
   - Set **Bot Endpoint URL**: `https://your-railway-domain.up.railway.app/webhook`
   - Save

6. **Add Event Subscription:**
   - Navigate to **Features** → **Access** → **General Features** → **Event Subscription**
   - Click **+ Add New Event Subscription**
   - **Event notification endpoint URL**: `https://your-railway-domain.up.railway.app/webhook`
   - Click **+ Add Events** → Select **Team Chat** category → Select **Chat Message** → Select **Chat Message Sent** (`chat_message.sent`)
   - Click **Save**
   - Click **Validate** — Zoom sends the `endpoint.url_validation` challenge to your endpoint (must be live)
   - If validation passes, the Marketplace shows "Validated" next to the URL
   - Note the **Secret Token** shown in this section — this is your `ZOOM_WEBHOOK_SECRET_TOKEN`

7. **Configure Scopes** → Under **Scopes** add:
   - `imchat:bot` (should auto-appear after Team Chat is enabled)
   - `chat_message:read:admin` (for receiving channel messages)

8. **Install the app:**
   - Navigate to **Local Test** or **OAuth** section → **Add** the app to your account
   - As an admin-managed app, installing once covers the account

**Common failure points:**
- Clicking Validate before the Railway server is live → validation fails, URL greys out
- Not enabling Admin Level OAuth → `imchat:bot` scope missing → error 7010 when sending messages (Phase 2 concern, but scope must be set now)
- Team Chat surface not enabled before adding event subscription → `chat_message.sent` event type not available in the event picker

---

## Package.json — Complete Phase 1

```json
{
  "name": "zoom-now",
  "version": "1.0.0",
  "description": "Zoom Team Chat bot — ServiceNow ticket link bot for Master Electronics",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "dev": "nodemon index.js"
  },
  "dependencies": {
    "dotenv": "^17.4.2",
    "express": "^5.2.1"
  },
  "devDependencies": {
    "nodemon": "^3.1.14"
  },
  "engines": {
    "node": ">=18"
  }
}
```

**Note:** `crypto` is Node.js built-in — no npm install needed. `axios` is not needed in Phase 1 (no outbound Zoom API calls until Phase 2).

---

## .env.example — Phase 1

```bash
# Zoom App Credentials (from Marketplace → App → Credentials tab)
ZOOM_CLIENT_ID=
ZOOM_CLIENT_SECRET=

# Bot Identity (from Marketplace → Features → Team Chat → Bot JID)
ZOOM_BOT_JID=

# Webhook Verification (from Marketplace → Features → Event Subscriptions → Secret Token)
ZOOM_WEBHOOK_SECRET_TOKEN=

# ServiceNow Configuration (Phase 2+ — include now for completeness)
SNOW_DOMAIN=masterelectronics.service-now.com
TICKET_PREFIXES=INC,RITM,REQ
DEDUP_TTL_MINUTES=60
OPT_OUT_KEYWORD=nobot

# Server (Railway injects PORT automatically — this is for local dev fallback only)
PORT=3000
```

**Phase 1 minimally required vars** (validation fails without these):
- `ZOOM_WEBHOOK_SECRET_TOKEN` — signature verification and URL validation challenge
- `PORT` — local dev only; Railway injects this automatically

**Phase 1 present but not yet used** (include so Railway vars are set before Phase 2):
- `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `ZOOM_BOT_JID` — needed for Phase 2 token acquisition and self-reply filter

---

## .gitignore — Phase 1

```
node_modules/
.env
*.log
.DS_Store
```

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | ✓ | v24.14.1 (local) | Railway uses Node 18 LTS by default; compatible |
| npm | Package install | ✓ | Bundled with Node | — |
| Railway CLI | Optional deployment | [ASSUMED] | — | GitHub deploy (no CLI needed) |
| Public HTTPS URL | Zoom validation | via Railway | Provided by Railway domain | ngrok for local testing |

**Railway Node.js version:** Railway's RAILPACK builder auto-detects Node.js version from `engines.node` in package.json. Setting `"engines": { "node": ">=18" }` ensures Railway uses a compatible version. [ASSUMED — based on Railway documentation behavior, not directly verified in this session]

---

## Validation Architecture

nyquist_validation is enabled in `.planning/config.json`.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None installed yet (greenfield) |
| Config file | none — see Wave 0 |
| Quick run command | `node --test tests/webhook.test.js` (Node.js built-in test runner, no install) |
| Full suite command | `node --test tests/*.test.js` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INFRA-01 | Server starts and binds to PORT | smoke | `curl http://localhost:3000/health` | ❌ Wave 0 |
| INFRA-03 | POST /webhook returns 200 before async work | unit | `node --test tests/webhook.test.js` | ❌ Wave 0 |
| INFRA-04 | Valid HMAC-SHA256 signature accepted; invalid rejected | unit | `node --test tests/webhook.test.js` | ❌ Wave 0 |
| INFRA-04 | URL validation challenge returns correct encryptedToken | unit | `node --test tests/webhook.test.js` | ❌ Wave 0 |
| INFRA-04 | Expired timestamp (>5 min) rejected with 403 | unit | `node --test tests/webhook.test.js` | ❌ Wave 0 |
| DEPLOY-01 | No hardcoded credentials in source | lint/manual | `grep -rn "secret\|password\|token" index.js` | manual |
| INFRA-02 | Zoom Marketplace app registered and validated | manual | Cannot automate — requires Zoom UI interaction | manual |

### How to Test Without a Live Zoom App

**Simulating the URL validation challenge:**
```bash
# Generate a test HMAC signature
node -e "
const crypto = require('crypto');
const secret = 'test_webhook_secret_token';
const timestamp = Math.floor(Date.now() / 1000).toString();
const body = JSON.stringify({ event: 'endpoint.url_validation', payload: { plainToken: 'testtoken123' } });
const msg = 'v0:' + timestamp + ':' + body;
const sig = 'v0=' + crypto.createHmac('sha256', secret).update(msg).digest('hex');
console.log('timestamp:', timestamp);
console.log('sig:', sig);
console.log('body:', body);
"
# Then curl with those values:
curl -X POST http://localhost:3000/webhook \
  -H 'Content-Type: application/json' \
  -H 'x-zm-request-timestamp: {TIMESTAMP_FROM_ABOVE}' \
  -H 'x-zm-signature: {SIG_FROM_ABOVE}' \
  -d '{BODY_FROM_ABOVE}'
# Expected response: { plainToken: "testtoken123", encryptedToken: "..." }
```

**Simulating a chat_message.sent event:**
```bash
node -e "
const crypto = require('crypto');
const secret = 'test_webhook_secret_token';
const timestamp = Math.floor(Date.now() / 1000).toString();
const body = JSON.stringify({ event: 'chat_message.sent', event_ts: Date.now(), payload: { account_id: 'ACCTID', object: { id: 'msg123', message: 'INC0001234 is broken', sender_type: 'user', channel_id: 'ch123', to_jid: 'ch@conference.xmpp.zoom.us' } } });
const msg = 'v0:' + timestamp + ':' + body;
const sig = 'v0=' + crypto.createHmac('sha256', secret).update(msg).digest('hex');
console.log('timestamp:', timestamp);
console.log('sig:', sig);
console.log('body:', body);
"
curl -X POST http://localhost:3000/webhook \
  -H 'Content-Type: application/json' \
  -H 'x-zm-request-timestamp: {TIMESTAMP}' \
  -H 'x-zm-signature: {SIG}' \
  -d '{BODY}'
# Expected: 200 OK, console log shows event received
```

**Testing invalid signature rejection:**
```bash
curl -X POST http://localhost:3000/webhook \
  -H 'Content-Type: application/json' \
  -H 'x-zm-request-timestamp: 1000000000' \
  -H 'x-zm-signature: v0=invalidsignature' \
  -d '{"event":"chat_message.sent"}'
# Expected: 403 (expired timestamp, and wrong signature)
```

### Sampling Rate
- **Per task commit:** `curl http://localhost:3000/health`
- **Per wave merge:** `node --test tests/webhook.test.js` (once created in Wave 0)
- **Phase gate:** All unit tests green + manual Zoom validation challenge passes in Marketplace

### Wave 0 Gaps
- [ ] `tests/webhook.test.js` — covers INFRA-03, INFRA-04 (signature verification, URL validation, timestamp check, 200-before-async)
- [ ] No test framework install needed — Node.js 18+ built-in `node:test` module is sufficient

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No user authentication in Phase 1 |
| V3 Session Management | no | Stateless webhook handler, no sessions |
| V4 Access Control | yes | Only Zoom-signed requests accepted (HMAC verification) |
| V5 Input Validation | yes | Signature verification before any body parsing |
| V6 Cryptography | yes | Node.js built-in `crypto.createHmac` + `crypto.timingSafeEqual` |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Webhook spoofing (non-Zoom POST) | Spoofing | HMAC-SHA256 signature verification on every request |
| Replay attack (captured valid webhook re-sent) | Tampering | 5-minute timestamp window check before HMAC |
| Timing attack on signature comparison | Information Disclosure | `crypto.timingSafeEqual()` — never `===` on sig strings |
| Secrets in source code | Information Disclosure | All credentials in `process.env`; `.env` in `.gitignore` |
| Hardcoded fallback tokens | Tampering | DEPLOY-01 enforces no hardcoded values; `.env.example` has only empty values |

---

## Code Examples

### Health Check Route
```javascript
// Source: CONTEXT.md D-05 (locked decision)
app.get('/health', (req, res) => {
  console.log('[health] GET /health');
  res.json({ status: 'ok', ts: Date.now() });
});
```

### Signature Verification Function (extractable)
```javascript
// Source: zoom/webhook-sample (official repo pattern) + PITFALLS.md timing-safe addition
function verifyZoomWebhook(req) {
  const timestamp = req.headers['x-zm-request-timestamp'];
  const signature = req.headers['x-zm-signature'];

  if (!timestamp || !signature) return false;

  // Replay attack window: 5 minutes
  const ageMs = Date.now() - parseInt(timestamp, 10) * 1000;
  if (ageMs > 5 * 60 * 1000) return false;

  const rawBody = req.body.toString('utf8');
  const message = `v0:${timestamp}:${rawBody}`;
  const expectedSig = 'v0=' + crypto
    .createHmac('sha256', process.env.ZOOM_WEBHOOK_SECRET_TOKEN)
    .update(message)
    .digest('hex');

  // Timing-safe comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSig)
    );
  } catch {
    return false; // Buffer length mismatch = definitely not equal
  }
}
```

### URL Validation Challenge Response
```javascript
// Source: zoom/webhook-sample (official repo) — verified via WebFetch
if (body.event === 'endpoint.url_validation') {
  const encryptedToken = crypto
    .createHmac('sha256', process.env.ZOOM_WEBHOOK_SECRET_TOKEN)
    .update(body.payload.plainToken)
    .digest('hex');
  return res.status(200).json({
    plainToken: body.payload.plainToken,
    encryptedToken
  });
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| JWT app type on Zoom | General App (OAuth 2.0) | 2023-2024 | JWT deprecated; General App is the current path |
| `@zoomus/chatbot` npm package | Raw Express + built-in crypto | Nov 2024 (archive) | Package archived; raw approach is preferred |
| Express 4.x | Express 5.x (5.2.1) | Express 5 stable 2024-2025 | `res.json(obj, status)` removed; use `res.status().json()` |
| `bodyParser` package | `express.json()` / `express.raw()` | Express 4.16+ | bodyParser functionality merged into Express core |

**Deprecated/outdated:**
- `@zoomus/chatbot` npm package: archived November 26, 2024 — read-only, no updates. DO NOT USE.
- Zoom JWT app type: deprecated by Zoom in 2023. All new apps must use General App (OAuth 2.0).
- `bodyParser` npm package: superseded by `express.json()` and `express.raw()` built into Express since v4.16.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Railway uses Node 18 LTS by default; `engines.node >= 18` in package.json selects compatible version | Environment Availability | Wrong Node version on Railway could cause startup failure; verify by checking Railway build logs on first deploy |
| A2 | Railway CLI is not pre-installed on developer machine | Environment Availability | No impact — GitHub deployment works without CLI; CLI is optional |
| A3 | `chat_message.sent` is the correct event name (vs `channel_message.sent`) | Zoom Registration Sequence | CONFIRMED AS BLOCKER IN STATE.md — confirm from live payload after Phase 1 deploy |
| A4 | `sender_type` string value for bot messages is `"bot"` | Architecture patterns (Phase 2 concern) | Wrong value means self-reply filter fails in Phase 2 → infinite loop. Log raw payload in Phase 1 to confirm |
| A5 | Zoom Marketplace UI labels match the registration sequence described | Zoom Registration Sequence | UI may have changed; exact tab/button names may differ slightly from documented steps |

---

## Open Questions

1. **`chat_message.sent` vs `channel_message.sent`**
   - What we know: STATE.md flags this as an unconfirmed blocker
   - What's unclear: Zoom forum discussions reference both event names; may be account-tier dependent
   - Recommendation: After Phase 1 deployment, subscribe to both event names if available in UI, log all received events, and confirm from live payloads before Phase 2

2. **Advanced Chat Encryption blocking webhooks**
   - What we know: ARCHITECTURE.md flags this — if enabled on Master Electronics Zoom account, `chat_message.sent` webhooks may not be delivered
   - What's unclear: Whether this feature is enabled on the Master Electronics account
   - Recommendation: Verify with the Zoom account admin before or during Phase 1 deployment. If enabled, contact Zoom support to disable or find alternative.

3. **Express 5.x vs 4.x on Railway**
   - What we know: Express 5.2.1 is current stable; `express.raw()` API unchanged from v4
   - What's unclear: Any Railway-specific issues with Express 5
   - Recommendation: Use Express 5.2.1 as specified; if unexpected issues arise, pinning to `^4.21.2` is a quick fallback

---

## Sources

### Primary (HIGH confidence)
- zoom/webhook-sample GitHub repository (official Zoom repo) — signature verification algorithm, URL validation challenge format [VERIFIED: fetched via WebFetch]
- docs.railway.com/config-as-code/reference — railway.toml fields and structure [VERIFIED: fetched via WebFetch]
- docs.railway.com/guides/express — PORT env var handling [VERIFIED: fetched via WebFetch]
- npm registry — express@5.2.1, dotenv@17.4.2, nodemon@3.1.14 [VERIFIED: npm view commands]
- expressjs.com/en/guide/migrating-5.html — Express 5 breaking changes [VERIFIED: fetched via WebFetch]

### Secondary (MEDIUM confidence)
- .planning/research/PITFALLS.md — pitfall catalogue from prior research session (project artifact)
- .planning/research/ARCHITECTURE.md — architecture patterns and Zoom app setup sequence (project artifact)
- .planning/research/STACK.md — technology stack decisions (project artifact)
- webhooks.fyi/webhook-directory/zoom — Zoom webhook specs including v0: format [MEDIUM: third-party, aligns with official sample]
- Zoom Developer Forum threads on signature verification, Team Chat enable step, timestamp replay prevention [MEDIUM: official forum, Zoom support responses]

### Tertiary (LOW confidence — flagged as ASSUMED)
- Railway default Node.js version behavior [ASSUMED]
- Exact Zoom Marketplace UI labels for current registration flow [ASSUMED — UI may have changed since research]

---

## Metadata

**Confidence breakdown:**
- Signature verification algorithm: HIGH — directly read from official zoom/webhook-sample index.js via WebFetch
- URL validation challenge: HIGH — confirmed from official sample + multiple forum sources
- Railway configuration: HIGH — verified from official Railway docs
- Express 5.x compatibility: HIGH — verified from official Express migration docs + npm registry
- Zoom Marketplace registration sequence: MEDIUM — reconstructed from forum posts + community guides; exact UI labels may differ
- Payload field names (`sender_type`, `channel_id`, etc.): MEDIUM — inferred from samples + forums; recommend logging raw payload from live events

**Research date:** 2026-05-01
**Valid until:** 2026-06-01 (Railway/Express stable; Zoom Marketplace UI flows change infrequently)
