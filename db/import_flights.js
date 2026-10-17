#!/usr/bin/env node
/** import_flights.js — JSON ตารางบิน (rbExportFlightsObj_) → SQL flight_schedule
 *   node db/import_flights.js pas_flights_2026-09-19.json | psql -d pas   (idempotent ต่อวัน) */
'use strict';
const { esc, timeLit, q, readInput } = require('./_util');
const d = JSON.parse(readInput()), D = esc(d.date);
if (!d.date) { console.error('no date'); process.exit(1); }
q('BEGIN;');
const air = {}; (d.flights || []).forEach(f => { if (f.airline) air[f.airline] = 1; });
Object.keys(air).forEach(a => q(`INSERT INTO airline(iata) VALUES(${esc(a)}) ON CONFLICT (iata) DO NOTHING;`));
q(`DELETE FROM flight_schedule WHERE flight_date=${D};`);
let n = 0;
(d.flights || []).forEach(f => {
  if (f.cancelled) return;
  const dir = (f.sta && f.std) ? 'TURN' : (f.std ? 'DEP' : (f.sta ? 'ARR' : 'TURN'));
  q(`INSERT INTO flight_schedule(flight_date,flight_no,airline_iata,direction,sta,std,aircraft_type) VALUES(` +
    [D, esc(f.flightNo), esc(f.airline), "'" + dir + "'", timeLit(f.sta), timeLit(f.std), esc(f.ac)].join(',') +
    `) ON CONFLICT (flight_date,flight_no,direction) DO NOTHING;`);
  n++;
});
q('COMMIT;');
console.error('flights=' + n + ' (date ' + d.date + ')');
