#!/usr/bin/env node
'use strict';
/* index.js — CLI: อ่านไฟล์เวรของวันจาก SharePoint (Graph) → สรุป/พ่น JSON
 *   node graph/index.js 2026-09-19            # สรุป
 *   node graph/index.js 2026-09-19 --json > pas_day.json   # พ่น JSON (ป้อน db/import.js ต่อได้)
 */
const { readDay } = require('./readDay');

(async () => {
  const iso = process.argv[2] || new Date().toISOString().slice(0, 10);
  const asJson = process.argv.includes('--json');
  const d = await readDay(iso);
  if (asJson) { process.stdout.write(JSON.stringify(d)); return; }
  const teams = Object.keys(d.teams);
  const ppl = teams.reduce((s, t) => s + d.teams[t].length, 0);
  const asg = teams.reduce((s, t) => s + d.teams[t].reduce((a, p) => a + p.assignments.length, 0), 0);
  console.log(`ไฟล์: ${d.sourceFile} · วันที่ ${d.date}`);
  console.log(`ทีม ${teams.length} · คน ${ppl} · assignment ${asg} · manpower ${d.manpower.length} แถว`);
  teams.slice(0, 8).forEach((t) => console.log(`  ${t}: ${d.teams[t].length} คน`));
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
