/**
 * RosterBot.gs — integration layer on top of RosterReader.gs
 * =============================================================================
 * Turns the validated roster reader into the actual outputs:
 *   • a Dashboard tab  — per-team headcount + OT + flight counts (+ grand total)
 *   • a Timetable tab  — per-team, per-employee flights with shift / OT and each
 *                        flight's task and open–close (OP/CL) or STA/STD times,
 *                        for judging schedule appropriateness
 *   • a Google Chat summary
 *
 * Requires RosterReader.gs in the same Apps Script project
 * (uses readRosterFromSpreadsheet()).
 *
 * Quick test against a real roster file (recommended first step):
 *   1. put a roster spreadsheet's ID in testRosterFromId()
 *   2. Run → testRosterFromId  → it writes "📊 Dashboard" and "🕓 Timetable"
 *      tabs into a fresh output spreadsheet and logs the link.
 * Daily automation: set CONFIG_RB + a time trigger on runDailyRosterReport.
 */

var CONFIG_RB = {
  ROOT_FOLDER_ID:   '1Uk-6w7U-cqQEXFIVEl6tRhKKRCaN1ojp',   // year folder (drill month→day)
  OUTPUT_FOLDER_ID: '17UuLV9sDovyDWK4s8O3IRBJM2a4jGORM',   // where monthly output files live
  CHAT_WEBHOOK_PROP: 'GCHAT_WEBHOOK_REPORT',               // Script Property holding the webhook URL
  SKIP_TIMETABLE_TEAMS: [],                                // teams to omit from the timetable tab
};

var MON_RB = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

// ─── ENTRY POINTS ───────────────────────────────────────────────────────────
function runDailyRosterReport() { rbRunForDate_(new Date()); }

function runRosterForDate(y, m, d) { rbRunForDate_(new Date(y, m - 1, d)); }

/** Simplest manual test: read ONE roster spreadsheet by ID, write the reports. */
function testRosterFromId(ssId) {
  ssId = ssId || 'PUT_A_ROSTER_SPREADSHEET_ID_HERE';
  var roster = SpreadsheetApp.openById(ssId);
  var res = readRosterFromSpreadsheet(roster);
  var out = SpreadsheetApp.create('Roster Report — ' + roster.getName());
  rbWriteDashboard_(out, res, roster.getName());
  rbWriteTimetable_(out, res, roster.getName());
  var cleanup = out.getSheetByName('Sheet1');
  if (cleanup && out.getSheets().length > 1) out.deleteSheet(cleanup);
  Logger.log('✅ Report written: %s', out.getUrl());
  return out.getUrl();
}

// ─── MAIN PIPELINE ──────────────────────────────────────────────────────────
function rbRunForDate_(date) {
  var roster = rbOpenTodayRoster_(date);
  var res = readRosterFromSpreadsheet(roster.ss);

  var be = date.getFullYear() + 543;
  var mon = MON_RB[date.getMonth()];
  var dateStr = date.getDate() + ' ' + mon + ' ' + be;

  var out = rbGetMonthlyOutput_(mon, be);
  rbWriteDashboard_(out, res, dateStr);
  rbWriteTimetable_(out, res, dateStr);
  if (roster.tempId) { try { DriveApp.getFileById(roster.tempId).setTrashed(true); } catch (e) {} }

  rbPostChat_(res, dateStr, out.getUrl());
  Logger.log('✅ Done: %s', out.getUrl());
}

// ─── DASHBOARD TAB ──────────────────────────────────────────────────────────
function rbWriteDashboard_(ss, res, dateStr) {
  var sh = ss.getSheetByName('📊 Dashboard');
  if (sh) { sh.clear(); } else { sh = ss.insertSheet('📊 Dashboard', 0); }

  var head = ['Team', 'Total', 'Working', 'OT-Off', 'Off', 'Sick', 'Leave', 'OT ppl', 'OT hrs', 'Flights'];
  var rows = [head];
  var order = Object.keys(res.teams).sort(function (a, b) {
    return res.teams[b].working - res.teams[a].working;
  });
  order.forEach(function (t) {
    var b = res.teams[t];
    rows.push([t, b.staff, b.working, b.ot_off, b.off, b.sick, b.leave, b.otPeople, b.otHours, b.flights]);
  });
  var T = res.totals;
  rows.push(['GRAND TOTAL', T.staff, T.working, T.ot_off, T.off, T.sick, T.leave, T.otPeople, T.otHours, T.flights]);

  sh.getRange(1, 1, 1, head.length).setValues([['📊 Daily Manpower — ' + dateStr].concat(new Array(head.length - 1).fill('')) ]);
  sh.getRange(1, 1, 1, head.length).merge().setBackground('#0d2137').setFontColor('#fff')
    .setFontWeight('bold').setFontSize(13).setHorizontalAlignment('center');
  sh.getRange(2, 1, rows.length, head.length).setValues(rows);
  sh.getRange(2, 1, 1, head.length).setBackground('#1f4e79').setFontColor('#fff').setFontWeight('bold');
  sh.getRange(1 + rows.length, 1, 1, head.length).setBackground('#1f4e79').setFontColor('#fff').setFontWeight('bold');

  // by-position-group block (exact counts from the assignment file)
  var pr = rows.length + 3;
  sh.getRange(pr, 1, 1, head.length).merge().setValue('โดยตำแหน่ง (By position group)')
    .setBackground('#7f6000').setFontColor('#fff').setFontWeight('bold');
  var phead = ['Position', 'Total', 'Working', 'OT-Off', 'Off', 'Sick', 'Leave', 'OT ppl', 'OT hrs', 'Flights'];
  sh.getRange(pr + 1, 1, 1, phead.length).setValues([phead])
    .setBackground('#bf8f00').setFontColor('#fff').setFontWeight('bold');
  var prows = [];
  ['PSS', 'SNR', 'PSA', 'Globlex', 'AdminD', 'Porter', 'Crewsign', 'DIR', 'MGR', 'Assist'].forEach(function (p) {
    var b = res.positions[p]; if (!b) return;
    prows.push([p, b.staff, b.working, b.ot_off, b.off, b.sick, b.leave, b.otPeople, b.otHours, b.flights]);
  });
  if (prows.length) sh.getRange(pr + 2, 1, prows.length, phead.length).setValues(prows);

  for (var c = 1; c <= head.length; c++) sh.autoResizeColumn(c);
  sh.setFrozenRows(2);
}

// ─── TIMETABLE TAB ──────────────────────────────────────────────────────────
function rbFlightCell_(a) {
  var open = a.OP || a.STA || '';
  var close = a.CL || a.STD || '';
  var t = a.task ? (' [' + a.task + ']') : '';
  var time = (open || close) ? (' ' + open + '-' + close) : '';
  return a.flight + t + time;
}

function rbWriteTimetable_(ss, res, dateStr) {
  var sh = ss.getSheetByName('🕓 Timetable');
  if (sh) { sh.clear(); } else { sh = ss.insertSheet('🕓 Timetable'); }

  var rows = [['Team', 'Name', 'Position', 'Shift', 'OT', '#Flt', 'Flights (task @ open-close)']];
  var meta = [{ type: 'title' }];
  rows.push(['🕓 Timetable / Scheduling — ' + dateStr, '', '', '', '', '', '']);
  meta.push({ type: 'title2' });

  Object.keys(res.teams).forEach(function (team) {
    if (CONFIG_RB.SKIP_TIMETABLE_TEAMS.indexOf(team) >= 0) return;
    var b = res.teams[team];
    rows.push(['▶ ' + team + '  —  flights handled: ' + b.flights + '  •  working: ' + (b.working + b.ot_off),
               '', '', '', '', '', '']);
    meta.push({ type: 'team' });
    b.records.forEach(function (r) {
      if (r.bucket !== 'working' && r.bucket !== 'ot_off') return;
      var flights = r.assignments.map(rbFlightCell_).join('  •  ');
      rows.push([team, r.name, r.pos || '', r.shift || '', r.ot || '', r.assignments.length, flights]);
      meta.push({ type: 'data' });
    });
  });

  sh.getRange(1, 1, rows.length, 7).setValues(rows);
  sh.getRange(1, 1, 1, 7).setBackground('#1f4e79').setFontColor('#fff').setFontWeight('bold');
  sh.getRange(2, 1, 1, 7).merge().setBackground('#0d2137').setFontColor('#fff')
    .setFontWeight('bold').setFontSize(12).setHorizontalAlignment('center');
  for (var i = 0; i < meta.length; i++) {
    if (meta[i].type === 'team') {
      sh.getRange(i + 1, 1, 1, 7).merge().setBackground('#2e75b6').setFontColor('#fff').setFontWeight('bold');
    }
  }
  [90, 150, 70, 70, 40, 45, 600].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(2);
}

// ─── GOOGLE CHAT ────────────────────────────────────────────────────────────
function rbPostChat_(res, dateStr, url) {
  var webhook = PropertiesService.getScriptProperties().getProperty(CONFIG_RB.CHAT_WEBHOOK_PROP);
  if (!webhook) { Logger.log('⚠️ no webhook set in property %s', CONFIG_RB.CHAT_WEBHOOK_PROP); return; }
  var T = res.totals;
  var lines = [
    '📊 *Daily Manpower* — ' + dateStr,
    '👥 Total *' + T.staff + '*  |  🟢 Working *' + (T.working + T.ot_off) + '*  |  ⬛ Off *' + T.off + '*',
    '🤒 Sick *' + T.sick + '*  |  🌴 Leave *' + T.leave + '*  |  ⏰ OT *' + T.otPeople + ' ppl* (' + T.otHours + 'h)',
    '✈️ Flight assignments *' + T.flights + '*',
    '',
    '*Top teams (working):*',
  ];
  Object.keys(res.teams).sort(function (a, b) { return res.teams[b].working - res.teams[a].working; })
    .slice(0, 8).forEach(function (t) {
      var b = res.teams[t];
      lines.push('  • ' + t + ': ' + (b.working + b.ot_off) + '/' + b.staff + '  OT ' + b.otHours + 'h  ✈️' + b.flights);
    });
  if (url) lines.push('', '🔗 ' + url);
  UrlFetchApp.fetch(webhook, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ text: lines.join('\n') }), muteHttpExceptions: true,
  });
}

// ─── DRIVE NAVIGATION (find today's roster, convert xlsx if needed) ─────────
function rbOpenTodayRoster_(date) {
  var dd = ('0' + date.getDate()).slice(-2);
  var mon = MON_RB[date.getMonth()];
  var mm = ('0' + (date.getMonth() + 1)).slice(-2);
  var yr2 = String(date.getFullYear()).slice(2);

  var year = DriveApp.getFolderById(CONFIG_RB.ROOT_FOLDER_ID);
  var monthFolder = rbFindMonthFolder_(year, mm, mon, yr2, date.getFullYear()) || year;
  var file = rbFindDayFile_(monthFolder, dd, mon, yr2);
  if (!file) throw new Error('ไม่พบไฟล์ roster ของวันที่ ' + dd + ' ' + mon + ' ใน ' + monthFolder.getName());

  if (file.getMimeType() === MimeType.GOOGLE_SHEETS) {
    return { ss: SpreadsheetApp.openById(file.getId()), tempId: null, fileName: file.getName() };
  }
  var tmp = Drive.Files.copy({ title: '_TEMP_' + Date.now(), mimeType: MimeType.GOOGLE_SHEETS },
                             file.getId(), { convert: true });
  return { ss: SpreadsheetApp.openById(tmp.id), tempId: tmp.id, fileName: file.getName() };
}

function rbFindMonthFolder_(parent, mm, mon, yr2, year) {
  var pats = [
    new RegExp('^' + mm + '\\.?\\s*' + mon + yr2 + '$', 'i'),
    new RegExp('^' + mon + '\\s*' + yr2 + '$', 'i'),
    new RegExp('^' + mon + '\\s*' + year + '$', 'i'),
    new RegExp(mon, 'i'),
  ];
  var it = parent.getFolders();
  while (it.hasNext()) {
    var f = it.next(), nm = f.getName();
    for (var p = 0; p < pats.length; p++) if (pats[p].test(nm)) return f;
  }
  return null;
}

function rbFindDayFile_(folder, dd, mon, yr2) {
  var d = parseInt(dd, 10);
  var pats = [
    new RegExp('^' + dd + '\\s*' + mon + yr2 + '(\\.|$| )', 'i'),
    new RegExp('^' + dd + '\\s*' + mon + '(\\.|$| )', 'i'),
    new RegExp('^' + d + '\\s*' + mon + '(\\.|$| )', 'i'),
    new RegExp('^' + dd + '\\s*' + mon, 'i'),
    new RegExp('^' + d + '\\s*' + mon, 'i'),
  ];
  var best = null;
  ['application/vnd.google-apps.spreadsheet',
   'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].forEach(function (mime) {
    var it = folder.getFilesByType(mime);
    while (it.hasNext()) {
      var f = it.next(), nm = f.getName();
      for (var p = 0; p < pats.length; p++) {
        if (pats[p].test(nm) && (!best || p < best.p)) best = { f: f, p: p };
      }
    }
  });
  return best ? best.f : null;
}

function rbGetMonthlyOutput_(mon, be) {
  var name = mon + ' ' + be;
  var folder = DriveApp.getFolderById(CONFIG_RB.OUTPUT_FOLDER_ID);
  var it = folder.getFilesByName(name);
  if (it.hasNext()) return SpreadsheetApp.openById(it.next().getId());
  var ss = SpreadsheetApp.create(name);
  var file = DriveApp.getFileById(ss.getId());
  folder.addFile(file); DriveApp.getRootFolder().removeFile(file);
  return ss;
}
