# Feature Landscape: Zoom Team Chat Linkification / Utility Bot

**Domain:** Zoom Team Chat chatbot — passive keyword detection, ticket linkification
**Researched:** 2026-05-01
**Overall confidence:** MEDIUM-HIGH (Zoom API behavior confirmed via developer forum, some edge cases LOW confidence due to limited official doc rendering)

---

## Zoom API Capability Summary

Before features, these are the hard platform constraints that determine what is and is not buildable.

### What IS supported (confirmed)

| Capability | Notes | Confidence |
|------------|-------|------------|
| Bot receives all channel messages passively | Bot added to channel gets `bot_notification` events for all messages — no @mention required | MEDIUM (forum-confirmed, docs partially blocked) |
| Send message to channel (visible to all) | Requires **account-level app** registration, not user-level. Omit `user_jid`, target channel JID | HIGH |
| Send message visible only to triggering user | Include `user_jid` in request body — shows "Only visible to you" in client | HIGH |
| Markdown with `is_markdown_support: true` | Set at top-level of message JSON body. Enables bold, italics, code blocks | HIGH |
| Hyperlinks with custom text | Syntax: `<https://url|Display Text>` — confirmed working in chatbot messages as of June 2023, Zoom committed to maintaining support | MEDIUM |
| Interactive message cards | `head`, `body`, `footer` structure. Body supports: Form Fields, Dropdowns, Buttons, Editable Text, Multi-Section | HIGH |
| `interactive_message_select` events | Fires when user selects from a dropdown in a message card | HIGH |
| `interactive_message_actions` events | Fires when user clicks a button in a message card | HIGH |
| Slash commands | Configured in app dashboard. Trigger `bot_notification` with `command` field. Must be globally unique in Zoom | HIGH |
| Reply with `reply_main_message_id` | Bot can reply in-thread to a message using this parameter in the Chat API send endpoint | MEDIUM |
| Edit bot's own messages | PATCH endpoint exists for updating previously sent chatbot messages | MEDIUM |
| Delete bot's own messages | Supported via API | MEDIUM |
| Message body limit | 4,096 characters per message (confirmed by Zoom rep) | HIGH |
| unfurl / link sharing event | New as of May 2024 — bot can intercept link pastes and augment them with rich preview cards | MEDIUM |
| Welcome message on install | Bot endpoint is called on app install for welcome message | MEDIUM |
| DM support | Bot works in 1:1 direct messages | HIGH |

### What is NOT supported (confirmed limitations)

| Limitation | Impact | Confidence |
|------------|--------|------------|
| Bot cannot edit other users' messages | Cannot modify the triggering message — reply only | HIGH |
| Thread reply events in 1:1 DMs | `chat_message.replied` only fires in channels/group chats, NOT in 1:1 DMs with bot (confirmed Nov 2025 by Zoom) | HIGH |
| Chatbot messages cannot be replied-to in-thread by users (full threading) | Bot messages don't support normal thread reply flow; closest workaround is editable message sections | MEDIUM |
| User-level app = messages "only visible to you" | Must use account-level app to post visibly to everyone | HIGH |
| Rate limit ambiguity | Officially "Medium" category; in practice developers hit a 6,000 req/day limit even at low send rates. Treat as ~6k/day ceiling | MEDIUM |
| Slash commands are globally unique across Zoom | Cannot use `/help` if already taken by another app | HIGH |

---

## Table Stakes

Features users expect. Missing = product feels incomplete or broken.

| Feature | Why Expected | Complexity | Zoom API Notes |
|---------|--------------|------------|----------------|
| Detect ServiceNow ticket numbers via regex | Core purpose — passively catches INC, RITM, REQ, CHG, PRB, TASK patterns in any channel message | Low | `bot_notification` event delivers full message text |
| Reply with clickable link(s) to each detected ticket | The delivered value. No link = no product | Low | Use `<url\|Display Text>` syntax with `is_markdown_support: true` |
| Single consolidated reply for multiple tickets in one message | Reduces noise. Users expect "one reply, all tickets" not per-ticket spam | Low | Collect all regex matches, build one message body |
| Works in any channel the bot is added to | Users expect passive operation — set-and-forget | Low | Account-level app required for channel-wide visibility |
| Works in direct messages (DMs) | Power users will DM the bot to generate links on demand | Low | Same API endpoint, target user JID |
| Bot never replies to other bots/apps | Prevents infinite loops and reply storms | Low | Filter on sender type in webhook payload |
| Configurable ticket prefix → table mapping | INC → incident, RITM → sc_req_item, etc. Without this the URLs are wrong | Low | Env vars / config file, no API complexity |
| Configurable ServiceNow domain | Required to work at all for a given company | Low | Env var |
| Webhook signature verification | Security requirement — Zoom sends a signature header to verify requests come from Zoom | Low-Med | HMAC-SHA256 verification on incoming webhook |
| Suppress reply if ticket already linked recently in same channel | Without deduplication, a message with INC0001234 in a busy channel generates the same link repeatedly | Med | In-memory TTL cache or lightweight KV store keyed on channel+ticket |

---

## Differentiators

Features that set this bot apart from a barebones implementation. Not expected, but meaningfully improve the experience.

| Feature | Value Proposition | Complexity | Zoom API Notes |
|---------|-------------------|------------|----------------|
| `nobot` opt-out keyword per-message | Lets users suppress the bot for a specific message — reduces friction and user annoyance | Low | String match in message body before regex scan |
| `/snow help` slash command | Tells users what the bot does, what patterns it detects, and how to use `nobot` — essential for discoverability | Low | `bot_notification` event with `command: 'help'` |
| Ephemeral "private" confirmation for DM use | When user DMs the bot a ticket number, reply is already private — feels clean and intentional | Low | DM by nature is already private |
| Message card formatting with section header | Reply styled as `🔗 ServiceNow Links` header + bulleted links vs raw text — looks intentional rather than bot noise | Low-Med | Interactive message card with `head.text` |
| Configurable deduplication window (e.g., 5 min default) | Prevents spam while allowing re-linking when genuinely useful. Window should be tunable | Low | TTL cache with configurable duration |
| `/snow status` slash command | Confirms the bot is running, shows configured domain and prefixes — useful for admin troubleshooting | Low | Same event handler, different response |
| Edit bot's own message when more tickets found in thread | If users post follow-up tickets in the same message thread, bot can update rather than post again | Med | PATCH endpoint for chatbot messages; tricky timing logic |
| Unfurl link enhancement (future) | Intercept ServiceNow ticket URLs that users paste and augment with ticket metadata card | High | unfurl API (May 2024) — requires ServiceNow API auth, currently out of scope |

---

## Anti-Features

Features to explicitly NOT build. Each has a clear reason.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Fetching live ticket data from ServiceNow API | Requires OAuth/auth plumbing with ServiceNow, adds infrastructure surface area, breaks if SNOW changes auth, and the core value is *links not data* | Links only. Add SNOW data fetch only in v2 after link value is validated |
| Reply to every single message even without tickets | Adds extreme noise. Users will remove the bot within days | Only reply when regex matches |
| Per-ticket reply (one message per ticket found) | A message with 3 tickets generates 3 bot replies — catastrophic noise | Always consolidate into one reply |
| Replying as a thread to the original message | Threading is broken for bots in 1:1 DMs and confusing in channels (Zoom threading UX is non-obvious). Users may miss the reply | Post as a new channel message, not a thread reply |
| Global @mention requirement | Forces users to change behavior. Defeats the "zero friction" core value | Passive detection — no @mention needed |
| Storing full message history | Privacy risk, unnecessary scope | Stateless: process event, reply, done. Only cache ticket+channel deduplication keys |
| Rich "ticket status" cards with live data | Scope creep; requires ServiceNow auth | Plain text link with display name is sufficient for v1 |
| User-level OAuth flow | Results in "only visible to you" messages — users are confused why others can't see bot replies | Account-level app registration from the start |
| Slash command with globally common name like `/help` | Will conflict with other installed apps | Use namespaced command: `/snow` or `/servicenow` |
| Triggering on partial ticket number patterns | False positives erode trust fast (e.g., INC123 when the format is INC + 7 digits) | Strict regex: prefix + exactly 7 zero-padded digits |
| Replying to the bot's own messages | Creates infinite loops | Hard filter on sender == bot's own JID |
| Interactive buttons asking "Was this helpful?" | Friction on every reply, adds no value for a link bot | Stateless replies only |

---

## Feature Dependencies

```
Account-level app registration
  └─→ Channel-wide message visibility (required)
  └─→ All channel message events (required for passive detection)

Regex detection
  └─→ Single consolidated reply
  └─→ Deduplication cache lookup (runs before reply decision)

Deduplication cache
  └─→ Configurable TTL window
  └─→ Keyed on (channel_id + ticket_number)

Slash command infrastructure
  └─→ /snow help
  └─→ /snow status
```

---

## MVP Recommendation

Minimum viable product that delivers real value at Master Electronics from day one:

**Must ship in v1:**
1. Passive regex detection for INC, RITM, REQ, CHG, PRB, TASK patterns (7-digit zero-padded)
2. Single consolidated reply with `<url|Display Text>` links using `is_markdown_support: true`
3. Account-level app registration (channel-wide visibility)
4. Bot self-filter (never reply to other bots)
5. `nobot` opt-out keyword suppression
6. In-memory deduplication with 5-minute TTL per (channel + ticket)
7. Webhook signature verification (HMAC-SHA256)
8. Configurable ServiceNow domain + prefix→table map via env vars
9. `/snow help` slash command

**Defer to v1.1:**
- `/snow status` command
- Configurable dedup TTL (hardcode 5 min for v1)
- Message card formatting (plain markdown link is sufficient for v1)

**Defer to v2:**
- ServiceNow live ticket data / unfurl enhancement
- Zoom Meetings chat integration
- Browser extension

---

## Zoom API Gotchas Worth Knowing

These surfaced in research and will cause bugs if ignored during implementation:

1. **Account-level vs user-level app type** — this is set at app creation time in the Zoom Marketplace dashboard. Getting this wrong means all channel replies show "Only visible to you." There is no API parameter to override it post-creation.

2. **`is_markdown_support` must be at the top-level of the POST body** — not inside `content`. Easy to misplace.

3. **Hyperlink syntax is `<url|Text>`, not standard Markdown `[Text](url)`** — Zoom uses Slack-style syntax, not standard Markdown, for hyperlinks in chatbot messages.

4. **Rate limit is ~6,000 requests/day in practice** — the official docs say "Medium" tier without a daily number, but developers consistently hit a 6k/day ceiling. For a company-wide deployment in a busy org this could be a constraint if dozens of channels fire simultaneously. Build in a simple counter and graceful degradation.

5. **`bot_notification` fires for slash commands; passive channel messages are a separate concern** — the node.js-chatbot library uses `bot_notification` for slash commands. Passive all-channel message monitoring requires the chatbot to be installed in the channel AND subscribed to the appropriate chat message event. Verify this in the app's Event Subscriptions configuration.

6. **Thread reply events don't fire in 1:1 DM bot conversations** — if a user replies to the bot's DM reply in-thread, the bot will not receive that event. Only the initial DM triggers the bot.

7. **Message body character limit is 4,096** — for a linkification bot this is effectively unlimited (10+ tickets fit easily), but worth knowing.

8. **Slash command names are globally unique across all Zoom apps** — `/snow` or `/servicenow` are safer than `/help` or `/tickets`.

---

## Sources

- Zoom Developer Forum — threading limitations: https://devforum.zoom.us/t/how-to-send-a-chatbot-message-that-can-be-replied-to-in-thread/65392
- Zoom Developer Forum — thread reply 1:1 DM limitation (confirmed Nov 2025): https://devforum.zoom.us/t/clarification-on-zoom-chatbot-webhook-events-for-thread-replies-in-1-1-chats/134812
- Zoom Developer Forum — channel visibility requires account-level app: https://devforum.zoom.us/t/chatbot-api-post-message-visible-to-everyone-in-channel/99445
- Zoom Developer Forum — message body 4096 char limit: https://devforum.zoom.us/t/chatbot-message-body-limit/88575
- Zoom Developer Forum — hyperlink `<url|text>` syntax: https://devforum.zoom.us/t/support-for-hyperlinking-a-url-with-linktext-in-chat-bot-messages/90544
- Zoom Developer Forum — rate limit 429 / 6000/day: https://devforum.zoom.us/t/chat-endpoint-returning-429-you-have-reached-the-maximum-daily-rate-limit-for-this-api/31609
- Zoom Developer Forum — passive channel listening: https://devforum.zoom.us/t/is-it-possible-to-put-chatbot-in-channel-so-it-listens-to-all-users/9175
- Zoom Developer Forum — markdown support: https://devforum.zoom.us/t/can-a-bot-post-with-markdown/2620
- Zoom node.js-chatbot SDK: https://github.com/zoom/node.js-chatbot
- Zoom chatbot quickstart: https://github.com/zoom/chatbot-nodejs-quickstart
- Zoom changelog — unfurl API May 2024: https://developers.zoom.us/changelog/chatbot/may-23-2024/
- ServiceNow + Zoom partnership overview: https://partner.zoom.us/solutions/servicenow/
- Thoughtbot — per-user rate limit strategy for chat bots: https://thoughtbot.com/blog/chat-bot-per-user-rate-limits
