'use strict';
/* server.js — เว็บ dashboard อ่านจาก Excel บน SharePoint (Graph) ตรง ๆ · ไม่ผ่าน DB
 *   รัน: (ตั้ง env GRAPH_* + SP_* ตาม README)  node graph/server.js
 *   เปิด http://localhost:3000
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { readDay } = require('./readDay');
const { compute } = require('./compute');

const PORT = process.env.PORT || 3000;
const INDEX = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
const TTL = +(process.env.CACHE_TTL_MS || 5 * 60 * 1000);
const cache = new Map();                                   // iso -> { data, ts }
// โหมดพรีวิว: PAS_DEMO=1 → ใช้ graph/demo.json แทน Graph (ดูหน้าเว็บได้ก่อนต่อ SharePoint)
const DEMO = process.env.PAS_DEMO === '1' ? require('./demo.json') : null;

async function getDay(iso) {
  const c = cache.get(iso);
  if (c && Date.now() - c.ts < TTL) return c.data;
  const day = DEMO ? Object.assign({}, DEMO, { date: iso }) : await readDay(iso);  // Graph → parse
  const data = compute(day);
  cache.set(iso, { data, ts: Date.now() });
  return data;
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const PICK = {
  '/api/day': (d) => ({ date: d.date, sourceFile: d.sourceFile, kpi: d.kpi, teams: d.teams, manpower: d.manpower }),
  '/api/timetable': (d) => ({ date: d.date, timetable: d.timetable }),
  '/api/productivity': (d) => ({ date: d.date, kpi: d.kpi, hourly: d.hourly, teams: d.teams, people: d.people, low_util: d.low_util }),
  '/api/gantt': (d) => ({ date: d.date, gantt: d.gantt }),
};

const server = http.createServer(async (req, res) => {
  const u = url.parse(req.url, true);
  try {
    if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(INDEX);
    }
    if (u.pathname === '/api/health') return json(res, 200, { ok: true, graph: !!process.env.GRAPH_CLIENT_ID, cache: cache.size });
    const pick = PICK[u.pathname];
    if (pick) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(u.query.date || '')) return json(res, 400, { error: 'date=YYYY-MM-DD required' });
      const day = await getDay(u.query.date);
      return json(res, 200, pick(day));
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    json(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => console.log('PAS (Excel/SharePoint) dashboard บน http://localhost:' + PORT +
  '  (Graph=' + (process.env.GRAPH_CLIENT_ID ? 'set' : 'MISSING') + ')'));
