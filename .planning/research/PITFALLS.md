# Domain Pitfalls: Zoom Team Chat Chatbot

**Domain:** Zoom Team Chat webhook bot (ServiceNow ticket linker)
**Researched:** 2026-05-01
**Project:** zoom.now — Master Electronics

---

## Critical Pitfalls

Mistakes that cause security failures, infinite loops, or complete loss of webhook delivery.

---

### Pitfall 1: Raw Body Destroyed Before Signature Verification

**What goes wrong:** Express.js (or any JSON body-parser middleware) parses the raw request body into a JavaScript object before your verification code runs. Zoom's HMAC-SHA256 signature is computed over the exact raw byte string `v0:{timestamp}:{raw_body}`. Once the body has been parsed and re-serialized, the byte sequence no longer matches what Zoom signed — especially if the original payload had compact JSON spacing, unicode escapes, or specific key ordering. Signature verification always fails.

**Why it happens:** Developers register `express.json()` globally before the webhook route, or use a framework default that parses all POST bodies automatically.

**Consequences:** Either verification is never implemented (security hole), or it is implemented but always returns 401/403 (bot goes completely silent), or the team disables verification to "make it work" (security hole).

**Prevention:**
- Use `express.raw({ type: 'application/json' })` on the webhook route only, keeping the raw Buffer in `req.body`.
- Alternatively, use `express.json({ verify: (req, res, buf) => { req.rawBody = buf; } })` to capture the raw bytes before parsing.
- Run signature verification against `req.rawBody` or the raw Buffer, not `JSON.stringify(req.body)`.
- The exact message string Zoom expects: `v0:${req.headers['x-zm-request-timestamp']}:${rawBodyString}`
- Then compare `v0=${hmacSha256Hex(webhookSecretToken, message)}` against `req.headers['x-zm-signature']`.

**Detection:** Signature verification always fails in staging but the payload looks correct; or verification passes in local testing (where you construct the body yourself) but fails with real Zoom events.

**Phase:** Phase 1 (Foundation & Webhook Setup)

---

### Pitfall 2: Missing Timestamp Replay-Attack Window

**What goes wrong:** Developers implement HMAC verification but skip timestamp validation. Zoom sends `x-zm-request-timestamp` (Unix seconds) with every webhook. Without checking that the timestamp is within 5 minutes of `Date.now()`, a captured valid webhook request can be replayed indefinitely. This is a security vulnerability, not just a theoretical concern — Zoom's official documentation explicitly recommends the 5-minute window.

**Why it happens:** The timestamp header is easy to overlook when focused on getting HMAC working. Many tutorials only show the HMAC step.

**Consequences:** Attacker who intercepts a valid Zoom webhook can replay it to trigger repeated bot replies.

**Prevention:**
```javascript
const timestampSeconds = parseInt(req.headers['x-zm-request-timestamp'], 10);
const ageMs = Date.now() - timestampSeconds * 1000;
if (ageMs > 5 * 60 * 1000) {
  return res.status(403).json({ error: 'Request expired' });
}
```
Add this check before the HMAC check, not after.

**Detection:** No warning signs — this is a silent vulnerability. Only caught by code review.

**Phase:** Phase 1 (Foundation & Webhook Setup)

---

### Pitfall 3: Bot Reply Infinite Loop

**What goes wrong:** The bot sends a reply to a channel. Zoom fires a new `chat_message.sent` event for the bot's own reply. The bot processes that event, finds no ticket numbers (or finds the same ticket in the reply text), and either replies again or re-processes in a tight loop. Even without ticket numbers, a misconfigured filter can cause a loop if the bot's own messages trigger processing.

**Why it happens:** The `chat_message.sent` event fires for every message in a subscribed channel, including messages sent by the bot itself. The Zoom Node.js chatbot library documentation does not cover self-reply filtering. There is no built-in suppression.

**Consequences:** Bot spams the channel with repeated replies, potentially hitting rate limits (429) and exhausting the chatbot token within an hour.

**Prevention:**
- The webhook payload for `chat_message.sent` contains the sender's user ID. The bot's own Zoom user ID (its `botJid` or app user ID) must be stored at startup and compared against `payload.object.sender.id` (or the equivalent field in the event structure).
- Cross-check against the app's `client_id` or bot JID: if `event.payload.object.sender_type === 'bot'` or the sender JID matches your bot's JID, return 200 immediately without processing.
- As a belt-and-suspenders measure: check whether the message text is identical to a message your bot just sent (in-memory last-sent cache per channel, TTL 30 seconds).

**Warning signs:** Bot replies appear in duplicate or triplet; 429 errors in logs shortly after bot sends a message; bot replies to messages in its own thread.

**Phase:** Phase 1 (Foundation & Webhook Setup) — must be built before any production testing

---

### Pitfall 4: Chatbot Token vs. OAuth Token Confusion

**What goes wrong:** Zoom has two distinct token types for chatbot apps. The **Chatbot Token** is obtained via OAuth2 Client Credentials grant (`POST https://zoom.us/oauth/token?grant_type=client_credentials`) and is the only token valid for `POST /v2/im/chat/messages` (the chatbot send API). The **OAuth Access Token** is obtained via Authorization Code grant and is used for user-context Zoom APIs. Developers often obtain an OAuth token (e.g., from a user OAuth flow) and attempt to use it to send chatbot messages — this worked in older API versions but now returns a 401 or 7004 error.

**Why it happens:** Both tokens look identical (Bearer JWTs). Documentation for Zoom's Chat API and Chatbot API lives in different sections. The Zoom developer forum confirms the incompatibility was introduced in a breaking change with no grace period.

**Consequences:** `POST /v2/im/chat/messages` returns 401 or error code 7004 "Not authorized" even though the token appears valid. The bot silently fails to send replies.

**Prevention:**
- Use Client Credentials grant specifically for chatbot message sending:
  ```
  POST https://zoom.us/oauth/token?grant_type=client_credentials
  Authorization: Basic base64(clientId:clientSecret)
  ```
- Cache the returned `access_token` and track its `expires_in` (3600 seconds / 1 hour).
- Re-request a fresh token before expiry — do not attempt token refresh (Client Credentials has no refresh token; just re-request).
- Never reuse an Authorization Code flow token for chatbot sends.

**Warning signs:** `error_code: 7004` in API responses; HTTP 401 from chatbot send endpoint; works in Postman with manually generated token but fails in production.

**Phase:** Phase 1 (Foundation & Webhook Setup)

---

### Pitfall 5: Webhook Endpoint Disabled by Zoom After Downtime

**What goes wrong:** Zoom attempts to deliver webhook events with a 3-second response timeout. If the endpoint fails to respond with 200/204, Zoom retries at 5 minutes, then again at roughly 90 minutes. If all retries fail, Zoom disables the webhook subscription. **Once disabled, the endpoint configuration fields in the Zoom App Marketplace become greyed out and uneditable.** The only recovery is creating a new app entirely.

Additionally, Zoom periodically re-validates the endpoint URL even after successful registration. If the endpoint is down during a revalidation ping, an email warning is sent and webhooks may be suspended.

**Why it happens:** Serverless platforms (Vercel, Render free tier) have cold-start latency or spin-down-after-inactivity behavior that causes the first request to take 5-10 seconds — exceeding Zoom's 3-second timeout. The endpoint returns 200 eventually, but Zoom already marked it as failed.

**Consequences:** All webhook events for the entire account stop being delivered. Requires creating a new Zoom app and re-installing it.

**Prevention:**
- Return 200 immediately upon webhook receipt (before any processing):
  ```javascript
  res.status(200).json({ status: 'ok' });
  // then process asynchronously
  processEvent(event);
  ```
- Use a hosting platform with no cold-start: Railway, Render (paid), or a persistent Node.js process rather than serverless functions.
- Implement a `/health` endpoint and use an uptime monitor (UptimeRobot free tier) to keep the process warm.
- Keep webhook processing logic under 2 seconds total — store to queue if needed.

**Warning signs:** Zoom developer dashboard shows "Event Subscription: Disabled"; missing webhook events with no errors in your logs; email from Zoom about endpoint validation failure.

**Phase:** Phase 2 (Deployment & Infrastructure) — hosting choice must account for cold-start behavior

---

## Moderate Pitfalls

Mistakes that cause incorrect behavior or require significant rework.

---

### Pitfall 6: Regex Without Word Boundaries — False Positives

**What goes wrong:** The pattern `/(INC|RITM|REQ|CHG|PRB|TASK)\d{7}/g` matches ticket numbers embedded inside larger strings without boundaries. For example: a URL containing `INCIDENT0001234` would match as `INCIDENT` fails (prefix mismatch) but a string like `REINC0001234` would incorrectly match as `INC0001234`. More practically, product codes, order numbers, or tracking IDs at the company may share prefix patterns. Also, the regex is case-sensitive by default — a user typing `inc0001234` or `Inc0001234` produces no match.

**Why it happens:** The example on regex101.com for ServiceNow tickets (`/(INC|PRB)\d{7}/gm`) explicitly omits word boundaries, as noted in research.

**Consequences:** Bot replies to messages that don't actually contain ticket numbers (noise), or misses tickets typed in lowercase (missed detections).

**Prevention:**
- Use word boundaries and case-insensitive flag:
  ```javascript
  /\b(INC|RITM|REQ|CHG|PRB|TASK)\d{7}\b/gi
  ```
- After matching, normalize to uppercase before constructing the ServiceNow URL (all ServiceNow ticket numbers are uppercase in the system).
- Test the regex against: URLs, code snippets, `REINC0001234`, `INC001234` (6 digits — should not match), `INC00012345` (8 digits — should not match).

**Warning signs:** Bot replies to messages containing internal part numbers or order codes; bot misses tickets mentioned in lowercase.

**Phase:** Phase 1 (Core Detection Logic)

---

### Pitfall 7: Deduplication Window That Is Too Aggressive or Too Passive

**What goes wrong:** Two failure modes exist. (A) Window too long: A ticket opened last week is mentioned again in a new conversation — bot stays silent because it already linked it 3 days ago. Users think the bot is broken. (B) Window too short or keyed wrong: The bot replies every time the same ticket is mentioned in rapid succession (e.g., multiple team members paste the same ticket number in a discussion). This creates a reply flood if 5 people mention the same ticket within 30 seconds.

There is also a key-design failure: keying deduplication on `ticket_number` globally instead of `channel_id + ticket_number`. A ticket mentioned in #engineering and #support are independent conversations — both should receive a link.

**Why it happens:** Dedup is typically an afterthought, implemented with a simple in-memory Set with a global key and a single TTL.

**Consequences:** Either bot goes silent on legitimate repeat mentions, or bot fires multiple replies in a busy channel causing noise complaints and removal of the bot.

**Prevention:**
- Key: `${channel_id}:${ticket_number}` (never global key).
- Recommended TTL: 30–60 minutes. This covers active conversation windows without suppressing the ticket across separate discussions hours later.
- Use a Map with timestamps rather than a Set: `Map<string, number>` where value is `Date.now()`. On each event, check if `Date.now() - lastSeen < TTL_MS`.
- Periodic cleanup: delete entries older than TTL to prevent unbounded memory growth.
- For the `nobot` keyword suppress, this is per-message (no TTL needed) — but ensure the keyword check runs before dedup check so it always suppresses even for first mentions.

**Warning signs:** Users report "bot didn't respond" when mentioning a ticket they'd mentioned before; or users report "bot replied 3 times" in a fast-moving channel.

**Phase:** Phase 1 (Core Detection Logic)

---

### Pitfall 8: ServiceNow URL Construction for Unknown Prefixes

**What goes wrong:** The configured prefix-to-table map (INC→incident, RITM→sc_req_item, etc.) does not cover every possible ticket prefix that might appear in chat. If a user mentions a ticket with a prefix not in the map (e.g., `SCTASK0001234`, `KB0001234`, `SYSID00000001`), the bot has three bad options: silently skip it (inconsistent behavior), use a wrong table (broken link), or crash (unhandled exception).

Additionally, ServiceNow URL format matters. The pattern `/{table}.do?sysparm_query=number={TICKET}` is the standard list view filtered by number. This is correct and does not require URL encoding because ServiceNow ticket numbers are alphanumeric with no special characters. However, if someone extends the system to use `sys_id` lookups or adds display values with spaces, URL encoding becomes critical.

**Why it happens:** Developers map only the known prefixes and do not implement a fallback. Unknown prefix handling is forgotten during initial implementation.

**Consequences:** Bot partially works — it links known ticket types but silently ignores others, which is confusing and erodes trust.

**Prevention:**
- Implement a defined fallback for unknown prefixes: either link to the ServiceNow global search (`/textsearch.do?sysparm_search={TICKET}`) or skip the unknown ticket with a log warning.
- Make the fallback behavior configurable via environment variable: `UNKNOWN_PREFIX_BEHAVIOR=search|skip`.
- The URL structure for known tickets requires no `encodeURIComponent` since ticket numbers are alphanumeric only. Do not add unnecessary encoding that could break the URL.
- Validate the constructed URL format before deployment against the actual ServiceNow instance.

**Warning signs:** Bot links work for INC tickets but not RITM tickets; bot silently ignores CHG mentions; logs show `undefined` in URL path.

**Phase:** Phase 1 (Core Detection Logic)

---

### Pitfall 9: Duplicate Webhook Event Delivery

**What goes wrong:** Zoom occasionally delivers the same webhook event twice, with different `event_ts` values but identical payload content. The `x-zm-trackingid` header is the same for duplicate events from the same delivery attempt, but may differ for separate retry attempts. If the bot processes both, it sends two replies for the same message.

**Why it happens:** Zoom's retry mechanism can fire while the initial delivery is still being processed, especially for endpoints that respond slowly. Also, duplicate subscriptions (e.g., a development app and production app both subscribed to the same events) produce two identical deliveries with different `client_id` headers.

**Consequences:** Bot sends double replies, users see duplicate link messages.

**Prevention:**
- Track processed message IDs in-memory: `processedMessages = new Set<string>()` keyed on the message ID from the webhook payload (not `event_ts`). TTL cleanup after 10 minutes.
- If running dev and production environments pointing to the same Zoom account, use different webhook subscriptions with distinct client IDs and check `req.headers['x-zm-clientid']` to filter unintended environments.
- The idempotency check should be the first thing after signature verification, before any database writes or API calls.

**Warning signs:** Bot sends two replies to the same user message; double entries in reply logs.

**Phase:** Phase 1 (Foundation & Webhook Setup)

---

## Minor Pitfalls

Issues that cause friction but can be fixed without architectural rework.

---

### Pitfall 10: Missing Team Chat Enable Step in App Configuration

**What goes wrong:** Creating a Zoom app and adding OAuth scopes does not automatically enable the Team Chat functionality. There is a specific "Team Chat" section in the app configuration that must be explicitly enabled. Without this step, `imchat:bot` and related scopes will not appear in the scope selection UI, and any tokens obtained will be missing those scopes. The resulting error is code 7010 "Invalid Token" or 7004 "Not authorized."

**Prevention:** After creating the app, navigate to the "Team Chat" tab in the app configuration and explicitly enable it before configuring scopes. Verify `imchat:bot` appears in the scope list before proceeding.

**Phase:** Phase 1 (Foundation & App Setup)

---

### Pitfall 11: Admin Approval Required for Internal App Installation

**What goes wrong:** Even though internal apps skip Zoom Marketplace review, installing a chatbot app on a Zoom account requires account admin privileges. The developer's personal account can install it for themselves during development, but rolling out to a team or company-wide requires admin OAuth consent. If the installing user is not an admin, they see: "You cannot authorize the app. An account admin is required to install this type of app."

**Prevention:** Plan for the admin approval step in the rollout. The OAuth authorization URL must be opened by a Zoom account admin (or Owner), not a regular user. Coordinate with IT/Zoom admin at Master Electronics before the team rollout milestone.

**Phase:** Phase 3 (Rollout) — not a development issue, but a deployment planning issue

---

### Pitfall 12: Emoji and Unicode in Webhook Payloads Breaking Signature Verification

**What goes wrong:** Zoom webhook events can contain emoji or Unicode characters in the message body (the `chat_message.sent` event payload includes the message text). If the signature verification code converts the raw Buffer to a string using the wrong encoding (e.g., `latin1` or default `ascii` instead of `utf8`), the HMAC input string will differ from what Zoom computed, and verification will fail for any message containing non-ASCII characters. This affects roughly any chat message containing emoji, accented names, or non-English text.

**Prevention:**
```javascript
const rawBodyString = req.rawBody.toString('utf8'); // explicit utf8
const message = `v0:${timestamp}:${rawBodyString}`;
```
Always specify `'utf8'` explicitly when converting the raw buffer to a string.

**Warning signs:** Signature verification fails intermittently, only on messages with emoji or non-ASCII content; regular ASCII messages verify correctly.

**Phase:** Phase 1 (Foundation & Webhook Setup)

---

## Phase-Specific Warnings Summary

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|----------------|------------|
| Webhook route setup | Raw body destroyed by middleware (Pitfall 1) | `express.raw()` on the webhook route only |
| Signature verification | Missing timestamp check (Pitfall 2) | 5-minute window check before HMAC |
| First bot reply | Self-reply infinite loop (Pitfall 3) | Check sender JID/type before processing |
| Token acquisition | Chatbot token vs OAuth confusion (Pitfall 4) | Client Credentials grant only |
| Hosting choice | Cold-start causing endpoint disablement (Pitfall 5) | Return 200 immediately, async processing |
| Regex implementation | False positives from missing boundaries (Pitfall 6) | `\b...\b` with `/gi` flags |
| Dedup implementation | Wrong key scope or bad TTL (Pitfall 7) | Key on `channel_id:ticket`, 30–60 min TTL |
| Prefix→table map | No fallback for unknown prefixes (Pitfall 8) | Configurable fallback behavior |
| Webhook processing | Duplicate event delivery (Pitfall 9) | Message ID idempotency check |
| App creation | Team Chat not enabled → missing scopes (Pitfall 10) | Enable Team Chat section before scope config |
| Rollout planning | Admin approval required (Pitfall 11) | Coordinate with Zoom admin before team rollout |
| Unicode messages | Emoji breaks signature (Pitfall 12) | Explicit `utf8` encoding in buffer conversion |

---

## Sources

- [Zoom Webhook Signature Verification — Svix review](https://www.svix.com/blog/reviewing-zoom-webhook-docs/) — MEDIUM confidence (third-party analysis, verified against forum posts)
- [Zoom Developer Forum: Emoji in webhook payload breaks signature](https://devforum.zoom.us/t/cannot-verify-signature-due-to-emoji-in-the-webhook-payload/130223) — HIGH confidence (official forum, confirmed by multiple reporters)
- [Zoom Developer Forum: Scope missing when authenticating chatbot app](https://devforum.zoom.us/t/scope-missing-when-authenticating-chatbot-app/87506) — HIGH confidence (official forum)
- [Zoom Developer Forum: Webhook retry timeout](https://devforum.zoom.us/t/webhook-increase-timeout-or-do-not-try-retries/87675) — HIGH confidence (Zoom MVP response)
- [Zoom Developer Forum: Endpoint disabled, fields greyed out](https://devforum.zoom.us/t/modifying-event-notification-endpoint-url-after-app-disablement/80973) — HIGH confidence (official forum, MVP confirmed)
- [Zoom Developer Forum: Duplicate webhook events](https://devforum.zoom.us/t/receiving-duplicate-events-sometimes/52044) — HIGH confidence (x-zm-trackingid dedup strategy confirmed)
- [Zoom Developer Forum: Error 7010 invalid token, Team Chat not enabled](https://devforum.zoom.us/t/7010-invalid-token-problem/136134) — HIGH confidence (Zoom support confirmed root cause)
- [How to get a Chatbot Token — Zoom Developer Support](https://devsupport.zoom.us/hc/en-us/articles/360060332891-How-to-get-a-Chatbot-Token) — HIGH confidence (official Zoom documentation)
- [Zoom webhook payload: x-zm-request-timestamp and replay prevention](https://webhooks.fyi/webhook-directory/zoom) — MEDIUM confidence (third-party, aligns with official docs)
- [Express body-parser raw body capture](https://stenzr.medium.com/intercepting-raw-http-request-bodies-ensuring-security-and-authenticity-in-webhooks-and-api-3b365b8a795b) — HIGH confidence (established Node.js pattern, confirmed by Stripe/similar implementations)
- [ServiceNow ticket number regex pattern](https://regex101.com/library/P2BZQq) — MEDIUM confidence (community regex, validated against ServiceNow ticket format documentation)
- [Zoom Node.js chatbot library README](https://github.com/zoom/node.js-chatbot/blob/master/README.md) — HIGH confidence (official Zoom repository)
