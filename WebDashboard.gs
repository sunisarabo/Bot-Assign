/**
 * WebDashboard.gs — serve the manpower dashboard as a real web page (Web App).
 * =============================================================================
 * Deploy:  Apps Script → Deploy → New deployment → type "Web app" →
 *          Execute as "Me", Access "Anyone with the link" (or your org) → Deploy.
 * Open the Web-app URL → live HTML dashboard. Optional date: ?date=2026-06-06
 *
 * Requires RosterReader.gs / LLReader.gs / MasterReader.gs / RosterBot.gs
 * (uses rbOpenTodayRoster_, readRosterFromSpreadsheet, readLLForDate,
 *  readMasterHeadcount, MON_RB, CONFIG_RB).
 */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var date = new Date();
  if (p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date)) {
    var a = p.date.split('-');
    date = new Date(+a[0], +a[1] - 1, +a[2]);
  }
  var html;
  try {
    var roster = rbOpenTodayRoster_(date);
    var res = readRosterFromSpreadsheet(roster.ss);
    if (roster.tempId) { try { DriveApp.getFileById(roster.tempId).setTrashed(true); } catch (e2) {} }
    var ll = null, master = null;
    try { ll = readLLForDate(CONFIG_RB.LL_FILE_ID, date); } catch (e3) {}
    try { master = readMasterHeadcount(MASTER_FILE_ID_RB); } catch (e4) {}
    var dateStr = date.getDate() + ' ' + MON_RB[date.getMonth()] + ' ' + (date.getFullYear() + 543);
    html = rbBuildDashboardHtml_(res, ll, master, dateStr);
  } catch (err) {
    html = '<body style="font-family:sans-serif;background:#0f1626;color:#e9eef5;padding:40px">' +
           '<h2>⚠️ โหลด dashboard ไม่ได้</h2><p>' + err.message + '</p>' +
           '<p>ตรวจว่ามีไฟล์ assignment ของวันนี้ในโฟลเดอร์ และตั้งค่า CONFIG_RB แล้ว</p></body>';
  }
  return HtmlService.createHtmlOutput(html)
    .setTitle('Roster Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function rbEsc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function rbKpiCards_(P, L) {
  var staff = P.staff + (L ? L.staff : 0);
  var work = (P.working + P.ot_off) + (L ? L.working + L.ot_off : 0);
  var off = P.off + (L ? L.off : 0);
  var otoff = P.ot_off + (L ? L.ot_off : 0);
  var otp = P.otPeople + (L ? L.otPeople : 0);
  var oth = Math.round((P.otHours + (L ? L.otHours : 0)) * 10) / 10;
  var defs = [
    ['👥', staff, 'Total Staff', '#4f6df5'],
    ['🟢', work, 'Working', '#19a974'],
    ['⬛', off, 'OFF', '#7b8794'],
    ['🟡', otoff, 'OT OFF (XX)', '#f5a623'],
    ['⏰', otp, 'OT คน', '#e8590c'],
    ['⏱️', oth, 'OT ชั่วโมง', '#c0392b'],
  ];
  return defs.map(function (d) {
    return '<div class="kpi" style="--c:' + d[3] + '"><div class="ico">' + d[0] +
      '</div><div class="val">' + d[1] + '</div><div class="lbl">' + d[2] + '</div></div>';
  }).join('');
}

function rbTeamRows_(teams) {
  return Object.keys(teams).sort(function (a, b) {
    return (teams[b].working + teams[b].ot_off) - (teams[a].working + teams[a].ot_off);
  }).map(function (t) {
    var b = teams[t], work = b.working + b.ot_off;
    var pct = b.staff > 0 ? Math.round(work / b.staff * 100) : 0;
    return '<tr><td class="tm">' + rbEsc_(t) + '</td><td>' + b.staff + '</td><td><b>' + work +
      '</b></td><td>' + b.otPeople + '</td><td>' + b.otHours +
      '</td><td style="width:150px"><div class="bar"><div class="fill" style="width:' + pct +
      '%"></div><span>' + pct + '%</span></div></td></tr>';
  }).join('');
}

function rbPosRows_(positions, order) {
  return order.map(function (p) {
    var b = positions[p]; if (!b) return '';
    return '<tr><td class="tm">' + p + '</td><td>' + b.staff + '</td><td><b>' + b.working +
      '</b></td><td>' + b.ot_off + '</td><td>' + b.off + '</td><td>' + b.sick + '</td><td>' +
      b.leave + '</td><td>' + b.otPeople + '</td></tr>';
  }).join('');
}

function rbBuildDashboardHtml_(res, ll, master, dateStr) {
  var P = res.totals, L = ll && ll.totals.staff > 0 ? ll.totals : null;
  var masterLine = '';
  if (master) {
    masterLine = '<div class="hc">👥 พนักงานทั้งหมด (Active): PSA <b>' + master.PSA.total +
      '</b> + LL <b>' + master.LL.total + '</b> = <b>' + (master.PSA.total + master.LL.total) + '</b> คน</div>';
  }
  var posHead = '<tr><th>ตำแหน่ง</th><th>Total</th><th>Work</th><th>OT-Off</th><th>Off</th><th>Sick</th><th>Leave</th><th>OT คน</th></tr>';
  var llBlock = '';
  if (L) {
    var llSecRows = Object.keys(ll.sections).map(function (s) {
      var b = ll.sections[s], work = b.working + b.ot_off;
      var pct = b.staff > 0 ? Math.round(work / b.staff * 100) : 0;
      return '<tr><td class="tm">' + rbEsc_(s) + '</td><td>' + b.staff + '</td><td><b>' + work +
        '</b></td><td>' + b.otPeople + '</td><td>' + b.otHours +
        '</td><td style="width:150px"><div class="bar"><div class="fill llf" style="width:' + pct +
        '%"></div><span>' + pct + '%</span></div></td></tr>';
    }).join('');
    llBlock =
      '<div class="card"><h2>🟡 LL by Section</h2><table><thead>' +
      '<tr><th>ส่วนงาน</th><th>Total</th><th>Working</th><th>OT คน</th><th>OT ชม.</th><th>%Working</th></tr>' +
      '</thead><tbody>' + llSecRows + '</tbody></table></div>' +
      '<div class="card"><h2>🟡 LL by Position</h2><table><thead>' + posHead + '</thead><tbody>' +
      rbPosRows_(ll.positions, ['PSS', 'SNR', 'PSA', 'Porter', 'Admin', 'Trainee']) + '</tbody></table></div>';
  }

  return '' +
    '<!doctype html><html lang="th"><head><meta charset="utf-8"><style>' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    "body{font-family:-apple-system,'Segoe UI',Roboto,'Noto Sans Thai',sans-serif;background:#0f1626;color:#e9eef5;padding:22px}" +
    '.head{background:linear-gradient(135deg,#13315c,#0b2545);border-radius:16px;padding:22px 26px;margin-bottom:18px;box-shadow:0 8px 30px rgba(0,0,0,.35)}' +
    '.head h1{font-size:22px;font-weight:800}.head p{color:#9fb3d1;margin-top:4px;font-size:13px}' +
    '.hc{margin:0 0 18px;background:#1b2640;border:1px solid #2a3a5e;border-radius:10px;padding:10px 16px;color:#cfe0f5;font-size:13px}' +
    '.kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:14px;margin-bottom:22px}' +
    '.kpi{background:#172036;border:1px solid #243049;border-top:4px solid var(--c);border-radius:14px;padding:16px;text-align:center}' +
    '.kpi .ico{font-size:22px}.kpi .val{font-size:32px;font-weight:800;color:var(--c);margin:4px 0}.kpi .lbl{font-size:12px;color:#9fb3d1;font-weight:600}' +
    '.grid{display:grid;grid-template-columns:1.3fr 1fr;gap:18px}' +
    '@media(max-width:900px){.kpis{grid-template-columns:repeat(3,1fr)}.grid{grid-template-columns:1fr}}' +
    '.card{background:#141c2f;border:1px solid #243049;border-radius:14px;padding:18px 20px;margin-bottom:18px}' +
    '.card h2{font-size:15px;font-weight:700;margin-bottom:12px;color:#cde}' +
    'table{width:100%;border-collapse:collapse;font-size:13px}' +
    'th{text-align:right;color:#8aa0c2;font-weight:600;padding:7px 8px;border-bottom:2px solid #243049;font-size:11px;text-transform:uppercase}' +
    'th:first-child,td:first-child{text-align:left}' +
    'td{text-align:right;padding:7px 8px;border-bottom:1px solid #1d2742}td.tm{font-weight:600;color:#dbe7f5}' +
    'tr:hover td{background:#19233a}' +
    '.bar{position:relative;height:18px;background:#22304d;border-radius:9px;overflow:hidden}' +
    '.bar .fill{height:100%;background:linear-gradient(90deg,#19a974,#3fbf7f)}.bar .fill.llf{background:linear-gradient(90deg,#bf8f00,#f5c542)}' +
    '.bar span{position:absolute;right:8px;top:0;font-size:11px;line-height:18px;color:#fff;font-weight:700}' +
    '.foot{margin-top:14px;text-align:center;color:#5f7290;font-size:11px}' +
    '</style></head><body>' +
    '<div class="head"><h1>📊 Daily Manpower Dashboard</h1><p>' + rbEsc_(dateStr) +
    ' &nbsp;·&nbsp; อ่านจากไฟล์ assignment จริง</p></div>' +
    '<div class="kpis">' + rbKpiCards_(P, L) + '</div>' +
    masterLine +
    '<div class="grid">' +
    '<div class="card"><h2>📌 Manpower by Team (PSA)</h2><table><thead>' +
    '<tr><th>ทีม</th><th>Total</th><th>Working</th><th>OT คน</th><th>OT ชม.</th><th>%Working</th></tr>' +
    '</thead><tbody>' + rbTeamRows_(res.teams) + '</tbody></table></div>' +
    '<div class="card"><h2>👥 PSA by Position</h2><table><thead>' + posHead + '</thead><tbody>' +
    rbPosRows_(res.positions, ['PSS', 'SNR', 'PSA', 'Globlex', 'AdminD', 'Porter', 'Crewsign']) +
    '</tbody></table>' + llBlock + '</div>' +
    '</div>' +
    '<div class="foot">SmartShift Roster · live จาก Apps Script</div>' +
    '</body></html>';
}
