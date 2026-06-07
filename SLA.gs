/**
 * SLA.gs — airline SLA (service level) staffing check + daily flight list.
 * =============================================================================
 * For each flight in the day's roster it counts how many staff were assigned to
 * each phase (Supervisor / Check-in / Gate / Arrival) and compares against the
 * airline SLA requirement, flagging shortages (which phase, how many short) =
 * the "support needed" check. (Renamed from the old SOP_* naming to SLA_*.)
 *
 * Requires RosterReader.gs (res = readRosterFromSpreadsheet()).
 */

// ── Airline SLA: required headcount per phase (job_roles carry the breakdown) ──
var SLA_DB = {
  'SQ': { total: 13, job_roles: [{role:'SUPERVISOR',count:1,phase:'ALL'},{role:'FLIGHT CTRL',count:1,phase:'CI'},{role:'CHECK-IN GK',count:1,phase:'CI'},{role:'CHECK-IN',count:4,phase:'CI'},{role:'GATE AGENT',count:2,phase:'GATE'},{role:'BOARDING',count:4,phase:'GATE'}] },
  'CX': { total: 15, job_roles: [{role:'SUPERVISOR',count:1,phase:'ALL'},{role:'FLIGHT CTRL',count:1,phase:'CI'},{role:'CHECK-IN GK',count:1,phase:'CI'},{role:'CHECK-IN',count:5,phase:'CI'},{role:'GATE AGENT',count:2,phase:'GATE'},{role:'BOARDING',count:5,phase:'GATE'}] },
  'LY': { total: 13, job_roles: [{role:'SUPERVISOR',count:1,phase:'ALL'},{role:'CHECK-IN GK',count:1,phase:'CI'},{role:'CHECK-IN',count:7,phase:'CI'},{role:'GATE AGENT',count:1,phase:'GATE'},{role:'BOARDING',count:3,phase:'GATE'}] },
  'QR': { total: 20, job_roles: [{role:'SUPERVISOR',count:1,phase:'ALL'},{role:'FLIGHT CONTROLLER',count:1,phase:'CI'},{role:'CHECK-IN GK',count:1,phase:'CI'},{role:'CHECK-IN',count:10,phase:'CI'},{role:'ARRIVAL',count:3,phase:'ARR'},{role:'GATE/MONITOR',count:4,phase:'GATE'}] },
  'MH': { total: 9,  job_roles: [{role:'SUPERVISOR',count:1,phase:'ALL'},{role:'CHECK-IN GK',count:1,phase:'CI'},{role:'CHECK-IN',count:3,phase:'CI'},{role:'ARRIVAL',count:1,phase:'ARR'},{role:'GATE/BIR',count:2,phase:'GATE'},{role:'GATE/MAAS',count:1,phase:'GATE'}] },
  'DE': { total: 11, job_roles: [{role:'SUPERVISOR',count:1,phase:'ALL'},{role:'FLIGHT CTRL',count:1,phase:'CI'},{role:'CHECK-IN GK',count:1,phase:'CI'},{role:'CHECK-IN',count:3,phase:'CI'},{role:'ARRIVAL',count:1,phase:'ARR'},{role:'GATE/MONITOR',count:4,phase:'GATE'}] },
  'PG': { total: 9,  job_roles: [{role:'SUPERVISOR',count:1,phase:'ALL'},{role:'GATE MONITOR',count:2,phase:'GATE'},{role:'GATE INT',count:1,phase:'GATE'},{role:'DEPARTURE',count:1,phase:'GATE'},{role:'GATE AGENT',count:3,phase:'GATE'},{role:'ARRIVAL',count:2,phase:'ARR'}] },
  'AK': { total: 8,  job_roles: [{role:'SUPERVISOR',count:1,phase:'ALL'},{role:'FLIGHT CTRL',count:1,phase:'CI'},{role:'CHECK-IN',count:2,phase:'CI'},{role:'ARRIVAL',count:1,phase:'ARR'},{role:'GATE/FLIGHT',count:1,phase:'GATE'},{role:'GATE',count:2,phase:'GATE'}] },
  'QZ': { total: 8,  job_roles: [{role:'SUPERVISOR',count:1,phase:'ALL'},{role:'FLIGHT CTRL',count:1,phase:'CI'},{role:'CHECK-IN',count:2,phase:'CI'},{role:'ARRIVAL',count:1,phase:'ARR'},{role:'GATE/FLIGHT',count:1,phase:'GATE'},{role:'GATE',count:2,phase:'GATE'}] },
  'SU': { total: 23, job_roles: [{role:'SUPERVISOR',count:1,phase:'ALL'},{role:'GATE MONITOR',count:1,phase:'GATE'},{role:'CHECK-IN',count:16,phase:'CI'},{role:'ARRIVAL',count:1,phase:'ARR'},{role:'GATE AGENT',count:4,phase:'GATE'}] },
  'B2': { total: 8,  job_roles: [{role:'SUP',count:1,phase:'ALL'},{role:'CI',count:7,phase:'CI'}] },
  'W5': { total: 8,  job_roles: [{role:'SUP',count:1,phase:'ALL'},{role:'CI',count:7,phase:'CI'}] },
  '3U': { total: 11, job_roles: [{role:'SUPERVISOR',count:1,phase:'ALL'},{role:'FLIGHT CTRL',count:1,phase:'CI'},{role:'CHECK-IN',count:3,phase:'CI'},{role:'ARRIVAL',count:1,phase:'ARR'},{role:'GATE/SOD',count:1,phase:'GATE'},{role:'GATE',count:4,phase:'GATE'}] },
  'CA': { total: 12, job_roles: [{role:'SUPERVISOR',count:1,phase:'ALL'},{role:'FLIGHT CTRL',count:1,phase:'CI'},{role:'CHECK-IN',count:5,phase:'CI'},{role:'ARRIVAL',count:1,phase:'ARR'},{role:'GATE MONITOR',count:2,phase:'GATE'},{role:'GATE',count:2,phase:'GATE'}] },
  'MU': { total: 11, job_roles: [{role:'SUP',count:1,phase:'ALL'},{role:'CI',count:5,phase:'CI'},{role:'ARR',count:1,phase:'ARR'},{role:'GATE',count:4,phase:'GATE'}] },
  'CZ': { total: 10, job_roles: [{role:'SUP',count:1,phase:'ALL'},{role:'CI',count:4,phase:'CI'},{role:'ARR',count:1,phase:'ARR'},{role:'GATE',count:4,phase:'GATE'}] },
  'FM': { total: 11, job_roles: [{role:'SUP',count:1,phase:'ALL'},{role:'CI',count:5,phase:'CI'},{role:'ARR',count:1,phase:'ARR'},{role:'GATE',count:4,phase:'GATE'}] },
  'HO': { total: 10, job_roles: [{role:'SUP',count:1,phase:'ALL'},{role:'CI',count:4,phase:'CI'},{role:'ARR',count:2,phase:'ARR'},{role:'GATE',count:3,phase:'GATE'}] },
  'HU': { total: 10, job_roles: [{role:'SUP',count:1,phase:'ALL'},{role:'CI',count:4,phase:'CI'},{role:'ARR',count:1,phase:'ARR'},{role:'GATE',count:4,phase:'GATE'}] },
  'AQ': { total: 9,  job_roles: [{role:'SUP',count:1,phase:'ALL'},{role:'CI',count:4,phase:'CI'},{role:'ARR',count:1,phase:'ARR'},{role:'GATE',count:3,phase:'GATE'}] },
  'HX': { total: 11, job_roles: [{role:'SUP',count:1,phase:'ALL'},{role:'CI',count:5,phase:'CI'},{role:'ARR',count:1,phase:'ARR'},{role:'GATE',count:4,phase:'GATE'}] },
  'EY': { total: 11, job_roles: [{role:'SUPERVISOR',count:1,phase:'ALL'},{role:'FLIGHT CTRL',count:1,phase:'CI'},{role:'SOD/CTR',count:1,phase:'CI'},{role:'J-CLASS',count:2,phase:'CI'},{role:'BOARDING',count:5,phase:'GATE'},{role:'ARRIVAL',count:1,phase:'ARR'}] },
  'AY': { total: 9,  job_roles: [{role:'SUP',count:1,phase:'ALL'},{role:'CI',count:4,phase:'CI'},{role:'ARR',count:1,phase:'ARR'},{role:'GATE',count:3,phase:'GATE'}] },
  'DV': { total: 9,  job_roles: [{role:'SUP',count:1,phase:'ALL'},{role:'CI',count:4,phase:'CI'},{role:'ARR',count:1,phase:'ARR'},{role:'GATE',count:3,phase:'GATE'}] },
  'KE': { total: 8,  job_roles: [{role:'SUPERVISOR',count:1,phase:'ALL'},{role:'ASST GC',count:1,phase:'CI'},{role:'CHECK-IN',count:4,phase:'CI'},{role:'GATE',count:1,phase:'GATE'},{role:'ARRIVAL',count:1,phase:'ARR'}] },
  'KC': { total: 9,  job_roles: [{role:'SUP',count:1,phase:'ALL'},{role:'CI GK',count:1,phase:'CI'},{role:'CI',count:5,phase:'CI'},{role:'GATE',count:1,phase:'GATE'},{role:'ARR',count:1,phase:'ARR'}] },
  'OZ': { total: 7,  job_roles: [{role:'SUP',count:1,phase:'ALL'},{role:'CI',count:4,phase:'CI'},{role:'GATE',count:1,phase:'GATE'},{role:'ARR',count:1,phase:'ARR'}] },
  'NO': { total: 7,  job_roles: [{role:'SUP',count:1,phase:'ALL'},{role:'CI',count:4,phase:'CI'},{role:'GATE',count:1,phase:'GATE'},{role:'ARR',count:1,phase:'ARR'}] },
  'AF': { total: 9,  job_roles: [{role:'SUP',count:1,phase:'ALL'},{role:'CI',count:5,phase:'CI'},{role:'GATE',count:1,phase:'GATE'},{role:'ARR',count:2,phase:'ARR'}] },
  'LJ': { total: 7,  job_roles: [{role:'SUP',count:1,phase:'ALL'},{role:'CI',count:4,phase:'CI'},{role:'GATE',count:1,phase:'GATE'},{role:'ARR',count:1,phase:'ARR'}] },
  'WY': { total: 15, job_roles: [{role:'SUPERVISOR 1',count:1,phase:'ALL'},{role:'SUPERVISOR 2',count:1,phase:'ALL'},{role:'CHECK-IN',count:6,phase:'CI'},{role:'ARRIVAL',count:1,phase:'ARR'},{role:'GATE',count:6,phase:'GATE'}] },
  'G9': { total: 6,  job_roles: [{role:'SUP',count:1,phase:'ALL'},{role:'CI',count:4,phase:'CI'},{role:'ARR',count:1,phase:'ARR'}] },
  'DK': { total: 6,  job_roles: [{role:'SUP',count:1,phase:'ALL'},{role:'CI',count:4,phase:'CI'},{role:'ARR',count:1,phase:'ARR'}] },
  '9C': { total: 7,  job_roles: [{role:'SUP',count:1,phase:'ALL'},{role:'CI',count:4,phase:'CI'},{role:'ARR',count:1,phase:'ARR'},{role:'GATE',count:1,phase:'GATE'}] },
  'EK': { total: 16, job_roles: [{role:'SUPERVISOR',count:1,phase:'ALL'},{role:'FLIGHT CTRL',count:1,phase:'CI'},{role:'SOD/DOCUMENT',count:1,phase:'CI'},{role:'CHECK-IN GK',count:1,phase:'CI'},{role:'CHECK-IN',count:3,phase:'CI'},{role:'ARRIVAL',count:4,phase:'ARR'},{role:'GATE/BIR',count:2,phase:'GATE'},{role:'GATE/MAAS',count:1,phase:'GATE'},{role:'CREW ASSIGN',count:1,phase:'GATE'},{role:'CF',count:1,phase:'GATE'}] },
  'UO': { total: 10, job_roles: [{role:'SUP',count:1,phase:'ALL'},{role:'CI',count:4,phase:'CI'},{role:'ARR',count:2,phase:'ARR'},{role:'GATE',count:3,phase:'GATE'}] },
  'FY': { total: 8,  job_roles: [{role:'SUP',count:1,phase:'ALL'},{role:'CI',count:3,phase:'CI'},{role:'ARR',count:1,phase:'ARR'},{role:'GATE',count:3,phase:'GATE'}] },
  '6B': { total: 9,  job_roles: [{role:'SUP',count:1,phase:'ALL'},{role:'CI',count:4,phase:'CI'},{role:'ARR',count:1,phase:'ARR'},{role:'GATE',count:3,phase:'GATE'}] },
  'BY': { total: 9,  job_roles: [{role:'SUP',count:1,phase:'ALL'},{role:'CI',count:4,phase:'CI'},{role:'ARR',count:1,phase:'ARR'},{role:'GATE',count:3,phase:'GATE'}] },
  'AI': { total: 12, job_roles: [{role:'SUPERVISOR',count:1,phase:'ALL'},{role:'FC/CTR-BC',count:2,phase:'CI'},{role:'SOD',count:1,phase:'CI'},{role:'ARRIVAL',count:2,phase:'ARR'},{role:'FC/PFD',count:1,phase:'GATE'},{role:'GATE',count:4,phase:'GATE'}] },
  'IX': { total: 5,  job_roles: [{role:'SUP',count:1,phase:'ALL'},{role:'SOD',count:1,phase:'CI'},{role:'CI GK',count:1,phase:'CI'},{role:'CI',count:2,phase:'CI'}] },
  'JQ': { total: 15, job_roles: [{role:'SUPERVISOR',count:1,phase:'ALL'},{role:'SOD/GTE',count:1,phase:'CI'},{role:'SOD/CTR',count:1,phase:'CI'},{role:'FC/CTR-BC',count:2,phase:'CI'},{role:'SD',count:1,phase:'CI'},{role:'FC/PFD',count:1,phase:'GATE'},{role:'ARRIVAL',count:3,phase:'ARR'},{role:'GATE',count:5,phase:'GATE'}] },
  'IT': { total: 8,  job_roles: [{role:'SUPERVISOR',count:1,phase:'ALL'},{role:'SOD',count:1,phase:'CI'},{role:'CHECK-IN GK',count:1,phase:'CI'},{role:'CHECK-IN',count:2,phase:'CI'},{role:'ARRIVAL',count:1,phase:'ARR'},{role:'GATE',count:2,phase:'GATE'}] },
  'N0': { total: 8,  job_roles: [{role:'SUP',count:1,phase:'ALL'},{role:'CI',count:4,phase:'CI'},{role:'ARR',count:1,phase:'ARR'},{role:'GATE',count:2,phase:'GATE'}] },
  'TK': { total: 11, job_roles: [{role:'SUPERVISOR',count:1,phase:'ALL'},{role:'SOD',count:1,phase:'CI'},{role:'GATE MONITOR',count:1,phase:'GATE'},{role:'FLIGHT CTRL',count:1,phase:'CI'},{role:'CREW SIGN',count:1,phase:'ALL'},{role:'ARRIVAL',count:2,phase:'ARR'},{role:'BOGO',count:1,phase:'GATE'},{role:'Y-CLASS',count:2,phase:'GATE'},{role:'CHECK-IN',count:1,phase:'CI'}] },
  'VJ': { total: 5,  job_roles: [{role:'SOD',count:1,phase:'ALL'},{role:'GM',count:1,phase:'GATE'},{role:'FC',count:1,phase:'CI'},{role:'CS',count:1,phase:'CI'},{role:'ARR',count:1,phase:'ARR'}] },
  'OD': { total: 5,  job_roles: [{role:'SOD',count:1,phase:'ALL'},{role:'GM',count:1,phase:'GATE'},{role:'FC',count:1,phase:'CI'},{role:'ARR',count:1,phase:'ARR'}] },
  'SG': { total: 8,  job_roles: [{role:'SUP',count:1,phase:'ALL'},{role:'CI',count:4,phase:'CI'},{role:'ARR',count:1,phase:'ARR'},{role:'GATE',count:2,phase:'GATE'}] },
  'HY': { total: 8,  job_roles: [{role:'SUP',count:1,phase:'ALL'},{role:'CI',count:4,phase:'CI'},{role:'ARR',count:1,phase:'ARR'},{role:'GATE',count:2,phase:'GATE'}] },
  'TR': { total: 10, job_roles: [{role:'SUPERVISOR',count:1,phase:'ALL'},{role:'FLIGHT CTRL',count:1,phase:'CI'},{role:'SOD',count:1,phase:'CI'},{role:'CHECK-IN GK',count:1,phase:'CI'},{role:'CHECK-IN',count:2,phase:'CI'},{role:'ARRIVAL',count:1,phase:'ARR'},{role:'GATE',count:3,phase:'GATE'}] },
  '6E': { total: 7,  job_roles: [{role:'SUP',count:1,phase:'ALL'},{role:'FC',count:1,phase:'CI'},{role:'CI',count:4,phase:'CI'},{role:'ARR',count:1,phase:'ARR'}] },
  'QP': { total: 7,  job_roles: [{role:'SUP',count:1,phase:'ALL'},{role:'FC',count:1,phase:'CI'},{role:'CI',count:4,phase:'CI'},{role:'ARR',count:1,phase:'ARR'}] },
  'SV': { total: 14, job_roles: [{role:'SUP',count:1,phase:'ALL'},{role:'MONITOR',count:1,phase:'ALL'},{role:'CI',count:7,phase:'CI'},{role:'ARR',count:2,phase:'ARR'},{role:'GATE',count:3,phase:'GATE'}] },
  'WK': { total: 14, job_roles: [{role:'SUP',count:1,phase:'ALL'},{role:'MONITOR',count:1,phase:'ALL'},{role:'CI',count:7,phase:'CI'},{role:'ARR',count:2,phase:'ARR'},{role:'GATE',count:3,phase:'GATE'}] },
  'KA': { total: 10, job_roles: [{role:'SUP',count:1,phase:'ALL'},{role:'CI',count:5,phase:'CI'},{role:'ARR',count:1,phase:'ARR'},{role:'GATE',count:3,phase:'GATE'}] },
  'ZF': { total: 10, job_roles: [{role:'SUP',count:1,phase:'ALL'},{role:'FC',count:1,phase:'CI'},{role:'CI',count:4,phase:'CI'},{role:'ARR',count:1,phase:'ARR'},{role:'GATE',count:3,phase:'GATE'}] },
  'DEFAULT': { total: 8, job_roles: [{role:'SUPERVISOR',count:1,phase:'ALL'},{role:'CHECK-IN',count:4,phase:'CI'},{role:'ARRIVAL',count:1,phase:'ARR'},{role:'GATE',count:2,phase:'GATE'}] },
};
var SLA_ALIAS = { '8M':'QZ', 'HB':'DEFAULT', 'G2':'DEFAULT', 'H4':'DEFAULT', 'WZ':'ZF', 'N4':'DEFAULT', 'C6':'DEFAULT', 'EO':'ZF', 'S7':'ZF', 'LO':'ZF', 'HH':'ZF', 'OM':'DE', 'OV':'LJ' };

// Official establishment requirement per team (SUP/SNR/PSA) from the AOTGA
// Manpower Meeting file — the FULL roster needed, not the daily on-duty count.
// (Used for HR headcount planning vs the master active headcount, not the daily
// flight SLA above.)
var TEAM_SLA_RQ = {
  'SQ':{SUP:8,SNR:8,PSA:46,total:62}, 'QR':{SUP:8,SNR:8,PSA:92,total:108}, 'PG':{SUP:4,SNR:4,PSA:28,total:36},
  'AK':{SUP:7,SNR:6,PSA:27,total:40}, 'SU':{SUP:10,SNR:10,PSA:44,total:64}, 'KE':{SUP:7,SNR:9,PSA:63,total:79},
  'EY':{SUP:5,SNR:5,PSA:51,total:61}, 'JQ':{SUP:6,SNR:7,PSA:32,total:45}, 'TK':{SUP:6,SNR:7,PSA:30,total:43},
  'TR':{SUP:9,SNR:12,PSA:38,total:59}, 'WY':{SUP:9,SNR:12,PSA:36,total:57}, 'EK':{SUP:7,SNR:7,PSA:39,total:53},
  'WK':{SUP:4,SNR:6,PSA:30,total:40}, 'CHN':{SUP:11,SNR:10,PSA:58,total:79},
};

function slaGet_(airline) {
  var c = String(airline || '').trim().toUpperCase();
  if (SLA_DB[c]) return SLA_DB[c];
  if (SLA_ALIAS[c] && SLA_DB[SLA_ALIAS[c]]) return SLA_DB[SLA_ALIAS[c]];
  return SLA_DB.DEFAULT;
}
function slaAirlineOf_(flight) {
  var m = String(flight || '').trim().toUpperCase().match(/([A-Z]{1,3})\s*\d/);
  return m ? m[1] : 'DEFAULT';
}
/** required headcount per phase for an airline */
function slaReq_(airline) {
  var db = slaGet_(airline);
  var req = { SUP: 0, CI: 0, GATE: 0, ARR: 0, total: db.total || 0 };
  (db.job_roles || []).forEach(function (r) {
    var ph = r.phase === 'ALL' ? 'SUP' : r.phase;
    if (req[ph] === undefined) ph = 'CI';
    req[ph] += r.count;
  });
  return req;
}
/** classify a job task code into a phase */
function slaPhaseOf_(task) {
  var u = String(task || '').toUpperCase();
  if (!u) return 'CI';
  if (/SUP|SPVR|^SOD|SM\b|MONITOR|CREW|^CS\b|CRW/.test(u)) return 'SUP';
  if (/ARR|MEET|^AC\b|^RF\b|ESCORT|BIR/.test(u)) return 'ARR';
  if (/GATE|^G[\b\/CM-]|^GM|^GC|BOARD|^B\b|BGO|BOCO|MAAS|PFD|GBD|^D\b|DEPART/.test(u)) return 'GATE';
  return 'CI';   // check-in default (CT, C, Y, J, W, F, WEB, KIOSK, PSM, FC, GK, SD...)
}

/** collect all flights from the day's roster (PSA + LL), with assigned staff. */
function slaCollectFlights_(res, ll) {
  var flights = {};
  function add(team, rec) {
    (rec.assignments || []).forEach(function (a) {
      var key = String(a.flight || '').trim();
      if (!key) return;
      if (!flights[key]) {
        flights[key] = { flight: key, airline: slaAirlineOf_(key), teams: {},
          STA: a.STA || '', STD: a.STD || '', OP: a.OP || '', CL: a.CL || '',
          assigned: { SUP: 0, CI: 0, GATE: 0, ARR: 0, total: 0 }, staff: [] };
      }
      var f = flights[key];
      f.teams[team] = true;
      if (!f.STA && a.STA) f.STA = a.STA; if (!f.STD && a.STD) f.STD = a.STD;
      if (!f.OP && a.OP) f.OP = a.OP; if (!f.CL && a.CL) f.CL = a.CL;
      var ph = slaPhaseOf_(a.task);
      f.assigned[ph]++; f.assigned.total++;
      f.staff.push({ name: rec.name, pos: rec.pos, team: team, task: a.task, phase: ph });
    });
  }
  Object.keys(res.teams).forEach(function (t) {
    res.teams[t].records.forEach(function (r) { if (r.bucket === 'working' || r.bucket === 'ot_off') add(t, r); });
  });
  if (ll && ll.totals.staff > 0) {
    Object.keys(ll.sections).forEach(function (s) {
      ll.sections[s].records.forEach(function (r) { if (r.bucket === 'working' || r.bucket === 'ot_off') add('LL·' + s, r); });
    });
  }
  // compute requirement + shortages per flight
  return Object.keys(flights).map(function (k) {
    var f = flights[k];
    f.req = slaReq_(f.airline);
    f.short = {};
    ['SUP', 'CI', 'GATE', 'ARR'].forEach(function (ph) {
      var d = f.req[ph] - f.assigned[ph];
      if (d > 0) f.short[ph] = d;
    });
    f.shortTotal = Math.max(0, f.req.total - f.assigned.total);
    f.ok = Object.keys(f.short).length === 0 && f.shortTotal === 0;
    f.teamList = Object.keys(f.teams).join(',');
    return f;
  }).sort(function (a, b) { return String(a.STD || a.STA || 'zz').localeCompare(String(b.STD || b.STA || 'zz')); });
}

var SLA_PH_TH = { SUP: 'SUP', CI: 'Check-in', GATE: 'Gate', ARR: 'Arrival' };
function slaShortText_(f) {
  var parts = [];
  ['SUP', 'CI', 'GATE', 'ARR'].forEach(function (ph) { if (f.short[ph]) parts.push(SLA_PH_TH[ph] + ' ขาด ' + f.short[ph]); });
  return parts.length ? parts.join(' · ') : (f.shortTotal ? ('ขาดรวม ' + f.shortTotal) : '');
}

/** Sheet tab: ✈️ Flights & SLA — day's flights + required vs assigned + shortage */
function rbWriteFlightSLA_(ss, res, dateStr, ll, tabName) {
  tabName = tabName || '✈️ Flights & SLA';
  var old = ss.getSheetByName(tabName);
  if (old) ss.deleteSheet(old);
  var sh = ss.insertSheet(tabName);

  var flights = slaCollectFlights_(res, ll);
  var W = 13;
  sh.getRange(1, 1, 1, W).merge().setValue('✈️ ไฟลท์บินประจำวัน + เช็ค SLA สายการบิน — ' + dateStr)
    .setBackground('#0d2137').setFontColor('#fff').setFontWeight('bold').setFontSize(13).setHorizontalAlignment('center');
  sh.setRowHeight(1, 28);
  var head = ['Flight', 'สายการบิน', 'ทีม', 'STA', 'STD', 'OP', 'CL', 'ส่งไป(คน)', 'SLA ต้องการ', 'SUP', 'Check-in', 'Gate', 'Arrival'];
  sh.getRange(2, 1, 1, W).setValues([head]).setBackground('#1f4e79').setFontColor('#fff').setFontWeight('bold')
    .setHorizontalAlignment('center');
  var body = [], status = [];
  flights.forEach(function (f) {
    function cell(ph) { return f.assigned[ph] + '/' + f.req[ph] + (f.short[ph] ? ' ⚠️-' + f.short[ph] : ' ✓'); }
    body.push([f.flight, f.airline, f.teamList, f.STA, f.STD, f.OP, f.CL,
               f.assigned.total, f.req.total, cell('SUP'), cell('CI'), cell('GATE'), cell('ARR')]);
    status.push(f.ok);
  });
  if (body.length) {
    sh.getRange(3, 1, body.length, W).setValues(body).setFontSize(9).setVerticalAlignment('middle');
    for (var i = 0; i < body.length; i++) {
      var bg = status[i] ? '#e8f5e9' : '#fff3cd';
      sh.getRange(3 + i, 1, 1, W).setBackground(i % 2 ? bg : bg);
      if (!status[i]) sh.getRange(3 + i, 1, 1, W).setBackground('#fde8e8');
    }
  }
  [110, 75, 90, 55, 55, 55, 55, 70, 80, 70, 80, 70, 70].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(2);
  return flights;
}

/** Sheet tab: 🆘 Support — only the understaffed flights, which phase is short */
function rbWriteSupport_(ss, res, dateStr, ll, tabName) {
  tabName = tabName || '🆘 Support';
  var old = ss.getSheetByName(tabName);
  if (old) ss.deleteSheet(old);
  var sh = ss.insertSheet(tabName);
  var flights = slaCollectFlights_(res, ll).filter(function (f) { return !f.ok; });

  sh.getRange(1, 1, 1, 7).merge().setValue('🆘 ไฟลท์ที่ส่งพนักงานไม่ครบตาม SLA — ' + dateStr)
    .setBackground('#b71c1c').setFontColor('#fff').setFontWeight('bold').setFontSize(13).setHorizontalAlignment('center');
  sh.setRowHeight(1, 28);
  sh.getRange(2, 1, 1, 7).setValues([['Flight', 'สายการบิน', 'ทีม', 'STD', 'ส่งไป/ต้องการ', 'ขาดตำแหน่ง (phase)', 'รายละเอียด']])
    .setBackground('#d32f2f').setFontColor('#fff').setFontWeight('bold').setHorizontalAlignment('center');
  if (!flights.length) {
    sh.getRange(3, 1, 1, 7).merge().setValue('✅ ทุกไฟลท์ส่งพนักงานครบตาม SLA').setBackground('#e8f5e9')
      .setFontWeight('bold').setFontColor('#1b5e20').setHorizontalAlignment('center');
  } else {
    var rows = flights.map(function (f) {
      return [f.flight, f.airline, f.teamList, f.STD || f.STA, f.assigned.total + '/' + f.req.total,
              slaShortText_(f),
              f.staff.map(function (s) { return s.name + '[' + s.task + ']'; }).slice(0, 8).join(', ')];
    });
    sh.getRange(3, 1, rows.length, 7).setValues(rows).setFontSize(9).setBackground('#fff3f3');
  }
  [110, 75, 100, 55, 100, 200, 320].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(2);
}
