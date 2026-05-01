# Architecture Patterns

**Domain:** Zoom Team Chat chatbot — passive ticket-link bot
**Researched:** 2026-05-01
**Overall confidence:** MEDIUM — webhook payload structure and passive listener behavior verified through multiple forum discussions and official sample repos; exact `chat_message.sent` payload field names are partially inferred from context (Zoom blocks direct API doc access from most scrapers)

---

## Critical Architecture Finding: Two Separate App Mechanisms

This is the most important thing to understand before building.

Zoom has **two separate mechanisms** for a bot to receive messages, and they do not cleanly overlap:

| Mechanism | App Type | Event Received | When It Fires |
|-----------|----------|----------------|---------------|
| **Chatbot endpoint** (Bot Endpoint URL in app config) | General App with Team Chat feature | `bot_notification` | Only when user DMs the bot, or uses a `/command` in a channel where the bot is added |
| **Event Subscription webhook** | General App or Webhook-Only App with `chat_message:read:admin` scope | `chat_message.sent` / `channel_message.sent` | All messages sent in the account (account-level app) |

**The passive listener pattern this project needs (reading ALL messages in ANY channel without being directly addressed) requires the event subscription webhook path**, not the chatbot endpoint path.

A single **General App (OAuth)** configured with:
- Team Chat feature enabled (gives `bot_notification` for DMs + chatbot send capability)
- Event Subscription for `chat_message.sent` (gives passive channel reads)
- `imchat:bot` scope (to send via `/v2/im/chat/messages`)
- `chat_message:read:admin` scope (to subscribe to all messages)

This is the architecture to build.

**Source confidence:** MEDIUM — confirmed by forum thread analysis and sample app patterns; direct doc URL returns 404 at time of research.

---

## Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              ZOOM PLATFORM                                  │
│                                                                             │
│  User types "INC0001234 is broken" in #it-support channel                   │
│                  │                                                          │
│                  ▼                                                          │
│  Zoom fires: POST to HTTPS webhook endpoint                                 │
│  Event: chat_message.sent (or channel_message.sent)                         │
│  Headers: x-zm-signature, x-zm-request-timestamp                           │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │  HTTP POST (JSON payload)
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BOT SERVER (Node.js + Express)                    │
│                                                                             │
│  POST /webhook                                                              │
│    │                                                                        │
│    ├── 1. VERIFY: HMAC-SHA256(secret, "v0:{timestamp}:{body}") == sig?      │
│    │       Reject 403 if mismatch                                           │
│    │                                                                        │
│    ├── 2. ROUTE: event === "endpoint.url_validation"?                       │
│    │       Respond with {plainToken, encryptedToken} — Zoom validation      │
│    │                                                                        │
│    ├── 3. FILTER: Is sender a bot/app? (sender_type check)                  │
│    │       Drop if bot message — prevents reply loops                       │
│    │                                                                        │
│    ├── 4. FILTER: Does message contain opt-out keyword (e.g. "nobot")?      │
│    │       Drop silently if found                                           │
│    │                                                                        │
│    ├── 5. PARSE: Regex scan message text for ticket numbers                 │
│    │       Pattern: /\b(INC|RITM|REQ|CHG|PRB|TASK)\d{7}\b/gi               │
│    │       No tickets found → Drop (no reply needed)                        │
│    │                                                                        │
│    ├── 6. DEDUP: For each ticket, check seen-set                            │
│    │       Key: "seen:{channel_id}:{ticket_number}"                         │
│    │       Already in set → suppress this ticket from reply                 │
│    │       All tickets suppressed → Drop                                    │
│    │                                                                        │
│    ├── 7. BUILD REPLY: Format message with links                            │
│    │       "🔗 INC0001234 → [Open in ServiceNow](https://...)"              │
│    │                                                                        │
│    ├── 8. TOKEN: GET chatbot access token (cached, refresh if expired)      │
│    │       POST https://zoom.us/oauth/token?grant_type=client_credentials   │
│    │       Authorization: Basic base64(CLIENT_ID:CLIENT_SECRET)             │
│    │                                                                        │
│    └── 9. SEND REPLY: POST https://api.zoom.us/v2/im/chat/messages          │
│            Bearer: {chatbot_access_token}                                   │
│            Body: {robot_jid, to_jid, account_id, content: {...}}            │
│                                                                             │
│  Respond 200 OK to Zoom immediately (within 3 seconds)                     │
└─────────────────────────────────────────────────────────────────────────────┘
                               │  POST /v2/im/chat/messages
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              ZOOM API                                       │
│  Delivers bot reply message to original channel                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Exact API Endpoints

### Inbound (Zoom calls your server)

| Endpoint | Direction | Description |
|----------|-----------|-------------|
| `POST {YOUR_WEBHOOK_URL}` | Zoom → Bot | All subscribed events land here |

### Outbound (Your server calls Zoom)

| Endpoint | Method | Purpose | Auth |
|----------|--------|---------|------|
| `https://zoom.us/oauth/token` | POST | Get chatbot access token | Basic `CLIENT_ID:CLIENT_SECRET`, body: `grant_type=client_credentials` |
| `https://api.zoom.us/v2/im/chat/messages` | POST | Send bot reply to channel or DM | Bearer `{chatbot_token}`, scope: `imchat:bot` |

The `/v2/im/chat/messages` endpoint is the **only** send endpoint for chatbot messages. The Chat API (`/v2/chat/users/{id}/messages`) is a user-context endpoint and requires user-level OAuth — it cannot be used by a server-side chatbot.

---

## Webhook Event: Payload Structure

Zoom's API documentation was not directly accessible at research time. The following is reconstructed from official sample repositories, developer forum discussions, and working implementations. Confidence: MEDIUM.

### Request Headers (all webhook events)

```
x-zm-signature:       v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d8a6ed5b2...
x-zm-request-timestamp: 1619827392
Content-Type:         application/json
```

### URL Validation Challenge (one-time, fires on app config save + every 72h)

```json
{
  "event": "endpoint.url_validation",
  "payload": {
    "plainToken": "qgg8vlPmX7TkqGZD3TdSaZ"
  }
}
```

Your server must respond within 3 seconds:

```json
{
  "plainToken": "qgg8vlPmX7TkqGZD3TdSaZ",
  "encryptedToken": "<HMAC-SHA256 of plainToken using WEBHOOK_SECRET_TOKEN, hex>"
}
```

### chat_message.sent Event Payload (inferred from samples + forum)

```json
{
  "event": "chat_message.sent",
  "event_ts": 1619827392000,
  "payload": {
    "account_id": "ABCD1234EFGH",
    "object": {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "type": "channel",
      "date_time": "2024-05-01T12:00:00Z",
      "timestamp": 1619827392000,
      "message": "Hey, INC0001234 is blocking the deploy",
      "sender": "john.doe@masterelectronics.com",
      "sender_id": "AbCdEfGhIjKlMnOpQrSt",
      "sender_type": "user",
      "channel_id": "channel_id_here",
      "channel_name": "it-support",
      "to_jid": "channel_jid_here@conference.xmpp.zoom.us",
      "bot_mid": null
    }
  }
}
```

**Key fields for this project:**

| Field | Use |
|-------|-----|
| `payload.object.message` | Text to regex-scan for ticket numbers |
| `payload.object.sender_type` | Must be `"user"` — skip if `"bot"` or `"app"` |
| `payload.object.sender` | Opt-out lookup (future: per-user preferences) |
| `payload.object.to_jid` | Use as `to_jid` in the reply API call |
| `payload.object.channel_id` | Deduplication key scope |
| `payload.account_id` | Required in the send-message request body |

**Note on sender_type:** The exact string values for bot-sent messages are not confirmed in official docs accessed during this research. Implement a safeguard: also filter on `robot_jid` matching your own `BOT_JID` — if a message's sender_id is your bot, it is your own reply being echoed back. This is the primary loop-prevention gate.

---

## Token Model

Zoom has three authentication grant types. Only one works for chatbot message sending.

| Grant Type | App Type | Can Send via `/v2/im/chat/messages` | Use Case |
|------------|----------|--------------------------------------|----------|
| `client_credentials` | General App (OAuth) | YES — requires `imchat:bot` scope | **This project's send path** |
| `authorization_code` | General App (OAuth) | NO — user-context only | User-facing OAuth flows |
| Server-to-Server OAuth | S2S App | NO — S2S apps cannot have chatbot feature | Background automation without UI |

### Token Acquisition Flow

```
POST https://zoom.us/oauth/token?grant_type=client_credentials
Authorization: Basic base64("{CLIENT_ID}:{CLIENT_SECRET}")

Response:
{
  "access_token": "eyJhbGciOiJSUzI1Ni...",
  "token_type": "bearer",
  "expires_in": 3600
}
```

Tokens are valid for 1 hour. Cache the token with an expiry timestamp. Re-acquire when expired. Do not acquire a new token per-request.

**Critical:** Admin Level OAuth must be enabled on the app in Marketplace, or the `imchat:bot` scope will not appear in the token. This is the most common cause of error 7010 ("Invalid authorization token") when calling the send endpoint.

---

## Send Message Request Body

```
POST https://api.zoom.us/v2/im/chat/messages
Authorization: Bearer {chatbot_access_token}
Content-Type: application/json

{
  "robot_jid": "{BOT_JID}",
  "to_jid": "{channel_or_user_jid_from_webhook}",
  "account_id": "{account_id_from_webhook_payload}",
  "content": {
    "head": {
      "text": "ServiceNow Tickets"
    },
    "body": [
      {
        "type": "message",
        "text": "INC0001234 → https://masterelectronics.service-now.com/incident.do?sysparm_query=number=INC0001234"
      }
    ]
  }
}
```

For plain text replies (simpler), omit `head` and use a single `body[0].text` with the full formatted string.

---

## State Management: Deduplication

### What to Deduplicate

This bot has two deduplication needs:

1. **Webhook-level dedup** — Zoom may redeliver the same webhook event. Use `payload.object.id` (message ID) as the idempotency key. If you've already processed this message ID, return 200 immediately.

2. **Ticket-link dedup** — Suppress the reply if the same ticket was already linked recently in the same channel. Key: `{channel_id}:{ticket_number}`. TTL: configurable, default 60 minutes.

### Strategy Recommendation

**For MVP (single-instance deployment on Vercel/Render/Railway): Use in-memory Map with TTL.**

A JavaScript `Map` with a cleanup interval handles both needs for a single-process bot with no scaling requirement:

```javascript
const seen = new Map(); // key -> expiry_timestamp

function isDuplicate(key, ttlMs = 3600000) {
  const now = Date.now();
  if (seen.has(key) && seen.get(key) > now) return true;
  seen.set(key, now + ttlMs);
  return false;
}
```

Cleanup stale entries every 10 minutes to prevent unbounded growth.

**For production (multi-instance or stateless functions like Vercel): Use Redis (Upstash recommended).**

Vercel serverless functions are stateless — each request may hit a different function instance. In-memory dedup would fail silently. Upstash Redis provides a serverless-compatible Redis with HTTP API (no persistent connection required):

```
SET seen:{channel_id}:{ticket}  1  NX  EX  3600
```

Returns `OK` on first write (not seen), `null` on subsequent (duplicate — suppress).

| Deployment | Dedup Strategy | Why |
|------------|---------------|-----|
| Single process (Render, Railway) | In-memory Map | Simple, zero dependencies, sufficient |
| Vercel serverless | Upstash Redis (HTTP) | Required — no shared memory across invocations |
| Docker / EC2 single container | In-memory Map | Same reasoning as single process |

---

## Environment Variable Structure

```bash
# Zoom App Credentials (from Marketplace app → Credentials tab)
ZOOM_CLIENT_ID=abc123
ZOOM_CLIENT_SECRET=supersecret
ZOOM_BOT_JID=abc123@xmpp.zoom.us          # Bot's JID from Marketplace → Features → Team Chat

# Zoom Webhook Verification
ZOOM_WEBHOOK_SECRET_TOKEN=wh_secret_here   # From Marketplace app → Features → Event Subscriptions

# ServiceNow Configuration
SNOW_DOMAIN=masterelectronics.service-now.com

# Ticket Prefix → Table Mapping (JSON or individual vars)
SNOW_TICKET_PREFIXES=INC:incident,RITM:sc_req_item,REQ:sc_request,CHG:change_request,PRB:problem,TASK:task

# Bot Behavior
OPT_OUT_KEYWORD=nobot
DEDUP_TTL_MINUTES=60

# Optional: Redis for multi-instance dedup
REDIS_URL=redis://default:password@host:port

# Server
PORT=3000
```

---

## Zoom App Setup (Marketplace)

The app must be a **General App** (not Server-to-Server, not JWT — those cannot have the chatbot feature):

1. Go to marketplace.zoom.us → Develop → Build App → **General App**
2. Set Intent: Internal (no Marketplace review required)
3. Under **Features** → Add **Team Chat** feature
   - Set Bot Name, enable "Admin Level OAuth"
   - Note the **Bot JID** (your `ZOOM_BOT_JID`)
   - Set **Chatbot Endpoint URL**: `https://your-domain.com/webhook`
4. Under **Features** → Add **Event Subscriptions**
   - Event notification endpoint URL: same `https://your-domain.com/webhook`
   - Subscribe to: `chat_message.sent` (under Team Chat events)
   - Note the **Secret Token** (your `ZOOM_WEBHOOK_SECRET_TOKEN`)
5. Under **Scopes** → Add:
   - `imchat:bot` (auto-added when Team Chat feature is enabled)
   - `chat_message:read:admin` (for event subscription)
   - `chat_channel:read:admin` (may be required for channel context)
6. Under **OAuth** → Enable **Admin Level OAuth**
7. **Install the app** to your account (internal app — admin approves once, applies to all users)

---

## Critical Path: Build Order

The following sequence is the minimum path to a working end-to-end message flow.

### Step 1: Scaffold HTTP server with webhook endpoint
- Express (or Hono/Fastify) server with `POST /webhook`
- Return 200 immediately for all requests
- Deploy to any public HTTPS host (Render free tier works)
- **Gate:** Zoom can make HTTP POST requests to your URL

### Step 2: Implement URL validation challenge
- Parse `endpoint.url_validation` event
- Compute HMAC-SHA256 of `plainToken` using `WEBHOOK_SECRET_TOKEN`
- Return `{plainToken, encryptedToken}` with 200
- **Gate:** Zoom Dashboard shows "Validated" next to webhook URL

### Step 3: Implement signature verification
- HMAC-SHA256(`WEBHOOK_SECRET_TOKEN`, `"v0:{timestamp}:{raw_body}"`) → compare to `x-zm-signature`
- Reject mismatches with 403
- **Gate:** Security baseline is in place

### Step 4: Wire Zoom Marketplace app
- Create General App, add Team Chat feature, add Event Subscription
- Enter webhook URL, validate it (Step 2 must already be live)
- Install the app to your account
- **Gate:** App is installed, events will fire

### Step 5: Log incoming events
- Log raw payload to console/file
- Send a test message in Zoom
- **Gate:** You can see the actual `chat_message.sent` payload with real field values from your account — this confirms the event structure and sender_type values

### Step 6: Implement bot-filter and opt-out
- Drop if sender_type is not "user" OR sender_id == BOT_JID
- Drop if message contains opt-out keyword
- **Gate:** Bot does not reply to its own messages; opt-out works

### Step 7: Implement regex parser
- Match `/\b(INC|RITM|REQ|CHG|PRB|TASK)\d{7}\b/gi`
- Deduplicate ticket list (one message may contain same ticket twice)
- **Gate:** Unit test with representative messages passes

### Step 8: Implement token acquisition
- POST to token endpoint with `client_credentials`
- Cache token with expiry
- **Gate:** Token arrives with `imchat:bot` scope (confirm by decoding JWT)

### Step 9: Implement reply sending
- Build message body with ticket links
- POST to `/v2/im/chat/messages`
- **Gate:** Reply appears in the channel where you sent the test message

### Step 10: Implement deduplication
- In-memory Map (or Redis for Vercel)
- Key: `{channel_id}:{ticket_number}`, TTL: 60 min
- **Gate:** Second mention of same ticket in same channel within TTL window suppresses reply

---

## Architecture Anti-Patterns to Avoid

### Anti-Pattern 1: Using Server-to-Server OAuth for the send path
**What goes wrong:** S2S apps do not support the Team Chat chatbot feature. The `/v2/im/chat/messages` endpoint returns 404 or 7010 with S2S tokens.
**Instead:** Use General App with client_credentials grant.

### Anti-Pattern 2: Fetching a new token per webhook event
**What goes wrong:** Rate limit on token endpoint; latency spike on every message.
**Instead:** Cache token with its expiry, refresh only when expired.

### Anti-Pattern 3: Using /v2/chat/users/{id}/messages to send the reply
**What goes wrong:** This is the user-context Chat API. It requires a user OAuth token (authorization_code flow) and acts as a named user — not the bot. Messages appear to come from a person.
**Instead:** Use `/v2/im/chat/messages` with the chatbot token.

### Anti-Pattern 4: Processing events asynchronously before responding 200
**What goes wrong:** Zoom's webhook delivery has a 3-second timeout. If your processing (SNOW URL building, Redis check, token fetch) takes longer, Zoom marks the delivery as failed and retries. Retries compound the problem.
**Instead:** Respond 200 immediately, then process. In Express: `res.sendStatus(200)` before any async work.

### Anti-Pattern 5: Relying on in-memory state on Vercel
**What goes wrong:** Vercel serverless functions are stateless. Each invocation may be a new Node.js process. In-memory Map for dedup will not persist between requests.
**Instead:** Use Upstash Redis for any persistent state on Vercel.

### Anti-Pattern 6: Subscribing only to bot_notification without chat_message.sent
**What goes wrong:** `bot_notification` fires only when a user directly messages the bot or invokes a slash command. Messages in channels where the bot is present but not directly addressed produce no `bot_notification` event. The bot will silently miss ticket numbers in channel traffic.
**Instead:** Subscribe to `chat_message.sent` event subscription (account-level) which fires for all messages.

---

## Scalability Notes

This bot is stateless except for the dedup cache. For Master Electronics scale:

| Scale | Approach |
|-------|----------|
| 1–500 users | Single Node.js process, in-memory dedup, any cheap host |
| 500–5000 users | Single process is still fine; add Redis for crash recovery; log to file |
| 5000+ users | Stateless function behind load balancer, Redis required for dedup |

Zoom webhooks are delivered from Zoom's infrastructure. There is no polling. Bot server only runs code when messages arrive.

---

## Sources

- Zoom chatbot quickstart sample (zoom/chatbot-nodejs-quickstart): Node.js/Express, client_credentials token, `/v2/im/chat/messages` endpoint pattern — HIGH confidence
- Zoom cohere/claude/cerebras sample apps (zoom/zoom-cohere-chatbot-sample, zoom/zoom-chatbot-claude-sample): confirmed env var set, confirmed client_credentials flow — HIGH confidence
- Developer forum thread on imchat:bot error 7010 (devforum.zoom.us/t/unable-to-get-imchat-bot-scope): Admin Level OAuth required — HIGH confidence
- Zoom node.js-chatbot README: library deprecated in favor of @zoom/rivet; `bot_notification` is command/DM only — HIGH confidence
- Developer forum on passive channel listening (devforum.zoom.us/t/is-it-possible-to-put-chatbot-in-channel-so-it-listens-to-all-users): confirmed chatbot alone cannot passively listen — HIGH confidence
- Developer forum: webhook not receiving chat_message.sent events (138385, 58747): account-level app + `channel_message.sent` subscription required — MEDIUM confidence
- Developer forum thread on thread reply events (134812): `chat_message.replied` does not fire in DMs — HIGH confidence
- Zoom webhook verification algorithm (webhook-retries guide, Cloudflare community, Moveworks): HMAC-SHA256 `v0:{timestamp}:{body}` format — HIGH confidence
- Redis deduplication pattern (redis.io/tutorials/data-deduplication-with-redis): SET NX EX pattern — HIGH confidence
- Payload field structure (inferred from multiple forum posts + working sample repos): MEDIUM confidence — recommend logging raw payload in Step 5 to confirm before writing parser
