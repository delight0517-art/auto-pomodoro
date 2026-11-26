'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const http = require('http');
const path = require('path');

const AUTH = 'https://auth.openai.com/api/accounts';
const RESOURCE = 'https://api.openai.com/v1';
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';

function b64url(value) {
  return Buffer.from(value).toString('base64url');
}

function makeAuthorizationUrl({ clientId, hostId, redirectUri, state, nonce, challenge }) {
  const params = new URLSearchParams({
    client_id: clientId,
    ext_agent_host_id: hostId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`,
    resource: RESOURCE,
    state,
    nonce,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });
  if (clientId === 'dynamic_agent_client') params.set('agent_name_hint', 'Auto Pomodoro');
  return `${AUTH}/authorize?${params}`;
}

function decodeJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('OpenAI sign-in returned an invalid ID token.');
  return { header: JSON.parse(Buffer.from(parts[0], 'base64url')), claims: JSON.parse(Buffer.from(parts[1], 'base64url')), signed: `${parts[0]}.${parts[1]}`, signature: Buffer.from(parts[2], 'base64url') };
}

async function verifyIdToken(token, { clientId, nonce }) {
  const { header, claims, signed, signature } = decodeJwt(token);
  if (!['RS256', 'ES256'].includes(header.alg) || !header.kid) throw new Error('OpenAI sign-in used an unsupported ID-token signature.');
  const response = await fetch('https://auth.openai.com/.well-known/jwks.json');
  if (!response.ok) throw new Error(`Could not verify OpenAI sign-in (${response.status}).`);
  const { keys } = await response.json();
  const jwk = keys?.find((key) => key.kid === header.kid && (!key.alg || key.alg === header.alg));
  if (!jwk) throw new Error('Could not find the OpenAI signing key for this login.');
  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const valid = header.alg === 'ES256'
    ? crypto.verify('sha256', Buffer.from(signed), { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature)
    : crypto.verify('RSA-SHA256', Buffer.from(signed), publicKey, signature);
  const now = Date.now() / 1000;
  const audienceMatches = Array.isArray(claims.aud) ? claims.aud.includes(clientId) : claims.aud === clientId;
  if (!valid || claims.iss !== 'https://auth.openai.com' || !audienceMatches || claims.nonce !== nonce || !Number.isFinite(claims.exp) || claims.exp <= now - 5 || !Number.isFinite(claims.iat) || claims.iat > now + 5 || typeof claims.sub !== 'string' || !claims.sub) {
    throw new Error('OpenAI sign-in could not be verified. Please try again.');
  }
  return claims;
}

class ChatGPTPlanClient {
  constructor({ app, safeStorage, shell }) {
    this.app = app;
    this.safeStorage = safeStorage;
    this.shell = shell;
    this.file = path.join(app.getPath('userData'), 'chatgpt-plan.enc');
    this.hostFile = path.join(app.getPath('userData'), 'chatgpt-host-id');
    this.loginPromise = null;
  }

  async hostId() {
    try { return (await fs.readFile(this.hostFile, 'utf8')).trim(); } catch (_) {
      const id = `urn:uuid:${crypto.randomUUID()}`;
      await fs.writeFile(this.hostFile, id, { mode: 0o600, flag: 'wx' });
      return id;
    }
  }

  async read() {
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable on this Mac.');
    const encrypted = await fs.readFile(this.file);
    return JSON.parse(this.safeStorage.decryptString(encrypted));
  }

  async save(credentials) {
    const encrypted = this.safeStorage.encryptString(JSON.stringify(credentials));
    const temp = `${this.file}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temp, encrypted, { mode: 0o600, flag: 'wx' });
    await fs.rename(temp, this.file);
  }

  async status() {
    try {
      const c = await this.read();
      return { connected: true, planUsage: c.scopes.includes(PLAN_SCOPE), account: c.email || 'ChatGPT' };
    } catch (_) { return { connected: false, planUsage: false }; }
  }

  async signIn() {
    if (this.loginPromise) return this.loginPromise;
    this.loginPromise = this.authorize().finally(() => { this.loginPromise = null; });
    return this.loginPromise;
  }

  async authorize() {
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable on this Mac.');
    const previous = await this.status();
    let old;
    if (previous.connected) old = await this.read();
    const hostId = await this.hostId();
    const state = crypto.randomBytes(32).toString('base64url');
    const nonce = crypto.randomBytes(32).toString('base64url');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const server = http.createServer();
    await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
    const redirectUri = `http://127.0.0.1:${server.address().port}/auth/callback`;
    const clientId = old?.clientId || 'dynamic_agent_client';
    try {
      const callback = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('ChatGPT sign-in timed out.')), 5 * 60 * 1000);
        server.on('request', (req, res) => {
          const url = new URL(req.url, redirectUri);
          if (url.pathname !== '/auth/callback') { res.writeHead(404).end(); return; }
          clearTimeout(timeout);
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end('<!doctype html><meta charset="utf-8"><title>Auto Pomodoro</title><p>Auto Pomodoro에 ChatGPT 연결을 마쳤습니다. 앱으로 돌아가세요.</p>');
          resolve(Object.fromEntries(url.searchParams));
        });
      });
      await this.shell.openExternal(makeAuthorizationUrl({ clientId, hostId, redirectUri, state, nonce, challenge }));
      const params = await callback;
      if (params.state !== state) throw new Error('ChatGPT sign-in state did not match.');
      if (params.error) throw new Error(params.error === 'access_denied' ? 'ChatGPT plan access was not authorized.' : `ChatGPT sign-in failed: ${params.error}`);
      const issuedClientId = clientId === 'dynamic_agent_client' ? params.client_id : clientId;
      if (!params.code || !issuedClientId || (clientId !== 'dynamic_agent_client' && params.client_id && params.client_id !== clientId)) {
        throw new Error('ChatGPT did not complete this app registration.');
      }
      const tokenResponse = await fetch(`${AUTH}/oauth/token`, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: issuedClientId, code: params.code, code_verifier: verifier, redirect_uri: redirectUri, resource: RESOURCE }),
      });
      const tokens = await tokenResponse.json();
      if (!tokenResponse.ok) throw new Error(`ChatGPT token exchange failed (${tokenResponse.status}).`);
      if (!tokens.access_token || !tokens.refresh_token || !tokens.id_token || !Number.isFinite(tokens.expires_in)) throw new Error('ChatGPT returned an incomplete token response.');
      const scopes = String(tokens.scope || '').split(/\s+/).filter(Boolean);
      if (!scopes.includes(PLAN_SCOPE)) throw new Error('ChatGPT sign-in succeeded, but plan usage was not authorized.');
      const identity = await verifyIdToken(tokens.id_token, { clientId: issuedClientId, nonce });
      if (old && identity.sub !== old.subject) throw new Error('This ChatGPT account differs from the saved account.');
      await this.save({ clientId: issuedClientId, hostId, subject: identity.sub, email: identity.email, scopes, idToken: tokens.id_token, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + tokens.expires_in * 1000 });
      return { connected: true, planUsage: true, account: identity.email || 'ChatGPT' };
    } finally {
      server.close();
    }
  }

  async accessToken() {
    const c = await this.read();
    if (!c.scopes.includes(PLAN_SCOPE)) throw new Error('ChatGPT plan usage is not enabled for this connection.');
    if (c.expiresAt > Date.now() + 60_000) return c.accessToken;
    const response = await fetch(`${AUTH}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: c.clientId, refresh_token: c.refreshToken, resource: RESOURCE }) });
    const next = await response.json();
    if (!response.ok) throw new Error(`ChatGPT session refresh failed (${response.status}). Sign in again.`);
    await this.save({ ...c, accessToken: next.access_token, refreshToken: next.refresh_token || c.refreshToken, expiresAt: Date.now() + next.expires_in * 1000, scopes: String(next.scope || c.scopes.join(' ')).split(/\s+/).filter(Boolean) });
    return next.access_token;
  }

  async respond(input) {
    const accessToken = await this.accessToken();
    const catalogResponse = await fetch(`${RESOURCE}/models`, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!catalogResponse.ok) throw new Error(`Could not load ChatGPT models (${catalogResponse.status}).`);
    const catalog = await catalogResponse.json();
    const model = catalog.models?.find((item) => item.visibility === 'list')?.slug;
    if (!model) throw new Error('No ChatGPT plan model is available for this account.');
    const response = await fetch(`${RESOURCE}/responses`, { method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, instructions: input.instructions, input: input.input, text: { format: { type: 'json_object' } }, store: false, stream: true }) });
    if (!response.ok) throw new Error(`ChatGPT request failed (${response.status}).`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let output = '';
    let completed = false;
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value || new Uint8Array(), { stream: !done });
      const events = pending.split('\n\n');
      pending = events.pop() || '';
      for (const event of events) {
        const data = event.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
        if (!data || data === '[DONE]') continue;
        const item = JSON.parse(data);
        if (item.type === 'response.output_text.delta') output += item.delta;
        if (item.type === 'response.failed') throw new Error(`ChatGPT response failed (${item.response?.error?.code || 'unknown'}).`);
        if (item.type === 'response.completed') completed = true;
      }
      if (done) break;
    }
    if (!completed) throw new Error('ChatGPT response ended before completion.');
    return JSON.parse(output);
  }
}

module.exports = { ChatGPTPlanClient, makeAuthorizationUrl, decodeJwt, verifyIdToken, PLAN_SCOPE };
