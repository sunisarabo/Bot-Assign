/**
 * WebDashboard.gs — serve the manpower dashboard as a real web page (Web App).
 * =============================================================================
 * Deploy:  Apps Script → Deploy → New deployment → type "Web app" →
 *          Execute as "Me", Access "Anyone with the link" (or your org) → Deploy.
 * Open the Web-app URL → live HTML dashboard. Optional date: ?date=2026-06-06
 *
 * Features: KPI cards, OT ก่อน/หลังกะ, charts (Chart.js), date picker, Export PDF.
 * Requires RosterReader.gs / LLReader.gs / MasterReader.gs / RosterBot.gs.
 */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var date = new Date();
  if (p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date)) {
    var a = p.date.split('-');
    date = new Date(+a[0], +a[1] - 1, +a[2]);
  }
  var iso = Utilities.formatDate(date, Session.getScriptTimeZone() || 'Asia/Bangkok', 'yyyy-MM-dd');
  var html;
  try {
    var roster = rbOpenTodayRoster_(date);
    var res = readRosterFromSpreadsheet(roster.ss);
    if (roster.tempId) { try { DriveApp.getFileById(roster.tempId).setTrashed(true); } catch (e2) {} }
    var ll = null, master = null;
    try { ll = readLLForDate(CONFIG_RB.LL_FILE_ID, date); } catch (e3) {}
    try { master = readMasterHeadcount(MASTER_FILE_ID_RB); } catch (e4) {}
    var dateStr = date.getDate() + ' ' + MON_RB[date.getMonth()] + ' ' + (date.getFullYear() + 543);
    html = rbBuildDashboardHtml_(res, ll, master, dateStr, iso);
  } catch (err) {
    html = '<body style="font-family:sans-serif;background:#0f1626;color:#e9eef5;padding:40px">' +
           '<h2>⚠️ โหลด dashboard ไม่ได้</h2><p>' + rbEsc_(err.message) + '</p>' +
           '<p>ตรวจว่ามีไฟล์ assignment ของวันที่ ' + iso + ' ในโฟลเดอร์ และตั้งค่า CONFIG_RB แล้ว</p></body>';
  }
  return HtmlService.createHtmlOutput(html)
    .setTitle('Roster Dashboard')
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
    ['👥', staff, 'Total Staff', '#4f6df5'], ['🟢', work, 'Working', '#19a974'],
    ['⬛', off, 'OFF', '#7b8794'], ['🟡', otoff, 'OT OFF (XX)', '#f5a623'],
    ['⏰', otp, 'OT คน', '#e8590c'], ['⏱️', oth, 'OT ชั่วโมง', '#c0392b'],
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
    '</b></td><td>' + rbOtTxt_(b.otPre, b.otPreHrs) + '</td><td>' + rbOtTxt_(b.otPost, b.otPostHrs) +
    '</td><td style="width:150px"><div class="bar"><div class="fill ' + (fillClass || '') +
    '" style="width:' + pct + '%"></div><span>' + pct + '%</span></div></td></tr>';
}
function rbTeamRows_(teams, order) {
  return order.map(function (t) { return rbAggRowHtml_(t, teams[t], ''); }).join('');
}
function rbPosRows_(positions, order) {
  return order.map(function (p) {
    var b = positions[p]; if (!b) return '';
    return '<tr><td class="tm">' + p + '</td><td>' + b.staff + '</td><td><b>' + b.working +
      '</b></td><td>' + b.ot_off + '</td><td>' + b.off + '</td><td>' + b.sick + '</td><td>' +
      b.leave + '</td><td>' + rbOtTxt_(b.otPre, b.otPreHrs) + '</td><td>' + rbOtTxt_(b.otPost, b.otPostHrs) + '</td></tr>';
  }).join('');
}

function rbBuildDashboardHtml_(res, ll, master, dateStr, iso) {
  var P = res.totals, L = ll && ll.totals.staff > 0 ? ll.totals : null;
  var teamOrder = Object.keys(res.teams).sort(function (a, b) {
    return (res.teams[b].working + res.teams[b].ot_off) - (res.teams[a].working + res.teams[a].ot_off);
  });

  // master headcount line
  var masterLine = '';
  if (master) {
    masterLine = '<div class="hc">👥 พนักงานทั้งหมด (Active): PSA <b>' + master.PSA.total +
      '</b> + LL <b>' + master.LL.total + '</b> = <b>' + (master.PSA.total + master.LL.total) + '</b> คน</div>';
  }

  // chart data
  var cd = {
    tn: teamOrder, tw: teamOrder.map(function (t) { return res.teams[t].working + res.teams[t].ot_off; }),
    tt: teamOrder.map(function (t) { return res.teams[t].staff; }),
    work: P.working + P.ot_off + (L ? L.working + L.ot_off : 0),
    off: P.off + (L ? L.off : 0), sick: P.sick + (L ? L.sick : 0), leave: P.leave + (L ? L.leave : 0),
    otPreH: Math.round((P.otPreHrs + (L ? L.otPreHrs : 0)) * 10) / 10,
    otPostH: Math.round((P.otPostHrs + (L ? L.otPostHrs : 0)) * 10) / 10,
  };

  var posHead = '<tr><th>ตำแหน่ง</th><th>Total</th><th>Work</th><th>OT-Off</th><th>Off</th><th>Sick</th><th>Leave</th><th>OT ก่อน</th><th>OT หลัง</th></tr>';
  var llBlock = '';
  if (L) {
    var llSecRows = Object.keys(ll.sections).map(function (s) { return rbAggRowHtml_(s, ll.sections[s], 'llf'); }).join('');
    llBlock =
      '<div class="card"><h2>🟡 LL by Section</h2><table><thead>' +
      '<tr><th>ส่วนงาน</th><th>Total</th><th>Working</th><th>OT ก่อนกะ</th><th>OT หลังกะ</th><th>%Working</th></tr>' +
      '</thead><tbody>' + llSecRows + '</tbody></table></div>' +
      '<div class="card"><h2>🟡 LL by Position</h2><table><thead>' + posHead + '</thead><tbody>' +
      rbPosRows_(ll.positions, ['PSS', 'SNR', 'PSA', 'Porter', 'Admin', 'Trainee']) + '</tbody></table></div>';
  }

  return '' +
    '<!doctype html><html lang="th"><head><meta charset="utf-8"><style>' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    "body{font-family:-apple-system,'Segoe UI',Roboto,'Noto Sans Thai',sans-serif;background:#0f1626;color:#e9eef5;padding:22px}" +
    '.head{background:linear-gradient(135deg,#13315c,#0b2545);border-radius:16px;padding:20px 26px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}' +
    '.head h1{font-size:22px;font-weight:800}.head p{color:#9fb3d1;margin-top:4px;font-size:13px}' +
    '.ctrl{display:flex;gap:8px;align-items:center}' +
    '.ctrl input{background:#0b1322;border:1px solid #2a3a5e;color:#e9eef5;border-radius:8px;padding:8px 10px;font-size:13px}' +
    '.ctrl button{background:#2e75b6;border:0;color:#fff;border-radius:8px;padding:9px 14px;font-size:13px;font-weight:700;cursor:pointer}' +
    '.ctrl button.pdf{background:#c0392b}' +
    '.hc{margin:0 0 16px;background:#1b2640;border:1px solid #2a3a5e;border-radius:10px;padding:10px 16px;color:#cfe0f5;font-size:13px}' +
    '.otbar{margin:0 0 16px;background:#241c33;border:1px solid #4a3a66;border-radius:10px;padding:10px 16px;color:#f5c542;font-size:13px;font-weight:600;text-align:center}' +
    '.h{color:#8aa0c2;font-weight:400;font-size:11px}' +
    '.kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:14px;margin-bottom:16px}' +
    '.kpi{background:#172036;border:1px solid #243049;border-top:4px solid var(--c);border-radius:14px;padding:16px;text-align:center}' +
    '.kpi .ico{font-size:22px}.kpi .val{font-size:32px;font-weight:800;color:var(--c);margin:4px 0}.kpi .lbl{font-size:12px;color:#9fb3d1;font-weight:600}' +
    '.grid{display:grid;grid-template-columns:1.3fr 1fr;gap:18px}.grid2{display:grid;grid-template-columns:1.4fr 1fr;gap:18px;margin-bottom:18px}' +
    '@media(max-width:900px){.kpis{grid-template-columns:repeat(3,1fr)}.grid,.grid2{grid-template-columns:1fr}}' +
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
    '@media print{body{background:#fff;color:#000;padding:0}.ctrl{display:none}.card,.kpi,.hc,.otbar,.head{background:#fff;border-color:#ccc;color:#000;box-shadow:none}.head h1,.kpi .val{color:#000}td.tm{color:#000}}' +
    '</style></head><body>' +
    '<div class="head"><div><h1>📊 Daily Manpower Dashboard</h1><p>' + rbEsc_(dateStr) +
    ' &nbsp;·&nbsp; อ่านจากไฟล์ assignment จริง</p></div>' +
    '<div class="ctrl"><input type="date" id="dt" value="' + iso + '">' +
    '<button onclick="go()">ดูข้อมูล</button><button class="pdf" onclick="window.print()">⬇️ Export PDF</button></div></div>' +
    '<div class="kpis">' + rbKpiCards_(P, L) + '</div>' +
    '<div class="otbar">⏱️ OT ก่อนกะ: <b>' + (P.otPre + (L ? L.otPre : 0)) + '</b> คน (' + cd.otPreH +
      'h) &nbsp;&nbsp;|&nbsp;&nbsp; OT หลังกะ: <b>' + (P.otPost + (L ? L.otPost : 0)) + '</b> คน (' + cd.otPostH + 'h)</div>' +
    masterLine +
    '<div class="grid2">' +
    '<div class="card"><h2>📊 Working / Total ต่อทีม</h2><canvas id="c1" height="150"></canvas></div>' +
    '<div class="card"><h2>🧭 ภาพรวมสถานะ</h2><canvas id="c2" height="150"></canvas></div>' +
    '</div>' +
    '<div class="grid">' +
    '<div class="card"><h2>📌 Manpower by Team (PSA)</h2><table><thead>' +
    '<tr><th>ทีม</th><th>Total</th><th>Working</th><th>OT ก่อนกะ</th><th>OT หลังกะ</th><th>%Working</th></tr>' +
    '</thead><tbody>' + rbTeamRows_(res.teams, teamOrder) + '</tbody></table></div>' +
    '<div class="card"><h2>👥 PSA by Position</h2><table><thead>' + posHead + '</thead><tbody>' +
    rbPosRows_(res.positions, ['PSS', 'SNR', 'PSA', 'Globlex', 'AdminD', 'Porter', 'Crewsign']) +
    '</tbody></table>' + llBlock + '</div></div>' +
    '<div class="foot">SmartShift Roster · live จาก Apps Script</div>' +
    '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>' +
    '<script>var CD=' + JSON.stringify(cd) + ';' +
    'function go(){var d=document.getElementById("dt").value;if(d)window.location.search="?date="+d;}' +
    'window.addEventListener("load",function(){if(!window.Chart)return;' +
    'Chart.defaults.color="#9fb3d1";Chart.defaults.font.family="Noto Sans Thai,sans-serif";' +
    'new Chart(document.getElementById("c1"),{type:"bar",data:{labels:CD.tn,datasets:[' +
    '{label:"Working",data:CD.tw,backgroundColor:"#19a974",borderRadius:4},' +
    '{label:"Total",data:CD.tt,backgroundColor:"#33415e",borderRadius:4}]},' +
    'options:{responsive:true,plugins:{legend:{labels:{boxWidth:12}}},scales:{x:{grid:{display:false}},y:{grid:{color:"#1d2742"},beginAtZero:true}}}});' +
    'new Chart(document.getElementById("c2"),{type:"doughnut",data:{labels:["Working","OFF","Sick","Leave"],' +
    'datasets:[{data:[CD.work,CD.off,CD.sick,CD.leave],backgroundColor:["#19a974","#7b8794","#c0392b","#f5a623"],borderColor:"#141c2f",borderWidth:2}]},' +
    'options:{responsive:true,plugins:{legend:{position:"bottom",labels:{boxWidth:12}}}}});});' +
    '</script></body></html>';
}
