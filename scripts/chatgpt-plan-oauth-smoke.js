'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { makeAuthorizationUrl, verifyIdToken, PLAN_SCOPE } = require('../main/chatgptPlanClient');

async function main() {
  const url = new URL(makeAuthorizationUrl({
    clientId: 'dynamic_agent_client', hostId: 'urn:uuid:test-host',
    redirectUri: 'http://127.0.0.1:1455/auth/callback', state: 's', nonce: 'n', challenge: 'c',
  }));
  assert.equal(url.origin + url.pathname, 'https://auth.openai.com/api/accounts/authorize');
  assert.equal(url.searchParams.get('agent_name_hint'), 'Auto Pomodoro');
  assert(url.searchParams.get('scope').split(' ').includes(PLAN_SCOPE));
  assert.equal(url.searchParams.get('ext_agent_host_id'), 'urn:uuid:test-host');

  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256' };
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: 'https://auth.openai.com', aud: 'oaiapp_test', sub: 'user', nonce: 'n', iat: Date.now() / 1000, exp: Date.now() / 1000 + 300 })).toString('base64url');
  const signed = `${header}.${payload}`;
  const token = `${signed}.${crypto.sign('RSA-SHA256', Buffer.from(signed), privateKey).toString('base64url')}`;
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });
  try {
    assert.equal((await verifyIdToken(token, { clientId: 'oaiapp_test', nonce: 'n' })).sub, 'user');
    await assert.rejects(verifyIdToken(token, { clientId: 'oaiapp_test', nonce: 'wrong' }), /could not be verified/);
    const missingExpiry = Buffer.from(JSON.stringify({ iss: 'https://auth.openai.com', aud: 'oaiapp_test', sub: 'user', nonce: 'n', iat: Date.now() / 1000 })).toString('base64url');
    const malformedSigned = `${header}.${missingExpiry}`;
    const malformed = `${malformedSigned}.${crypto.sign('RSA-SHA256', Buffer.from(malformedSigned), privateKey).toString('base64url')}`;
    await assert.rejects(verifyIdToken(malformed, { clientId: 'oaiapp_test', nonce: 'n' }), /could not be verified/);
  } finally {
    global.fetch = originalFetch;
  }
  console.log('ChatGPT plan OAuth contract smoke: PASS');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
