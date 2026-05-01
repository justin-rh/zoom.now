# Technology Stack

**Project:** zoom.now — Zoom Team Chat ServiceNow ticket link bot
**Researched:** 2026-05-01

---

## Recommended Stack

### Zoom App Type

**Use: General App (not legacy "Chatbot" app type)**

| Zoom Concept | Status | Notes |
|---|---|---|
| Legacy "Chatbot" app type | Deprecated / avoid | Still works but Zoom is steering devs away from it |
| General App + Team Chat surface | Current approach (2024+) | Select General App at marketplace creation, then enable Team Chat under Features → Surface |
| `@zoomus/chatbot` npm package | DEPRECATED (archived Nov 2024) | Do not use — archived, read-only, no updates |
| `@zoom/rivet` npm package | Official replacement | v0.3.0, last updated ~2 months ago, early-stage but actively maintained |

**Decision:** Create a General App in the Zoom Marketplace. Under Features → Surface, enable Team Chat and Team Chat Subscription. This is the current documented path as of 2024 per Zoom's developer blog and the Cerebras integration guide.

The legacy "Chatbot" app type still technically functions and Zoom's own quickstart repo (`zoom/chatbot-nodejs-quickstart`) still uses it, but new official guidance and the `@zoom/rivet` SDK are oriented around General Apps.

---

### Core Framework

| Technology | Version | Purpose | Why |
|---|---|---|---|
| Node.js | 18 LTS (minimum) | Runtime | Zoom's own samples require v18+; the `crypto` module for HMAC verification is built-in; largest community of Zoom chatbot examples; official Zoom SDKs target JS/TS |
| Express.js | ^4.18 | HTTP webhook server | Industry standard; all Zoom official Node.js samples use it; minimal boilerplate; built-in body-parser compatibility |

**Node.js vs Python:** Node.js wins for this project. Reasons: (1) Zoom's only official SDK (`@zoom/rivet`, formerly `@zoomus/chatbot`) is JavaScript/TypeScript-only. (2) Zoom's own sample repositories (`chatbot-nodejs-quickstart`, `zoom-erp-chatbot-sample`, `zoom-chatbot-claude-sample`) all use Node.js + Express. (3) The `crypto` module required for webhook HMAC-SHA256 verification ships built-in. Python has no equivalent official Zoom SDK and community examples are sparse. Unless the team has a strong Python mandate, Node.js is the correct choice.

---

### SDK / Zoom Integration Libraries

| Library | Version | Purpose | When to Use |
|---|---|---|---|
| `@zoom/rivet` | ^0.3.0 | Official Zoom API wrapper + webhook server + auth | Use for structured event handling, token management |
| Node.js built-in `crypto` | built-in | HMAC-SHA256 webhook signature verification | Always required — do not skip |
| `axios` | ^1.6 | HTTP client for Zoom API calls | Use for `POST /v2/im/chat/messages` if not using rivet |

**Assessment of `@zoom/rivet`:** Version 0.3.0 is early-stage. It provides `chatbotClient.webEventConsumer.event("bot_notification", handler)` and `teamchatClient.webEventConsumer.onChannelMessagePosted()` abstractions, plus an `endpoints` namespace for API calls. The abstraction is thin enough that raw Express + axios is a viable and simpler alternative for a focused single-purpose bot. Both approaches are valid. Rivet reduces boilerplate for OAuth token refresh; raw Express gives full control and fewer dependency surprises.

**Recommendation:** Start with raw Express + axios + built-in crypto. This keeps the dependency tree minimal, makes webhook verification explicit (auditable), and avoids API churn risk in a v0.x package. Rivet can be adopted later if complexity grows.

**Do NOT use `@zoomus/chatbot`:** This package was archived on November 26, 2024 and is read-only. Any tutorial or StackOverflow answer using it is outdated.

---

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---|---|---|---|
| `dotenv` | ^16.0 | Environment variable loading | Required — all secrets (client ID, client secret, webhook secret token) must be env vars |
| `axios` | ^1.6 | HTTP client | Calling Zoom's `POST /v2/im/chat/messages` API |
| Node.js `crypto` | built-in | Webhook signature verification (HMAC-SHA256) | Required — Zoom sends `x-zm-signature` header, must verify on every request |

**Deduplication storage:** For MVP, an in-memory `Map` with TTL is sufficient (the bot is single-instance, no multi-region requirement). Key: `{channel_id}:{ticket_number}`, TTL: configurable (e.g., 1 hour). Do NOT introduce Redis or a database for v1 — it adds operational overhead with no benefit at single-instance scale.

---

### Infrastructure / Hosting

| Platform | Cold Start | Free Tier | Cost at MVP | Verdict |
|---|---|---|---|---|
| Railway | None (always-on containers) | No (trial credits only; free tier removed 2024) | ~$5/mo Hobby plan | RECOMMENDED |
| Render | 30-60 sec on free tier; paid tiers stay warm | 750 hrs/mo (free) — but with cold start | $7/mo paid (always-on) | Viable at paid tier |
| Vercel | Serverless — cold start per request | Yes | Free for low volume | NOT RECOMMENDED |
| Fly.io | Configurable (can pause or always-on) | Small free allowance | ~$3-5/mo | Viable but more ops complexity |

**Critical constraint for this project:** Zoom webhook delivery has a response timeout. Serverless platforms with cold starts (Vercel Functions, AWS Lambda) can exceed this timeout on cold invocations, causing Zoom to retry or drop the event. Zoom webhook validation also requires a sub-second challenge-response on first endpoint registration. This makes always-on containers required.

**Recommendation: Railway** — no cold starts, deploy from GitHub on push, HTTPS domain included, $5/mo Hobby plan covers this use case entirely. Environment variables configured in dashboard. The lack of a free tier is acceptable for an internal company tool.

**Alternative: Render paid tier ($7/mo)** — if Railway pricing is a concern. Do NOT use Render's free tier for a webhook receiver.

**Do NOT use Vercel** for the webhook server. Vercel Functions are serverless and have cold starts that will cause missed webhook validations and events.

---

## Authentication Flows

There are two distinct auth flows in a Zoom chatbot. Both are required.

### Flow 1: Webhook Signature Verification (incoming)
All POST requests from Zoom include:
- `x-zm-signature` header: `v0={HMAC-SHA256(secret, "v0:{timestamp}:{body}")}`
- `x-zm-request-timestamp` header

Verify using Node.js `crypto.createHmac('sha256', ZOOM_WEBHOOK_SECRET_TOKEN)`. The secret token is configured in the app's Features page on marketplace.zoom.us.

Zoom also sends periodic URL validation challenges (every 72 hours and on first configuration). The endpoint must respond to `event: "endpoint.url_validation"` payloads with a specific HMAC hash challenge response.

### Flow 2: Client Credentials (outgoing — sending messages)
To send messages as the bot, obtain a token via:
```
POST https://zoom.us/oauth/token?grant_type=client_credentials
Authorization: Basic base64(CLIENT_ID:CLIENT_SECRET)
```
This returns a token with `imchat:bot` scope. Use this token as Bearer auth when calling `POST https://api.zoom.us/v2/im/chat/messages`.

Tokens expire in 1 hour. Implement simple refresh: cache token + expiry, re-fetch before expiry.

---

## Required Zoom OAuth Scopes

| Scope | Purpose |
|---|---|
| `imchat:bot` | Required to send messages via `/v2/im/chat/messages`; automatically assigned to General App with Team Chat enabled |
| `chat_message:read:admin` | Required on an account-level app to receive `chat_message.sent` webhook events for all users |
| `chat_message:write:admin` | Complements read scope for account-level chat operations |

---

## Critical Architecture Finding: Passive Channel Listening

**This is the most important platform constraint for this project.**

A General App (chatbot) with the Team Chat surface enabled receives `bot_notification` events **only when a user directly messages the bot or uses a slash command**. It does NOT passively receive all channel messages.

To passively scan all channel messages for ticket numbers, you need an **account-level (admin) app** with `chat_message:read:admin` scope subscribed to the `chat_message.sent` event. This is a separate app type from the chatbot reply mechanism.

**The result is a two-app architecture:**

1. **Account-level General App** (admin install, no UI in client) — subscribes to `chat_message.sent` webhook events for all users on the account. Scopes: `chat_message:read:admin`. This is what reads channel messages and detects ticket numbers.

2. **Chatbot General App** (user-installed, appears in client as a bot contact) — uses Client Credentials flow to send reply messages via `/v2/im/chat/messages`. Scopes: `imchat:bot`. This is what posts the ticket link reply.

Both apps can share the same Node.js Express server (different webhook endpoint paths). Both apps can share the same bot identity for replies.

**Caveat (MEDIUM confidence):** Advanced Chat Encryption, if enabled on the Zoom account, blocks `chat_message.sent` webhook delivery. Verify this is disabled or confirm with Zoom admin before deployment. This was a documented issue as recently as 2021 and Zoom's resolution status is unclear.

**Alternative if two-app approach has friction:** Use a single Chatbot app but require users to @mention the bot or add the bot to channels as a member — the bot will then receive `bot_notification` events for messages in those channels. This is lower friction to set up but changes the UX (bot must be mentioned or a channel member).

---

## What NOT to Use

| Technology | Reason to Avoid |
|---|---|
| `@zoomus/chatbot` npm package | Archived November 2024; no longer maintained; replaced by `@zoom/rivet` |
| Vercel Functions / AWS Lambda | Serverless cold starts will fail Zoom's webhook URL validation timeout and cause dropped events |
| Render free tier | 30-60 second cold starts after inactivity; webhook callbacks will time out |
| Python | No official Zoom SDK; sparse community examples; all Zoom official samples are Node.js |
| Redis / external DB for deduplication at MVP | Unnecessary operational complexity; in-memory Map with TTL is sufficient for single-instance MVP |
| JWT app type | Deprecated by Zoom; replaced by Server-to-Server OAuth and General Apps |
| `@zoom/rivet` v0.x as primary dependency | v0.3.0 is early-stage; its API surface can change in minor versions; build on raw Express + axios for stability at MVP |

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|---|---|---|---|
| Runtime | Node.js 18 LTS | Python | No official Python Zoom SDK; all Zoom samples are Node.js |
| HTTP framework | Express 4 | Fastify, Hono | Express is what all Zoom samples use; no benefit switching for a single-endpoint server |
| Zoom SDK | Raw axios + crypto | `@zoom/rivet` | Rivet is v0.3.0 / early-stage; raw approach is more stable and explicit for MVP |
| Hosting | Railway | Render paid / Fly.io | Railway has no cold start, simple GitHub deploy, $5/mo is appropriate for internal tool |
| Deduplication | In-memory Map | Redis | Redis adds infra cost and ops; in-memory is sufficient for single instance |

---

## Installation

```bash
# Core server dependencies
npm install express axios dotenv

# No Zoom-specific npm package needed for MVP (raw HTTP approach)

# Dev dependencies
npm install -D nodemon @types/node
```

---

## Environment Variables

```
ZOOM_CLIENT_ID=
ZOOM_CLIENT_SECRET=
ZOOM_WEBHOOK_SECRET_TOKEN=
SNOW_BASE_URL=https://masterelectronics.service-now.com
PORT=3000
```

---

## Sources

- [zoom/node.js-chatbot — Deprecated, archived Nov 2024](https://github.com/zoom/node.js-chatbot) — HIGH confidence (official Zoom repo)
- [zoom/rivet-javascript — @zoom/rivet official replacement](https://github.com/zoom/rivet-javascript) — HIGH confidence (official Zoom repo)
- [@zoom/rivet npm — v0.3.0](https://www.npmjs.com/package/@zoom/rivet) — HIGH confidence (npm registry)
- [zoom/chatbot-nodejs-quickstart](https://github.com/zoom/chatbot-nodejs-quickstart) — HIGH confidence (official Zoom repo)
- [Zoom Developer Blog: How to Build a Zoom Chatbot](https://medium.com/zoom-developer-blog/how-to-build-a-zoom-chatbot-c668b7361adb) — MEDIUM confidence (official blog, may be slightly dated)
- [Cerebras: Building an AI-Powered Search Assistant for Zoom Team Chat](https://www.cerebras.ai/blog/building-an-ai-powered-search-assistant-for-zoom-team-chat) — MEDIUM confidence (third-party, 2024)
- [Zoom Dev Forum: Passive channel listening](https://devforum.zoom.us/t/is-it-possible-to-put-chatbot-in-channel-so-it-listens-to-all-users/9175) — MEDIUM confidence (Zoom employee response)
- [Zoom Dev Forum: Capture incoming chat messages](https://devforum.zoom.us/t/capture-incoming-chat-messages-in-chatbot-app/21691) — MEDIUM confidence (Zoom employee response)
- [Zoom Dev Forum: imchat:bot scope error 7010 — General App approach](https://devforum.zoom.us/t/unable-to-get-imchat-bot-scope-getting-error-7010-when-calling-v2-im-chat-messages/142803) — MEDIUM confidence (developer forum, 2024)
- [Zoom Dev Forum: Thread replies in 1:1 DMs](https://devforum.zoom.us/t/clarification-on-zoom-chatbot-webhook-events-for-thread-replies-in-1-1-chats/134812) — MEDIUM confidence (Zoom employee confirmed limitation)
- [Railway vs Render cold start comparison](https://dev.to/alex_aslam/deploy-nodejs-apps-like-a-boss-railway-vs-render-vs-heroku-zero-server-stress-5p3) — MEDIUM confidence (community article)
- [zoom/webhook-sample](https://github.com/zoom/webhook-sample) — HIGH confidence (official Zoom repo, HMAC verification)
