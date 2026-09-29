#!/usr/bin/env node
/** import_prewc.js — JSON Pre-book wheelchair (rbExportPrewcObj_) → SQL prewheelchair_booking
 *   normalize: 1 แถว = 1 ไฟลท์ × ทิศ × ชนิดรถเข็น (qty>0)
 *   node db/import_prewc.js pas_prewc_2026-09-19.json | psql -d pas   (idempotent ต่อวัน) */
'use strict';
const { esc, timeLit, q, readInput } = require('./_util');
const TYPES = ['WCHR', 'WCHS', 'WCHC', 'AVIH', 'MAAS'];   // ตำแหน่งใน arr[]/dep[] ตรงกับ PreWheelchair.gs
const d = JSON.parse(readInput()), D = esc(d.date);
if (!d.date) { console.error('no date'); process.exit(1); }
q('BEGIN;');
q(`DELETE FROM prewheelchair_booking WHERE work_date=${D};`);
let n = 0;
(d.flights || []).forEach(f => {
  [['ARR', f.arr], ['DEP', f.dep]].forEach(pair => {
    const dir = pair[0], arr = pair[1] || [];
    arr.forEach((qty, i) => {
      if (qty > 0) {
        q(`INSERT INTO prewheelchair_booking(work_date,airline_iata,flight_no,routing,sta,std,ct_open,ct_close,direction,service,qty) VALUES(` +
          [D, esc(f.airline), esc(f.flt), esc(f.routing), timeLit(f.sta), timeLit(f.std), timeLit(f.ctOpen), timeLit(f.ctClose),
           "'" + dir + "'", "'" + TYPES[i] + "'", qty].join(',') + `);`);
        n++;
      }
    });
  });
});
q('COMMIT;');
console.error('prewc rows=' + n + ' from flights=' + (d.flights || []).length + ' (date ' + d.date + ')');
