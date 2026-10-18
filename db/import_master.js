#!/usr/bin/env node
/**
 * import_master.js — แปลง JSON รายชื่อ (จาก Apps Script rbExportMasterJson/rbSaveMasterJson)
 *                    → SQL upsert ตาราง employee (+ team / position_group stub)
 *
 * ใช้:
 *   node db/import_master.js pas_master.json | psql -d pas
 *
 * upsert แบบ DO UPDATE → ทับ/เติมข้อมูลให้ stub ที่ import.js (duty) สร้างไว้ ครบทุกฟิลด์
 */
'use strict';
const fs = require('fs');

function esc(v) { return (v === null || v === undefined || v === '') ? 'NULL' : "'" + String(v).replace(/'/g, "''") + "'"; }
function q(s) { process.stdout.write(s + '\n'); }
function readInput() { const a = process.argv[2]; return (a && a !== '-') ? fs.readFileSync(a, 'utf8') : fs.readFileSync(0, 'utf8'); }
const DEPT = { PSA: "'PSA'", LL: "'LL'" };
const SRC = { HKT: "'HKT'", BKK: "'BKK'", GLOBEX: "'GLOBEX'", OUTSOURCE: "'OUTSOURCE'" };

function main() {
  const data = JSON.parse(readInput());
  const emps = data.employees || [];
  if (!emps.length) { console.error('no employees in JSON'); process.exit(1); }

  q('-- master import: ' + emps.length + ' employees');
  q('BEGIN;');

  // team + position_group stubs
  const teams = {}, pgs = {};
  emps.forEach(function (e) { if (e.team) teams[e.team] = 1; if (e.posGroup) pgs[e.posGroup] = 1; });
  Object.keys(teams).forEach(function (t) { q('INSERT INTO team(code) VALUES(' + esc(t) + ') ON CONFLICT (code) DO NOTHING;'); });
  Object.keys(pgs).forEach(function (p) { q('INSERT INTO position_group(code) VALUES(' + esc(p) + ') ON CONFLICT (code) DO NOTHING;'); });

  emps.forEach(function (e) {
    const vals = [
      esc(e.code), esc(e.nameTh), esc(e.nameEn), esc(e.team),
      DEPT[e.dept] || 'NULL', esc(e.position), esc(e.posGroup), SRC[e.source] || "'HKT'",
      esc(e.startDate), esc(e.resignDate), "'" + (e.status === 'RESIGNED' ? 'RESIGNED' : 'ACTIVE') + "'"
    ];
    q('INSERT INTO employee(emp_code,name_th,name_en,team_code,department,position,pos_group,source,start_date,resign_date,status) VALUES(' +
      vals.join(',') + ') ON CONFLICT (emp_code) DO UPDATE SET ' +
      'name_th=EXCLUDED.name_th,name_en=EXCLUDED.name_en,team_code=EXCLUDED.team_code,department=EXCLUDED.department,' +
      'position=EXCLUDED.position,pos_group=EXCLUDED.pos_group,source=EXCLUDED.source,' +
      'start_date=EXCLUDED.start_date,resign_date=EXCLUDED.resign_date,status=EXCLUDED.status;');
  });

  q('COMMIT;');
  const by = {}; emps.forEach(function (e) { by[e.source] = (by[e.source] || 0) + 1; });
  console.error('employees=' + emps.length + ' ' + JSON.stringify(by));
}
main();
