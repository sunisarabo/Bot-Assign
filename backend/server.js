'use strict';
// PAS prototype backend — Node http + pg (อ่านจาก PostgreSQL) · ไม่ผูก Google/Microsoft
// รัน: DATABASE_URL=postgres://user:pass@host/pas  node backend/server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const Q = require('./queries');

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
};

const server = http.createServer(async (req, res) => {
  const u = url.parse(req.url, true);
  try {
    if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(INDEX);
    }
    const handler = API[u.pathname];
    if (handler) {
      const needsDate = u.pathname !== '/api/health' && u.pathname !== '/api/dates';
      if (needsDate && !/^\d{4}-\d{2}-\d{2}$/.test(u.query.date || '')) return sendJson(res, 400, { error: 'date=YYYY-MM-DD required' });
      const data = await handler(u.query);
      return sendJson(res, 200, data);
    }
    sendJson(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    sendJson(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => console.log('PAS backend on http://localhost:' + PORT + '  (DATABASE_URL=' + (process.env.DATABASE_URL ? 'set' : 'default') + ')'));
