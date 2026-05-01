'use strict';

// Set the test secret BEFORE requiring index.js so dotenv cannot overwrite it
const START_SECRET = 'test_secret_token_for_testing_only';
process.env.ZOOM_WEBHOOK_SECRET_TOKEN = START_SECRET;

const { test, describe } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const supertest = require('supertest');

// Conditional require — index.js does not exist yet during Task 1 creation
let app = null;
try {
  app = require('../index.js');
} catch (e) {
  // index.js not yet created; tests will fail gracefully until Task 2
  app = null;
}

/**
 * Computes a valid Zoom webhook signature.
 * Format: "v0=" + HMAC-SHA256(secret, "v0:{timestamp}:{body}").hex()
 *
 * @param {string} secret - The webhook secret token
 * @param {string} timestamp - Unix epoch seconds as a string
 * @param {string} body - Raw request body as UTF-8 string
 * @returns {string} - e.g. "v0=abc123..."
 */
function makeSignature(secret, timestamp, body) {
  const message = `v0:${timestamp}:${body}`;
  return 'v0=' + crypto.createHmac('sha256', secret).update(message).digest('hex');
}

describe('Zoom webhook signature verification', () => {

  // Test 1 — valid signature accepted (INFRA-04, INFRA-03)
  test('valid HMAC-SHA256 signature returns 200', async () => {
    assert.ok(app, 'index.js must be required for this test');
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({ event: 'chat_message.sent', event_ts: Date.now(), payload: {} });
    const signature = makeSignature(START_SECRET, timestamp, body);

    const response = await supertest(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('x-zm-request-timestamp', timestamp)
      .set('x-zm-signature', signature)
      .send(body);

    assert.strictEqual(response.status, 200);
  });

  // Test 2 — invalid signature returns 403 (INFRA-04, T-01-01)
  test('invalid signature returns 403', async () => {
    assert.ok(app, 'index.js must be required for this test');
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({ event: 'chat_message.sent', event_ts: Date.now(), payload: {} });
    // Deliberately wrong signature — same length as real HMAC hex, but invalid value
    const badSignature = 'v0=invalidsignature000000000000000000000000000000000000000000000000';

    const response = await supertest(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('x-zm-request-timestamp', timestamp)
      .set('x-zm-signature', badSignature)
      .send(body);

    assert.strictEqual(response.status, 403);
  });

  // Test 3 — expired timestamp returns 403 (INFRA-04, T-01-02)
  test('expired timestamp (>5 min old) returns 403', async () => {
    assert.ok(app, 'index.js must be required for this test');
    // Year 2001 — guaranteed more than 5 minutes ago
    const timestamp = '1000000000';
    const body = JSON.stringify({ event: 'chat_message.sent', event_ts: Date.now(), payload: {} });
    // Valid HMAC for that timestamp — so the only rejection reason is the replay window
    const signature = makeSignature(START_SECRET, timestamp, body);

    const response = await supertest(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('x-zm-request-timestamp', timestamp)
      .set('x-zm-signature', signature)
      .send(body);

    assert.strictEqual(response.status, 403);
  });

  // Test 4 — URL validation challenge (INFRA-04)
  test('endpoint.url_validation returns { plainToken, encryptedToken }', async () => {
    assert.ok(app, 'index.js must be required for this test');
    const plainToken = 'testPlainToken123';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      event: 'endpoint.url_validation',
      payload: { plainToken }
    });
    const signature = makeSignature(START_SECRET, timestamp, body);

    const response = await supertest(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('x-zm-request-timestamp', timestamp)
      .set('x-zm-signature', signature)
      .send(body);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.plainToken, plainToken);

    // encryptedToken must equal HMAC-SHA256(START_SECRET, plainToken).hex()
    const expectedEncryptedToken = crypto
      .createHmac('sha256', START_SECRET)
      .update(plainToken)
      .digest('hex');
    assert.strictEqual(response.body.encryptedToken, expectedEncryptedToken);
  });

  // Test 5 — health check (INFRA-01)
  test('GET /health returns { status: ok, ts: <number> }', async () => {
    assert.ok(app, 'index.js must be required for this test');

    const response = await supertest(app)
      .get('/health');

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.status, 'ok');
    assert.strictEqual(typeof response.body.ts, 'number');
  });

});
