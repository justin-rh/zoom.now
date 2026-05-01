'use strict';

const express = require('express');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Health check endpoint — per D-05
app.get('/health', (req, res) => {
  console.log('[health] GET /health');
  res.json({ status: 'ok', ts: Date.now() });
});

// Webhook endpoint — express.raw() as route-level middleware only (never globally)
// Required: raw Buffer body for HMAC-SHA256 verification (CLAUDE.md constraint 1)
app.post('/webhook', express.raw({ type: '*/*' }), (req, res) => {
  const timestamp = req.headers['x-zm-request-timestamp'];
  const signature = req.headers['x-zm-signature'];
  const rawBody = req.body.toString('utf8'); // explicit utf8 — emoji-safe (RESEARCH.md Pitfall 4)

  // Step 1: Replay attack prevention — 5-minute window (INFRA-04, T-01-02)
  const ageMs = Date.now() - parseInt(timestamp, 10) * 1000;
  if (ageMs > 5 * 60 * 1000) {
    console.error('[verify] request expired:', ageMs, 'ms old');
    return res.status(403).json({ error: 'Request expired' });
  }

  // Step 2: HMAC-SHA256 signature verification (INFRA-04, T-01-01, T-01-03)
  const message = `v0:${timestamp}:${rawBody}`;
  const expectedSig = 'v0=' + crypto
    .createHmac('sha256', process.env.ZOOM_WEBHOOK_SECRET_TOKEN)
    .update(message)
    .digest('hex');

  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      console.error('[verify] signature mismatch');
      return res.status(403).json({ error: 'Invalid signature' });
    }
  } catch {
    // timingSafeEqual throws if buffers are different lengths — definitively not equal
    console.error('[verify] signature comparison failed (length mismatch)');
    return res.status(403).json({ error: 'Invalid signature' });
  }

  // Step 3: Parse body now that signature is verified
  const body = JSON.parse(rawBody);

  // Step 4a: URL validation challenge (INFRA-04)
  if (body.event === 'endpoint.url_validation') {
    const encryptedToken = crypto
      .createHmac('sha256', process.env.ZOOM_WEBHOOK_SECRET_TOKEN)
      .update(body.payload.plainToken)
      .digest('hex');
    console.log('[webhook] URL validation challenge responded');
    return res.status(200).json({ plainToken: body.payload.plainToken, encryptedToken });
  }

  // Step 4b: All other events — respond 200 IMMEDIATELY before any async work
  // CLAUDE.md constraint 2: Zoom timeout is 3s; async work goes AFTER res.sendStatus(200)
  res.sendStatus(200);
  console.log('[webhook] event received:', body.event, body.event_ts);
  // Phase 2+ async processing goes here
});

app.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`);
});

module.exports = app; // exported for supertest in tests/webhook.test.js
