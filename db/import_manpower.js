#!/usr/bin/env node
/** import_manpower.js — JSON MANPOWER (rbExportManpowerObj_) → SQL manpower_report (upsert ต่อ team/วัน)
 *   node db/import_manpower.js pas_manpower_2026-09-19.json | psql -d pas */
'use strict';
const { esc, num, q, readInput } = require('./_util');
const d = JSON.parse(readInput()), D = esc(d.date);
if (!d.date) { console.error('no date'); process.exit(1); }
q('BEGIN;');
const teams = {}; (d.teams || []).forEach(t => { if (t.team) teams[t.team] = 1; });
Object.keys(teams).forEach(t => q(`INSERT INTO team(code) VALUES(${esc(t)}) ON CONFLICT (code) DO NOTHING;`));
(d.teams || []).forEach(t => {
  q(`INSERT INTO manpower_report(work_date,team_code,total_staff,scheduled,sick,personal,annual,maternity,other_leave,training,working_actual,ot_hours,ot_holiday,updated_at,updated_by) VALUES(` +
    [D, esc(t.team), num(t.total), num(t.scheduled), num(t.sick), num(t.personal), num(t.annual), num(t.maternity),
     num(t.other), num(t.training), num(t.working), num(t.otHours), num(t.otHoliday), esc(t.updatedAt), esc(t.updatedBy)].join(',') +
    `) ON CONFLICT (work_date,team_code) DO UPDATE SET total_staff=EXCLUDED.total_staff,scheduled=EXCLUDED.scheduled,` +
    `sick=EXCLUDED.sick,personal=EXCLUDED.personal,annual=EXCLUDED.annual,maternity=EXCLUDED.maternity,` +
    `other_leave=EXCLUDED.other_leave,training=EXCLUDED.training,working_actual=EXCLUDED.working_actual,` +
    `ot_hours=EXCLUDED.ot_hours,ot_holiday=EXCLUDED.ot_holiday,updated_at=EXCLUDED.updated_at,updated_by=EXCLUDED.updated_by;`);
});
q('COMMIT;');
console.error('manpower teams=' + (d.teams || []).length + ' (date ' + d.date + ')');
