'use strict';
// PAS prototype backend — Node http + pg (อ่านจาก PostgreSQL) · ไม่ผูก Google/Microsoft
// login = OIDC (Entra-ready) · แจ้งเตือน = SMTP (Microsoft 365-ready) · ตั้งค่าผ่าน env
// รัน: DATABASE_URL=postgres://user:pass@host/pas  node backend/server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const Q = require('./queries');
const P = require('./productivity');
const auth = require('./auth');
const mailer = require('./mailer');

const PORT = process.env.PORT || 3000;
const INDEX = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

const API = {
  '/api/health': () => Q.health(),
  '/api/dates': () => Q.dates(),
  '/api/summary': (q) => Q.summary(q.date),
  '/api/timetable': (q) => Q.timetable(q.date),
  '/api/flights': (q) => Q.flights(q.date),
  '/api/porter': (q) => Q.porter(q.date),
  '/api/prewc': (q) => Q.prewc(q.date),
  '/api/productivity': (q) => P.productivity(q.date),
  '/api/gantt': (q) => P.gantt(q.date),
};

async function readBody(req) {
  return new Promise((resolve) => {
    let b = ''; req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const u = url.parse(req.url, true);
  const p = u.pathname;
  try {
    // ---- auth routes ----
    if (p === '/auth/login' && req.method === 'GET') return auth.login(req, res);
    if (p === '/auth/callback' && req.method === 'GET') return auth.callback(req, res, u.query);
    if (p === '/auth/logout') return auth.logout(req, res);
    if (p === '/auth/me' && req.method === 'GET') return auth.me(req, res);

    // ---- page ----
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(INDEX);
    }

    // ---- gate everything below behind login (เมื่อ AUTH_REQUIRED=1) ----
    if (auth.authRequired() && !(await auth.currentUser(req))) {
      return sendJson(res, 401, { error: 'login required', login: '/auth/login' });
    }

    // ---- mail (แจ้งเตือน · guarded) ----
    if (p === '/api/mail/verify' && req.method === 'GET') return sendJson(res, 200, await mailer.verify());
    if (p === '/api/mail/test' && req.method === 'POST') {
      if (!mailer.isEnabled()) return sendJson(res, 503, { error: 'SMTP not configured' });
      const b = await readBody(req);
      if (!b.to) return sendJson(res, 400, { error: 'to required' });
      const r = await mailer.send({ to: b.to, subject: b.subject || 'PAS ทดสอบแจ้งเตือน', text: b.text || 'ทดสอบส่งอีเมลจากระบบ PAS (SMTP)' });
      return sendJson(res, 200, r);
    }

    // ---- data API ----
    const handler = API[p];
    if (handler) {
      const needsDate = p !== '/api/health' && p !== '/api/dates';
      if (needsDate && !/^\d{4}-\d{2}-\d{2}$/.test(u.query.date || '')) return sendJson(res, 400, { error: 'date=YYYY-MM-DD required' });
      return sendJson(res, 200, await handler(u.query));
    }
    sendJson(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    sendJson(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => console.log(
  'PAS backend on http://localhost:' + PORT +
  '  (DB=' + (process.env.DATABASE_URL ? 'set' : 'default') +
  ' · OIDC=' + (auth.isEnabled() ? (auth.authRequired() ? 'required' : 'optional') : 'off') +
  ' · SMTP=' + (mailer.isEnabled() ? 'on' : 'off') + ')'));
