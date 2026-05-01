# Phase 1: Foundation - Context

**Gathered:** 2026-05-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 1 delivers a live, publicly accessible HTTPS webhook endpoint on Railway that passes Zoom's URL validation challenge and correctly verifies webhook signatures — unblocking Zoom app configuration in Marketplace.

No ticket detection logic. No bot replies. Infrastructure only.

**In scope:** Express server, Railway deployment, Zoom app registration, signature verification, health endpoint, env var config
**Out of scope:** Token acquisition (INFRA-05, Phase 2), ticket detection (Phase 2), bot replies (Phase 2)

</domain>

<decisions>
## Implementation Decisions

### Language
- **D-01:** JavaScript (CommonJS) — no TypeScript. No build step. Railway deploys `node index.js` directly. Type safety gives diminishing returns for a bot this size.

### Project Structure
- **D-02:** Single file at root (`index.js`) for Phase 1. No `src/` directory. Grow into modules in a later phase only when a single file becomes painful to navigate.
- **D-03:** Supporting files at root: `package.json`, `.env.example`, `.gitignore`.

### Logging
- **D-04:** `console.log` / `console.error` with a short prefix notation (`[webhook]`, `[verify]`, `[health]`). No logging library. Visible in Railway dashboard as-is. Add structured logging later only if debugging becomes painful in production.

### Health Check Endpoint
- **D-05:** Include `GET /health` in Phase 1. Returns `{ status: 'ok', ts: Date.now() }`. Enables Railway healthcheck monitoring before any real logic is added.

### Claude's Discretion
- Exact package versions — use current stable releases of express at planning time
- `.gitignore` contents — standard Node patterns + `.env`
- `package.json` scripts — `start: node index.js` minimum; planner may add `dev` script with nodemon if useful

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Critical Implementation Constraints
- `CLAUDE.md` — Contains 6 hard-won implementation notes for Zoom + ServiceNow integration. Read before writing any webhook or token code:
  1. Raw body for HMAC (do NOT use `express.json()` globally on the webhook route)
  2. 200 OK immediately before any async processing (Zoom 3-second timeout)
  3. Client credentials token only (not authorization code tokens)
  4. Self-reply filter (check sender type + bot JID)
  5. Dedup key structure
  6. Passive listening via `chat_message.sent` on General App (not bot endpoint)

### Requirements
- `.planning/REQUIREMENTS.md` — Phase 1 requirements: INFRA-01, INFRA-02, INFRA-03, INFRA-04, DEPLOY-01
- `.planning/ROADMAP.md` — Phase 1 success criteria (5 items)

### Project Context
- `.planning/PROJECT.md` — ServiceNow domain, ticket prefix → table mapping, Zoom API approach, constraints

### Research Artifacts
- `.planning/research/STACK.md` — Technology decisions from research phase
- `.planning/research/ARCHITECTURE.md` — Architecture decisions and patterns
- `.planning/research/PITFALLS.md` — Known failure modes (critical for Phase 1 — Zoom webhook pitfalls documented here)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield project. No existing components.

### Established Patterns
- None yet. Phase 1 establishes the patterns all subsequent phases will follow.

### Integration Points
- `index.js` (Phase 1) → Phase 2 adds ticket detection logic and token acquisition to the same file or extracts into modules
- Railway env vars → shared across all phases; Phase 1 sets the precedent for all config access via `process.env`

</code_context>

<specifics>
## Specific Ideas

- User confirmed the single-file layout preview: `index.js` at root with `express.raw({ type: '*/*' })` on the webhook route
- Health endpoint confirmed as `res.json({ status: 'ok', ts: Date.now() })` — minimal, no extra fields
- Log prefix style confirmed: `[webhook]`, `[verify]`, `[health]` — bracket-prefixed, lowercase

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-05-01*
