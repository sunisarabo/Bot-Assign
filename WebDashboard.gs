/**
 * WebDashboard.gs — serve the manpower dashboard as a real web page (Web App).
 * =============================================================================
 * Branded to the AOTGA corporate CI (Royal Blue #1D428A, Sky Blue #4EC3E0,
 * Kanit font, "Driving Excellence" tagline).
 *
 * Deploy: Apps Script → Deploy → New deployment → Web app → Execute as Me,
 *         Access Anyone → Deploy → copy the /exec URL. Optional ?date=YYYY-MM-DD.
 * Requires RosterReader.gs / LLReader.gs / MasterReader.gs / RosterBot.gs.
 */

// Optional: host the official AOTGA logo (PNG, white bg ok) and put its direct
// image URL here to show the real logo instead of the CSS emblem. Leave '' to
// use the built-in emblem.
var AOTGA_LOGO_URL = '';

// AOTGA brand palette
var CI = {
  royal: '#1D428A', sky: '#4EC3E0', grey: '#7C878F', yellow: '#FEC909',
  teal: '#3FBCBE', red: '#D92526', bosch: '#236192',
  bg: '#eef3f9', card: '#ffffff', text: '#16243f', sub: '#5b6b86', line: '#dde6f1',
};

function doGet(e) {
  var p = (e && e.parameter) || {};
  var date = new Date();
  if (p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date)) {
    var a = p.date.split('-');
    date = new Date(+a[0], +a[1] - 1, +a[2]);
  }
  var tz = Session.getScriptTimeZone() || 'Asia/Bangkok';
  var iso = Utilities.formatDate(date, tz, 'yyyy-MM-dd');
  var base = '';
  try { base = ScriptApp.getService().getUrl() || ''; } catch (eb) {}
  var html;
  try {
    var roster = rbOpenTodayRoster_(date);
    var res = readRosterFromSpreadsheet(roster.ss);
    if (roster.tempId) { try { DriveApp.getFileById(roster.tempId).setTrashed(true); } catch (e2) {} }
    var ll = null, master = null;
    if (CONFIG_RB.LL_FILE_ID) { try { ll = readLLForDate(CONFIG_RB.LL_FILE_ID, date); } catch (e3) {} }
    if (MASTER_FILE_ID_RB) { try { master = readMasterHeadcount(MASTER_FILE_ID_RB); } catch (e4) {} }
    var dateStr = date.getDate() + ' ' + MON_RB[date.getMonth()] + ' ' + (date.getFullYear() + 543);
    html = rbBuildDashboardHtml_(res, ll, master, dateStr, iso, date, base, tz);
  } catch (err) {
    html = '<!doctype html><html><head><meta charset="utf-8">' +
      '<link href="https://fonts.googleapis.com/css2?family=Kanit:wght@400;600;800&display=swap" rel="stylesheet"></head>' +
      '<body style="font-family:Kanit,sans-serif;background:' + CI.bg + ';color:' + CI.text + ';padding:30px;text-align:center">' +
      rbWeekNavBar_(date, iso, base, tz) +
      '<h2 style="margin-top:30px">⚠️ ไม่มีข้อมูลของวันที่ ' + rbEsc_(iso) + '</h2>' +
      '<p style="color:' + CI.sub + '">' + rbEsc_(err.message) + '</p>' +
      '<p style="color:' + CI.sub + '">ยังไม่มีไฟล์ assignment ของวันนี้ หรือบัญชีไม่มีสิทธิ์ — เลือกวันอื่นจากแถบด้านบนได้</p></body></html>';
  }
  return HtmlService.createHtmlOutput(html)
    .setTitle('AOTGA · Roster Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function rbEsc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function rbOtTxt_(people, hrs) { return people > 0 ? (people + ' <span class="h">(' + hrs + 'h)</span>') : '·'; }

function rbKpiCards_(P, L) {
  var staff = P.staff + (L ? L.staff : 0);
  var work = (P.working + P.ot_off) + (L ? L.working + L.ot_off : 0);
  var off = P.off + (L ? L.off : 0);
  var otoff = P.ot_off + (L ? L.ot_off : 0);
  var otp = P.otPeople + (L ? L.otPeople : 0);
  var oth = Math.round((P.otHours + (L ? L.otHours : 0)) * 10) / 10;
  var defs = [
    ['👥', staff, 'Total Staff', CI.royal], ['🟢', work, 'Working', CI.teal],
    ['⬛', off, 'OFF', CI.grey], ['🟡', otoff, 'OT OFF (XX)', CI.yellow],
    ['⏰', otp, 'OT คน', CI.red], ['⏱️', oth, 'OT ชั่วโมง', CI.sky],
  ];
  return defs.map(function (d) {
    return '<div class="kpi" style="--c:' + d[3] + '"><div class="ico">' + d[0] +
      '</div><div class="val">' + d[1] + '</div><div class="lbl">' + d[2] + '</div></div>';
  }).join('');
}

function rbAggRowHtml_(label, b, fillClass) {
  var work = b.working + b.ot_off;
  var pct = b.staff > 0 ? Math.round(work / b.staff * 100) : 0;
  return '<tr><td class="tm">' + rbEsc_(label) + '</td><td>' + b.staff + '</td><td><b>' + work +
    '</b></td><td>' + (b.ot_off || '·') + '</td><td>' + rbOtTxt_(b.otPre, b.otPreHrs) + '</td><td>' + rbOtTxt_(b.otPost, b.otPostHrs) +
    '</td><td style="width:150px"><div class="bar"><div class="fill ' + (fillClass || '') +
    '" style="width:' + pct + '%"></div><span>' + pct + '%</span></div></td></tr>';
}
function rbTeamRows_(teams, order) { return order.map(function (t) { return rbAggRowHtml_(t, teams[t], ''); }).join(''); }
function rbPosRows_(positions, order) {
  return order.map(function (p) {
    var b = positions[p]; if (!b) return '';
    return '<tr><td class="tm">' + p + '</td><td>' + b.staff + '</td><td><b>' + b.working +
      '</b></td><td>' + b.ot_off + '</td><td>' + b.off + '</td><td>' + b.sick + '</td><td>' +
      b.leave + '</td><td>' + rbOtTxt_(b.otPre, b.otPreHrs) + '</td><td>' + rbOtTxt_(b.otPost, b.otPostHrs) + '</td></tr>';
  }).join('');
}

// ── Timetable (per-employee scheduling) ─────────────────────────────────────
function rbFlightChips_(assigns) {
  if (!assigns || !assigns.length) return '<span class="h">—</span>';
  return assigns.map(function (a) {
    var task = a.task ? (' <span class="tk">[' + rbEsc_(a.task) + ']</span>') : '';
    var sta = (a.STA || a.STD) ? (' <span class="t1">STA/STD ' + (a.STA || '–') + '/' + (a.STD || '–') + '</span>') : '';
    var op = (a.OP || a.CL) ? (' <span class="t2">OP-CL ' + (a.OP || '–') + '-' + (a.CL || '–') + '</span>') : '';
    return '<span class="flt">' + rbEsc_(a.flight) + task + sta + op + '</span>';
  }).join(' ');
}
function rbOtCellTT_(b) {
  if (!b.ot) return '<span class="h">—</span>';
  var lbl = b.otType === 'PRE' ? '<span class="pre">ก่อนกะ</span>' : '<span class="post">หลังกะ</span>';
  return lbl + ' ' + (b.otTime || '') + ' <span class="h">(' + b.ot + 'h)</span>';
}
function rbTimetableRows_(res, ll) {
  var rows = [];
  Object.keys(res.teams).forEach(function (t) {
    res.teams[t].records.forEach(function (r) {
      if (r.bucket === 'working' || r.bucket === 'ot_off') rows.push(r);
    });
  });
  if (ll && ll.totals.staff > 0) {
    Object.keys(ll.sections).forEach(function (s) {
      ll.sections[s].records.forEach(function (r) {
        if (r.bucket === 'working' || r.bucket === 'ot_off') rows.push(r);
      });
    });
  }
  rows.sort(function (a, b) {
    return String(a.team).localeCompare(String(b.team)) ||
      ((a.shiftStart == null ? 99999 : a.shiftStart) - (b.shiftStart == null ? 99999 : b.shiftStart));
  });
  return rows.map(function (r) {
    var st = r.shiftStart == null ? 99999 : r.shiftStart;
    var shiftCol = rbEsc_(r.shift || '') + (r.shiftTime && r.shiftTime !== r.shift ? ' <span class="h">' + r.shiftTime + '</span>' : '');
    return '<tr data-team="' + rbEsc_(r.team) + '" data-start="' + st + '" data-name="' + rbEsc_(r.name) + '">' +
      '<td class="tm">' + rbEsc_(r.team) + '</td><td>' + rbEsc_(r.name) + '</td><td>' + rbEsc_(r.pos || '') + '</td>' +
      '<td>' + shiftCol + '</td><td>' + rbOtCellTT_(r) + '</td><td>' + (r.assignments ? r.assignments.length : 0) + '</td>' +
      '<td class="fl">' + rbFlightChips_(r.assignments) + '</td></tr>';
  }).join('');
}

function rbLogo_() {
  if (AOTGA_LOGO_URL) return '<img src="' + AOTGA_LOGO_URL + '" alt="AOTGA" style="height:46px">';
  return '<span class="emblem"></span>';
}

var DOW_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
/** Date picker + week strip (-7..+7 days) that navigate to ?date=ISO. */
function rbWeekNavBar_(date, iso, base, tz) {
  var chips = [];
  for (var off = -7; off <= 7; off++) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate() + off);
    var i = Utilities.formatDate(d, tz || 'Asia/Bangkok', 'yyyy-MM-dd');
    var href = (base || '') + '?date=' + i;
    chips.push('<a class="wk' + (i === iso ? ' sel' : '') + '" href="' + href + '" target="_top">' +
      '<span class="wd">' + DOW_TH[d.getDay()] + '</span>' + d.getDate() +
      '<span class="wm">' + MON_RB[d.getMonth()] + '</span></a>');
  }
  return '<div class="navbar"><input type="date" id="dt" value="' + iso + '" onchange="go(this.value)">' +
    '<div class="wkstrip">' + chips.join('') + '</div></div>';
}

function rbBuildDashboardHtml_(res, ll, master, dateStr, iso, date, base, tz) {
  var P = res.totals, L = ll && ll.totals.staff > 0 ? ll.totals : null;
  var teamOrder = Object.keys(res.teams).sort(function (a, b) {
    return (res.teams[b].working + res.teams[b].ot_off) - (res.teams[a].working + res.teams[a].ot_off);
  });
  var masterLine = master ? ('<div class="hc">👥 พนักงานทั้งหมด (Active): PSA <b>' + master.PSA.total +
    '</b> + LL <b>' + master.LL.total + '</b> = <b>' + (master.PSA.total + master.LL.total) + '</b> คน</div>') : '';

  var cd = {
    tn: teamOrder, tw: teamOrder.map(function (t) { return res.teams[t].working + res.teams[t].ot_off; }),
    tt: teamOrder.map(function (t) { return res.teams[t].staff; }),
    work: P.working + P.ot_off + (L ? L.working + L.ot_off : 0),
    off: P.off + (L ? L.off : 0), sick: P.sick + (L ? L.sick : 0), leave: P.leave + (L ? L.leave : 0),
    otPreH: Math.round((P.otPreHrs + (L ? L.otPreHrs : 0)) * 10) / 10,
    otPostH: Math.round((P.otPostHrs + (L ? L.otPostHrs : 0)) * 10) / 10,
    c: CI,
  };

  var posHead = '<tr><th>ตำแหน่ง</th><th>Total</th><th>Work</th><th>OT-Off</th><th>Off</th><th>Sick</th><th>Leave</th><th>OT ก่อน</th><th>OT หลัง</th></tr>';
  var llBlock = '';
  if (L) {
    var llSecRows = Object.keys(ll.sections).map(function (s) { return rbAggRowHtml_(s, ll.sections[s], 'llf'); }).join('');
    llBlock =
      '<div class="card"><h2>🟡 LL by Section</h2><table><thead>' +
      '<tr><th>ส่วนงาน</th><th>Total</th><th>Working</th><th>OT-Off</th><th>OT ก่อนกะ</th><th>OT หลังกะ</th><th>%Working</th></tr>' +
      '</thead><tbody>' + llSecRows + '</tbody></table></div>' +
      '<div class="card"><h2>🟡 LL by Position</h2><table><thead>' + posHead + '</thead><tbody>' +
      rbPosRows_(ll.positions, ['PSS', 'SNR', 'PSA', 'Porter', 'Admin', 'Trainee']) + '</tbody></table></div>';
  }

  return '' +
    '<!doctype html><html lang="th"><head><meta charset="utf-8">' +
    '<link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;600;800&display=swap" rel="stylesheet">' +
    '<style>' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    "body{font-family:'Kanit',-apple-system,'Segoe UI',sans-serif;background:" + CI.bg + ";color:" + CI.text + ";padding:22px}" +
    '.head{background:linear-gradient(120deg,' + CI.royal + ',' + CI.bosch + ');border-radius:16px;padding:18px 26px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px;box-shadow:0 8px 24px rgba(29,66,138,.25)}' +
    '.brand{display:flex;align-items:center;gap:14px}' +
    '.emblem{width:46px;height:46px;border-radius:50%;border:2px solid #fff;background:repeating-linear-gradient(' + CI.sky + ' 0 3px,#fff 3px 6px);position:relative;overflow:hidden;flex:0 0 auto}' +
    '.emblem::after{content:"";position:absolute;left:0;right:0;bottom:0;height:46%;background:' + CI.sky + '}' +
    '.brand h1{font-size:22px;font-weight:800;color:#fff;letter-spacing:.5px;line-height:1}' +
    '.brand p{color:#cfe6f6;font-size:12px;margin-top:3px}' +
    '.ctrl{display:flex;gap:8px;align-items:center}' +
    '.ctrl input{font-family:inherit;background:#fff;border:1px solid ' + CI.line + ';color:' + CI.text + ';border-radius:8px;padding:8px 10px;font-size:13px}' +
    '.ctrl button{font-family:inherit;background:' + CI.sky + ';border:0;color:' + CI.royal + ';border-radius:8px;padding:9px 14px;font-size:13px;font-weight:600;cursor:pointer}' +
    '.ctrl button.pdf{background:' + CI.yellow + ';color:#5a4a00}' +
    '.hc{margin:0 0 14px;background:#fff;border:1px solid ' + CI.line + ';border-left:4px solid ' + CI.royal + ';border-radius:10px;padding:10px 16px;color:' + CI.text + ';font-size:13px}' +
    '.otbar{margin:0 0 16px;background:#fff8e1;border:1px solid ' + CI.yellow + ';border-radius:10px;padding:10px 16px;color:#7a5b00;font-size:13px;font-weight:600;text-align:center}' +
    '.h{color:' + CI.sub + ';font-weight:300;font-size:11px}' +
    '.kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:14px;margin-bottom:16px}' +
    '.kpi{background:#fff;border:1px solid ' + CI.line + ';border-top:4px solid var(--c);border-radius:14px;padding:16px;text-align:center;box-shadow:0 3px 10px rgba(22,36,63,.06)}' +
    '.kpi .ico{font-size:20px}.kpi .val{font-size:32px;font-weight:800;color:var(--c);margin:2px 0}.kpi .lbl{font-size:12px;color:' + CI.sub + ';font-weight:600}' +
    '.grid{display:grid;grid-template-columns:1.3fr 1fr;gap:18px}.grid2{display:grid;grid-template-columns:1.4fr 1fr;gap:18px;margin-bottom:18px}' +
    '@media(max-width:900px){.kpis{grid-template-columns:repeat(3,1fr)}.grid,.grid2{grid-template-columns:1fr}}' +
    '.card{background:#fff;border:1px solid ' + CI.line + ';border-radius:14px;padding:18px 20px;margin-bottom:18px;box-shadow:0 3px 10px rgba(22,36,63,.05)}' +
    '.card h2{font-size:15px;font-weight:600;margin-bottom:12px;color:' + CI.royal + '}' +
    'table{width:100%;border-collapse:collapse;font-size:13px}' +
    'th{text-align:right;color:#fff;background:' + CI.royal + ';font-weight:600;padding:8px;font-size:11px}' +
    'th:first-child{text-align:left;border-radius:6px 0 0 6px}th:last-child{border-radius:0 6px 6px 0}' +
    'td{text-align:right;padding:7px 8px;border-bottom:1px solid #eef2f8}td:first-child{text-align:left}td.tm{font-weight:600;color:' + CI.text + '}' +
    'tbody tr:nth-child(even){background:#f6f9fd}tbody tr:hover td{background:#eaf4fb}' +
    '.bar{position:relative;height:18px;background:#e6edf6;border-radius:9px;overflow:hidden}' +
    '.bar .fill{height:100%;background:linear-gradient(90deg,' + CI.teal + ',' + CI.sky + ')}.bar .fill.llf{background:linear-gradient(90deg,#e0a500,' + CI.yellow + ')}' +
    '.bar span{position:absolute;right:8px;top:0;font-size:11px;line-height:18px;color:' + CI.royal + ';font-weight:700}' +
    '.tthead{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px}' +
    '.ttbar{display:flex;gap:8px;flex-wrap:wrap}' +
    '.ttbar input{font-family:inherit;border:1px solid ' + CI.line + ';border-radius:8px;padding:7px 10px;font-size:13px}' +
    '.ttbar button{font-family:inherit;background:' + CI.royal + ';color:#fff;border:0;border-radius:8px;padding:8px 12px;cursor:pointer;font-size:12px;font-weight:600}' +
    '.ttwrap{overflow-x:auto}table.tt{font-size:12px}table.tt th{cursor:pointer;white-space:nowrap}table.tt td{vertical-align:top}' +
    'td.fl{text-align:left;line-height:1.9}' +
    '.flt{display:inline-block;background:#f0f5fb;border:1px solid #e1eaf5;border-radius:6px;padding:1px 7px;margin:1px 2px;white-space:nowrap}' +
    '.tk{color:' + CI.royal + ';font-weight:600}.t1{color:#1b8a5a}.t2{color:#b06a00}' +
    '.pre{color:#b06a00;font-weight:700}.post{color:' + CI.royal + ';font-weight:700}' +
    '.navbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px}' +
    '.navbar input{font-family:inherit;background:#fff;border:1px solid ' + CI.line + ';border-radius:8px;padding:8px 10px;font-size:13px}' +
    '.wkstrip{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;flex:1}' +
    '.wk{flex:0 0 auto;text-decoration:none;color:' + CI.text + ';background:#fff;border:1px solid ' + CI.line + ';border-radius:10px;padding:5px 9px;text-align:center;font-size:13px;font-weight:600;line-height:1.15}' +
    '.wk .wd,.wk .wm{display:block;font-size:9px;color:' + CI.sub + ';font-weight:400}' +
    '.wk.sel{background:' + CI.royal + ';color:#fff;border-color:' + CI.royal + '}.wk.sel .wd,.wk.sel .wm{color:#cfe6f6}' +
    '.tabs{display:flex;gap:8px;margin-bottom:16px}' +
    '.tab{font-family:inherit;cursor:pointer;background:#fff;border:1px solid ' + CI.line + ';color:' + CI.royal + ';border-radius:10px;padding:9px 18px;font-weight:600;font-size:14px}' +
    '.tab.active{background:' + CI.royal + ';color:#fff;border-color:' + CI.royal + '}' +
    '.foot{margin-top:14px;text-align:center;color:' + CI.sub + ';font-size:11px}' +
    '@media print{body{background:#fff;padding:0}.ctrl,.navbar,.tabs,.ttbar{display:none}.card,.kpi{box-shadow:none}#view-tt,#view-dash{display:block!important}}' +
    '</style></head><body>' +
    '<div class="head"><div class="brand">' + rbLogo_() +
    '<div><h1>AOTGA</h1><p>Daily Manpower Dashboard · ' + rbEsc_(dateStr) + ' · “Driving Excellence”</p></div></div>' +
    '<div class="ctrl"><button class="pdf" onclick="window.print()">⬇️ Export PDF</button></div></div>' +
    rbWeekNavBar_(date, iso, base, tz) +
    '<div class="tabs"><button class="tab active" id="tab-dash" onclick="showView(\'dash\')">📊 Dashboard</button>' +
    '<button class="tab" id="tab-tt" onclick="showView(\'tt\')">🕓 Timetable</button></div>' +
    '<div id="view-dash">' +
    '<div class="kpis">' + rbKpiCards_(P, L) + '</div>' +
    '<div class="otbar">⏱️ OT ก่อนกะ: <b>' + (P.otPre + (L ? L.otPre : 0)) + '</b> คน (' + cd.otPreH +
      'h) &nbsp;&nbsp;|&nbsp;&nbsp; OT หลังกะ: <b>' + (P.otPost + (L ? L.otPost : 0)) + '</b> คน (' + cd.otPostH + 'h)</div>' +
    masterLine +
    '<div class="grid2">' +
    '<div class="card"><h2>📊 Working / Total ต่อทีม</h2><canvas id="c1" height="150"></canvas></div>' +
    '<div class="card"><h2>🧭 ภาพรวมสถานะ</h2><canvas id="c2" height="150"></canvas></div></div>' +
    '<div class="grid">' +
    '<div class="card"><h2>📌 Manpower by Team (PSA)</h2><table><thead>' +
    '<tr><th>ทีม</th><th>Total</th><th>Working</th><th>OT-Off</th><th>OT ก่อนกะ</th><th>OT หลังกะ</th><th>%Working</th></tr>' +
    '</thead><tbody>' + rbTeamRows_(res.teams, teamOrder) + '</tbody></table></div>' +
    '<div class="card"><h2>👥 PSA by Position</h2><table><thead>' + posHead + '</thead><tbody>' +
    rbPosRows_(res.positions, ['PSS', 'SNR', 'PSA', 'Globlex', 'AdminD', 'Porter', 'Crewsign']) +
    '</tbody></table>' + llBlock + '</div></div></div>' +
    '<div id="view-tt" style="display:none">' +
    '<div class="card"><div class="tthead"><h2>🕓 Timetable · ตารางงานรายคน (เวลาเข้า-ออกกะ · OT ก่อน/หลัง · STA/STD เที่ยวบิน)</h2>' +
    '<div class="ttbar"><input id="ttq" placeholder="🔎 ค้นหา ชื่อ/ทีม/เที่ยวบิน" oninput="filterTT()">' +
    '<button onclick="sortTT(\'team\')">↕ เรียงตามทีม</button>' +
    '<button onclick="sortTT(\'start\')">↕ เรียงตามเวลาเข้ากะ</button></div></div>' +
    '<div class="ttwrap"><table class="tt"><thead><tr>' +
    '<th onclick="sortTT(\'team\')">ทีม</th><th>ชื่อ</th><th>ตำแหน่ง</th><th onclick="sortTT(\'start\')">กะ (เข้า-ออก)</th>' +
    '<th>OT (ก่อน/หลังกะ)</th><th>#</th><th>เที่ยวบิน · task · STA/STD · OP-CL</th>' +
    '</tr></thead><tbody id="ttbody">' + rbTimetableRows_(res, ll) + '</tbody></table></div></div></div>' +
    '<div class="foot">บริษัท บริการภาคพื้น ท่าอากาศยานไทย จำกัด (AOTGA) · live จาก Apps Script</div>' +
    '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>' +
    '<script>var CD=' + JSON.stringify(cd) + ';var BASE=' + JSON.stringify(base || '') + ';' +
    'function go(d){d=d||document.getElementById("dt").value;if(!d)return;var a=document.createElement("a");a.href=BASE+"?date="+d;a.target="_top";a.rel="noopener";document.body.appendChild(a);a.click();}' +
    'function showView(v){document.getElementById("view-dash").style.display=v==="dash"?"":"none";' +
    'document.getElementById("view-tt").style.display=v==="tt"?"":"none";' +
    'document.getElementById("tab-dash").className="tab"+(v==="dash"?" active":"");' +
    'document.getElementById("tab-tt").className="tab"+(v==="tt"?" active":"");}' +
    'function sortTT(k){var tb=document.getElementById("ttbody");var rs=[].slice.call(tb.children);' +
    'rs.sort(function(a,b){if(k==="start"){return (+a.dataset.start-+b.dataset.start)||a.dataset.team.localeCompare(b.dataset.team);}' +
    'return a.dataset.team.localeCompare(b.dataset.team)||(+a.dataset.start-+b.dataset.start);});' +
    'rs.forEach(function(r){tb.appendChild(r);});}' +
    'function filterTT(){var q=document.getElementById("ttq").value.toLowerCase();' +
    '[].forEach.call(document.getElementById("ttbody").children,function(r){r.style.display=r.textContent.toLowerCase().indexOf(q)>=0?"":"none";});}' +
    'window.addEventListener("load",function(){if(!window.Chart)return;' +
    'Chart.defaults.color="' + CI.sub + '";Chart.defaults.font.family="Kanit,sans-serif";' +
    'new Chart(document.getElementById("c1"),{type:"bar",data:{labels:CD.tn,datasets:[' +
    '{label:"Working",data:CD.tw,backgroundColor:CD.c.teal,borderRadius:4},' +
    '{label:"Total",data:CD.tt,backgroundColor:"#c9d6e8",borderRadius:4}]},' +
    'options:{responsive:true,plugins:{legend:{labels:{boxWidth:12}}},scales:{x:{grid:{display:false}},y:{grid:{color:"#eef2f8"},beginAtZero:true}}}});' +
    'new Chart(document.getElementById("c2"),{type:"doughnut",data:{labels:["Working","OFF","Sick","Leave"],' +
    'datasets:[{data:[CD.work,CD.off,CD.sick,CD.leave],backgroundColor:[CD.c.teal,CD.c.grey,CD.c.red,CD.c.yellow],borderColor:"#fff",borderWidth:2}]},' +
    'options:{responsive:true,plugins:{legend:{position:"bottom",labels:{boxWidth:12}}}}});});' +
    '</script></body></html>';
}
