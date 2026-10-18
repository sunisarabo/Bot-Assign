#!/usr/bin/env node
/** import_porter.js — JSON Porter case log (rbExportPorterObj_) → SQL porter_job + porter_staff_day
 *   node db/import_porter.js pas_porter_2026-09-19.json | psql -d pas   (idempotent ต่อวัน) */
'use strict';
const { esc, intOrNull, int0, bool, timeLit, waitLit, q, readInput } = require('./_util');
const d = JSON.parse(readInput()), D = esc(d.date);
if (!d.date) { console.error('no date'); process.exit(1); }
const SVC = { WCHR: 1, WCHS: 1, WCHC: 1, MAAS: 1, AVIH: 1, ETC: 1 };
const svc = s => { const u = String(s || '').toUpperCase(); return SVC[u] ? "'" + u + "'" : 'NULL'; };
const st = s => { const u = String(s || '').toUpperCase(); return u === 'COMPLETED' ? "'COMPLETED'" : (u === 'ON PROCESS' ? "'ON_PROCESS'" : (u === 'STANDBY' ? "'STANDBY'" : 'NULL')); };
q('BEGIN;');
q(`DELETE FROM porter_job WHERE work_date=${D};`);
q(`DELETE FROM porter_staff_day WHERE work_date=${D};`);
(d.jobs || []).forEach(j => {
  q(`INSERT INTO porter_job(work_date,seq_no,airline_iata,flight_no,porter_names,status,eta,etd,gate,notified_at,pickup_at,delivered_at,service,is_arrival,is_departure,wait_dur,seat,remark) VALUES(` +
    [D, intOrNull(j.no), esc(j.airline), esc(j.flight), esc(j.porter), st(j.status),
     timeLit(j.eta), timeLit(j.etd), esc(j.gate), timeLit(j.notified), timeLit(j.pickup), timeLit(j.delivered),
     svc(j.svc), bool(j.arr), bool(j.dep), waitLit(j.wait), esc(j.seat), esc(j.remark)].join(',') + `);`);
});
(d.staff || []).forEach(s => {
  q(`INSERT INTO porter_staff_day(work_date,staff_no,name,cases) VALUES(` +
    [D, intOrNull(s.no), esc(s.name), int0(s.cases)].join(',') +
    `) ON CONFLICT (work_date,name) DO UPDATE SET cases=EXCLUDED.cases,staff_no=EXCLUDED.staff_no;`);
});
q('COMMIT;');
console.error('porter jobs=' + (d.jobs || []).length + ' staff=' + (d.staff || []).length + ' (date ' + d.date + ')');
