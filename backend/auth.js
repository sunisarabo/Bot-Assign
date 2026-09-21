'use strict';
/* auth.js — OIDC login (มาตรฐาน · ตั้งค่าผ่าน env) → ชี้ Microsoft Entra ID ได้ ไม่ผูกเจ้า
 *
 * env:
 *   OIDC_ISSUER          เช่น https://login.microsoftonline.com/<tenant-id>/v2.0
 *   OIDC_CLIENT_ID       Application (client) ID จาก Entra app registration
 *   OIDC_CLIENT_SECRET   client secret
 *   OIDC_REDIRECT_URI    เช่น https://pas.example.com/auth/callback
 *   OIDC_SCOPE           (ทางเลือก) default "openid email profile"
 *   SESSION_SECRET       คีย์เซ็นคุกกี้ session (ตั้งเองอย่างน้อย 32 ตัว)
 *   AUTH_REQUIRED        "1" = บังคับ login ทุก route  ·  ไม่ตั้ง = เปิดได้ (prototype)
 *   COOKIE_SECURE        "1" = คุกกี้ Secure (เมื่อรันหลัง HTTPS)
 *
 * ถ้าไม่ตั้ง OIDC_* → โมดูลปิดตัวเอง (isEnabled()=false) เว็บยังรันได้แบบเปิด
 * โครงเป็น OIDC มาตรฐาน → ย้าย Entra↔Google↔Keycloak ได้โดยเปลี่ยนแค่ env */
const crypto = require('crypto');
const { Issuer, generators } = require('openid-client');
const store = require('./store');

const CFG = {
  issuer: process.env.OIDC_ISSUER || '',
  clientId: process.env.OIDC_CLIENT_ID || '',
  clientSecret: process.env.OIDC_CLIENT_SECRET || '',
  redirectUri: process.env.OIDC_REDIRECT_URI || '',
  scope: process.env.OIDC_SCOPE || 'openid email profile',
  sessionSecret: process.env.SESSION_SECRET || '',
  required: process.env.AUTH_REQUIRED === '1',
  cookieSecure: process.env.COOKIE_SECURE === '1',
};
const SESSION_TTL = 8 * 3600 * 1000;   // 8 ชม.
const PENDING_TTL = 10 * 60 * 1000;    // 10 นาที (ระหว่าง login flow)

function isEnabled() { return !!(CFG.issuer && CFG.clientId && CFG.clientSecret && CFG.redirectUri); }
function authRequired() { return CFG.required && isEnabled(); }

// ---- client (discover ครั้งเดียว, lazy) ----
let _clientPromise = null;
function getClient() {
  if (!_clientPromise) {
    _clientPromise = Issuer.discover(CFG.issuer).then(iss => new iss.Client({
      client_id: CFG.clientId,
      client_secret: CFG.clientSecret,
      redirect_uris: [CFG.redirectUri],
      response_types: ['code'],
    }));
    _clientPromise.catch(() => { _clientPromise = null; }); // ให้ลองใหม่ได้ถ้า discover ล้ม
  }
  return _clientPromise;
}

// ---- cookie helpers ----
function secret() { return CFG.sessionSecret || 'dev-insecure-secret-change-me'; }
function sign(v) { return v + '.' + crypto.createHmac('sha256', secret()).update(v).digest('base64url'); }
function unsign(s) {
  if (!s || s.indexOf('.') < 0) return null;
  const i = s.lastIndexOf('.'), v = s.slice(0, i), mac = s.slice(i + 1);
  const exp = crypto.createHmac('sha256', secret()).update(v).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(exp);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? v : null;
}
function parseCookies(req) {
  const out = {}; const h = req.headers.cookie; if (!h) return out;
  h.split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function setCookie(res, name, val, maxAgeMs) {
  const parts = [`${name}=${encodeURIComponent(val)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeMs != null) parts.push('Max-Age=' + Math.floor(maxAgeMs / 1000));
  if (CFG.cookieSecure) parts.push('Secure');
  appendHeader(res, 'Set-Cookie', parts.join('; '));
}
function clearCookie(res, name) { appendHeader(res, 'Set-Cookie', `${name}=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax`); }
function appendHeader(res, name, val) {
  const cur = res.getHeader(name);
  res.setHeader(name, cur ? (Array.isArray(cur) ? cur.concat(val) : [cur, val]) : val);
}

// ---- state เก็บใน Postgres (store.js) → รองรับหลาย instance ----
setInterval(() => store.cleanup(), 15 * 60 * 1000).unref();

async function currentUser(req) {
  const sid = unsign(parseCookies(req).pas_sid || '');
  if (!sid) return null;
  try {
    const s = await store.getSession(sid);
    return s ? { sub: s.sub, email: s.email, name: s.name } : null;
  } catch (e) { return null; }
}

// ---- route handlers ----
async function login(req, res) {
  if (!isEnabled()) return json(res, 503, { error: 'OIDC not configured' });
  try {
    const client = await getClient();
    const code_verifier = generators.codeVerifier();
    const code_challenge = generators.codeChallenge(code_verifier);
    const state = generators.state();
    const nonce = generators.nonce();
    await store.putPending(state, code_verifier, nonce);
    setCookie(res, 'pas_state', sign(state), PENDING_TTL);
    const url = client.authorizationUrl({ scope: CFG.scope, code_challenge, code_challenge_method: 'S256', state, nonce });
    res.writeHead(302, { Location: url }); res.end();
  } catch (e) { json(res, 500, { error: 'login init failed: ' + (e.message || e) }); }
}

async function callback(req, res, query) {
  if (!isEnabled()) return json(res, 503, { error: 'OIDC not configured' });
  try {
    const client = await getClient();
    const cookieState = unsign(parseCookies(req).pas_state || '');
    if (!cookieState || !query.state || query.state !== cookieState) return json(res, 400, { error: 'invalid login state' });
    const p = await store.takePending(cookieState, PENDING_TTL);
    if (!p) return json(res, 400, { error: 'expired login state' });
    const tokenSet = await client.callback(CFG.redirectUri, query, { code_verifier: p.code_verifier, state: cookieState, nonce: p.nonce });
    const c = tokenSet.claims();
    const sid = crypto.randomBytes(32).toString('hex');
    await store.putSession(sid, { sub: c.sub, email: c.email || c.preferred_username || '', name: c.name || '' }, SESSION_TTL);
    clearCookie(res, 'pas_state');
    setCookie(res, 'pas_sid', sign(sid), SESSION_TTL);
    res.writeHead(302, { Location: '/' }); res.end();
  } catch (e) { json(res, 500, { error: 'callback failed: ' + (e.message || e) }); }
}

async function logout(req, res) {
  const sid = unsign(parseCookies(req).pas_sid || '');
  if (sid) { try { await store.delSession(sid); } catch (e) {} }
  clearCookie(res, 'pas_sid');
  res.writeHead(302, { Location: '/' }); res.end();
}

async function me(req, res) {
  json(res, 200, { enabled: isEnabled(), required: authRequired(), user: await currentUser(req) });
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

module.exports = { isEnabled, authRequired, currentUser, login, callback, logout, me };
