/**
 * WebDashboard.gs — AOTGA Daily Manpower Dashboard web app (doGet).
 * =============================================================================
 * Visual design adopted from the AOTGA dashboard design system (corporate CI,
 * Kanit, appbar / week nav / KPI hero / panels / tables). Server-rendered so it
 * runs as an Apps Script web app. Deploy → Web app → open the /exec URL.
 * Requires RosterReader.gs / LLReader.gs / MasterReader.gs / RosterBot.gs / SLA.gs.
 */

var AOTGA_LOGO_URL = '';
var CI = { royal:'#1D428A', bosch:'#236192', sky:'#4EC3E0', teal:'#3FBCBE', yellow:'#FEC909', red:'#D92526', grey:'#7C878F', good:'#1BA37A', sub:'#5a6b86' };
var MONW = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
var DOWW = ['อา','จ','อ','พ','พฤ','ศ','ส'];

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.ping) {  // deployment self-test: /exec?ping=1
    return HtmlService.createHtmlOutput('<body style="font-family:sans-serif;padding:30px">✅ Web app OK · ' + new Date() + '</body>');
  }
  var date = new Date();
  if (p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date)) { var a = p.date.split('-'); date = new Date(+a[0], +a[1]-1, +a[2]); }
  var tz = Session.getScriptTimeZone() || 'Asia/Bangkok';
  var iso = Utilities.formatDate(date, tz, 'yyyy-MM-dd');
  var base = ''; try { base = ScriptApp.getService().getUrl() || ''; } catch (eb) {}
  var html;
  try {
    var d = rbLoadResLL_(date);
    var master = null;
    if (MASTER_FILE_ID_RB) { try { master = readMasterHeadcount(MASTER_FILE_ID_RB); } catch (e4) {} }
    html = rbBuildDashboardHtml_(d.res, d.ll, master, date, iso, base, tz);
  } catch (err) {
    html = '<!doctype html><html><head><meta charset="utf-8"><style>' + rbDesignCss_() + '</style></head>' +
      '<body><div class="wrap">' + rbWeekNav_(date, iso, base, tz) +
      '<div class="panel" style="text-align:center;padding:40px"><h2>⚠️ ไม่มีข้อมูลของวันที่ ' + rbEsc_(iso) + '</h2>' +
      '<p class="muted" style="margin-top:8px">' + rbEsc_(err.message) + '</p>' +
      '<p class="muted">ยังไม่มีไฟล์ assignment ของวันนี้ หรือบัญชีไม่มีสิทธิ์ — เลือกวันอื่นจากแถบด้านบน</p></div></div></body></html>';
  }
  return HtmlService.createHtmlOutput(html).setTitle('AOTGA · Manpower Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Load the PSA roster (+ LL) for a date. Used by doGet and the lazy tab loaders. */
function rbLoadResLL_(date) {
  var roster = rbOpenTodayRoster_(date);
  var res = readRosterFromSpreadsheet(roster.ss);
  if (roster.tempId) { try { DriveApp.getFileById(roster.tempId).setTrashed(true); } catch (e) {} }
  var ll = null;
  if (CONFIG_RB.LL_FILE_ID) { try { ll = readLLForDate(CONFIG_RB.LL_FILE_ID, date); } catch (e2) {} }
  return { res: res, ll: ll };
}
function rbDateFromIso_(iso) { var a = String(iso).split('-'); return new Date(+a[0], +a[1] - 1, +a[2]); }

/** Lazy tab: Timetable HTML (called from client via google.script.run). */
function rbTimetableHtml(iso) {
  try {
    var d = rbLoadResLL_(rbDateFromIso_(iso));
    return rbTblCard_('🕓 Timetable · ตารางงานรายคน (เวลาเข้า-ออกกะ · OT · STA/STD)',
      '<tr><th>ทีม</th><th>ชื่อ</th><th>ตำแหน่ง</th><th>กะ (เข้า-ออก)</th><th>OT</th><th>#</th><th>เที่ยวบิน</th></tr>',
      rbTtRows_(d.res, d.ll),
      '<input id="ttq" class="search" placeholder="🔎 ค้นหา ชื่อ/ทีม/เที่ยวบิน" oninput="filterTT()">');
  } catch (e) { return '<div class="panel">โหลด Timetable ไม่ได้: ' + rbEsc_(e.message) + '</div>'; }
}
/** Lazy tab: Flights & SLA HTML. */
function rbFlightsHtml(iso) {
  try {
    var d = rbLoadResLL_(rbDateFromIso_(iso));
    return rbTblCard_('✈️ ไฟลท์บินประจำวัน + เช็ค SLA สายการบิน',
      '<tr><th>Flight</th><th>สายการบิน</th><th>ทีม</th><th>STA</th><th>STD</th><th>ส่ง/ต้องการ</th><th>SUP</th><th>Check-in</th><th>Gate</th><th>Arrival</th><th>สถานะ</th></tr>',
      rbFltRows_(d.res, d.ll));
  } catch (e) { return '<div class="panel">โหลด Flights ไม่ได้: ' + rbEsc_(e.message) + '</div>'; }
}

function rbEsc_(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function rbOtTxt_(n,h){ return n>0 ? (n+' <span class="muted">('+h+'h)</span>') : '·'; }

// ── header + week nav + tabs ────────────────────────────────────────────────
function rbAppbar_(date) {
  var be = date.getFullYear()+543;
  return '<div class="appbar rise"><div class="appbar__row">' +
    '<div class="brand"><div class="brand__mark">✈</div><div><h1>AOT<span>GA</span></h1>' +
    '<p>Passenger Services · การโดยสาร</p></div></div>' +
    '<div class="appbar__meta"><div class="datepill"><div class="d tnum">' + date.getDate()+' '+MONW[date.getMonth()]+' '+be +
    '</div><div class="s">Daily Manpower · ตารางกำลังพลรายวัน</div></div>' +
    '<div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">' +
    '<div class="livedot"><i></i>Live</div>' +
    '<button class="btn btn--accent" onclick="window.print()">⬇ Export PDF</button></div></div></div></div>';
}
function rbWeekNav_(date, iso, base, tz) {
  var chips = [];
  for (var off=-7; off<=7; off++) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate()+off);
    var i = Utilities.formatDate(d, tz||'Asia/Bangkok', 'yyyy-MM-dd');
    chips.push('<a class="wk' + (i===iso?' sel':'') + '" href="' + (base||'') + '?date=' + i + '" target="_top">' +
      '<span class="wd">' + DOWW[d.getDay()] + '</span><span class="wn tnum">' + d.getDate() + '</span>' +
      '<span class="wm">' + MONW[d.getMonth()] + '</span></a>');
  }
  var prev = new Date(date.getFullYear(),date.getMonth(),date.getDate()-1);
  var next = new Date(date.getFullYear(),date.getMonth(),date.getDate()+1);
  function u(d){ return (base||'') + '?date=' + Utilities.formatDate(d, tz||'Asia/Bangkok','yyyy-MM-dd'); }
  return '<div class="weeknav"><div class="weeknav__date">' +
    '<a class="iconbtn" href="' + u(prev) + '" target="_top">‹</a>' +
    '<a class="iconbtn" href="' + u(next) + '" target="_top">›</a></div>' +
    '<div class="weeknav__strip">' + chips.join('') + '</div></div>';
}
function rbTabs_(shortCount) {
  return '<div class="tabs">' +
    '<button class="tab active" id="tab-dash" onclick="showView(\'dash\')">▦ Dashboard</button>' +
    '<button class="tab" id="tab-tt" onclick="showView(\'tt\');loadTT()">☰ Timetable</button>' +
    '<button class="tab" id="tab-flt" onclick="showView(\'flt\');loadFlt()">✈ Flights &amp; SLA' +
    (shortCount ? '<span class="badge tnum">' + shortCount + '</span>' : '') + '</button>' +
    '<button class="tab" id="tab-ot" onclick="showView(\'ot\');loadOT()">⏱️ OT สัปดาห์</button></div>';
}

/** Called from the client (google.script.run) when the OT-week tab is opened.
 *  Computes weekly OT (reads the week's files) and returns the table HTML. */
function rbWeeklyOTHtml(iso) {
  try {
    var a = String(iso).split('-');
    var date = new Date(+a[0], +a[1] - 1, +a[2]);
    var wk = rbWeeklyOT_(date);
    var dayCols = [];
    for (var d = wk.startDay; d <= wk.endDay; d++) dayCols.push(d);
    var th = '<tr><th>ชื่อ</th><th>ทีม</th><th>ตำแหน่ง</th>' +
      dayCols.map(function (x) { return '<th>' + x + '</th>'; }).join('') + '<th>OT รวม/สัปดาห์</th><th>สถานะ</th></tr>';
    var rows = wk.people.map(function (p) {
      var tds = dayCols.map(function (x) { return '<td class="tnum">' + (p.daily[x] || '') + '</td>'; }).join('');
      var status = p.total > OT_WEEK_LIMIT ? '<span class="badd">🔴 เกิน ' + OT_WEEK_LIMIT + '</span>'
                 : (p.total >= 30 ? '<span class="muted">🟡 ใกล้</span>' : '');
      return '<tr class="' + (p.total > OT_WEEK_LIMIT ? 'rowbad' : '') + '"><td class="b">' + rbEsc_(p.name) + '</td><td>' +
        rbEsc_(p.team) + '</td><td>' + rbEsc_(p.pos) + '</td>' + tds + '<td class="tnum"><b>' + p.total + 'h</b></td><td>' + status + '</td></tr>';
    }).join('');
    var hd = '<div class="sectionlabel">สัปดาห์ ' + wk.startDay + '-' + wk.endDay + ' · อ่าน ' + wk.daysRead.length +
      ' วัน · <b class="badd">เกิน ' + OT_WEEK_LIMIT + ' ชม.: ' + wk.over.length + ' คน</b></div>';
    return hd + '<div class="tablecard"><div class="tablecard__hd"><h3>⏱️ OT รายสัปดาห์ (เกิน ' + OT_WEEK_LIMIT + ' ชม./สัปดาห์)</h3></div>' +
      '<div style="overflow-x:auto"><table class="tbl"><thead>' + th + '</thead><tbody>' +
      (rows || '<tr><td colspan="' + (dayCols.length + 5) + '" class="muted">ยังไม่มีข้อมูล OT ในสัปดาห์นี้</td></tr>') +
      '</tbody></table></div></div>';
  } catch (e) { return '<div class="panel">โหลด OT รายสัปดาห์ไม่ได้: ' + rbEsc_(e.message) + '</div>'; }
}

// ── KPI hero ────────────────────────────────────────────────────────────────
function rbKpiHero_(C, master) {
  var attPct = C.staff>0 ? Math.round((C.working)/C.staff*100) : 0;
  var avg = C.otPeople>0 ? Math.round(C.otHours/C.otPeople*10)/10 : 0;
  var defs = [
    ['👥', CI.royal, C.staff, '', 'Total Staff', 'พนักงานทั้งหมด', master ? ('+'+(master.PSA.total+master.LL.total)+' active') : ''],
    ['✅', CI.good, C.working, '', 'Working', 'มาปฏิบัติงาน', attPct+'% attendance'],
    ['⬛', CI.grey, C.off, '', 'OFF', 'วันหยุด', ''],
    ['🟡', CI.yellow, C.ot_off, '', 'OT OFF (XX)', 'ทำ OT วันหยุด', C.otOffHrs+'h'],
    ['⏰', CI.red, C.otPeople, '', 'OT · People', 'พนักงานทำ OT', 'รวมทั้งกะ'],
    ['⏱️', CI.bosch, C.otHours, 'h', 'OT · Hours', 'ชั่วโมง OT รวม', avg+'h เฉลี่ย/คน'],
  ];
  return '<div class="kpis rise">' + defs.map(function (d) {
    return '<div class="kpi" style="--c:' + d[1] + '"><div class="kpi__top">' +
      '<div class="kpi__ico" style="--c:' + d[1] + '">' + d[0] + '</div>' +
      (d[6] ? '<div class="kpi__trend">' + rbEsc_(d[6]) + '</div>' : '') + '</div>' +
      '<div class="kpi__val tnum">' + d[2] + (d[3]||'') + '</div>' +
      '<div class="kpi__lbl">' + d[4] + '</div><div class="kpi__sub">' + d[5] + '</div></div>';
  }).join('') + '</div>';
}

// ── table rows ──────────────────────────────────────────────────────────────
function rbBarMini_(pct){ return '<div class="barmini"><i style="width:'+pct+'%"></i><b>'+pct+'%</b></div>'; }
function rbAggRowHtml_(label, b) {
  var work = b.working + b.ot_off, pct = b.staff>0 ? Math.round(work/b.staff*100) : 0;
  return '<tr><td class="b">' + rbEsc_(label) + '</td><td class="tnum">' + b.staff + '</td><td class="tnum"><b>' + work +
    '</b></td><td class="tnum">' + rbOtTxt_(b.ot_off, b.otOffHrs) + '</td><td class="tnum">' + rbOtTxt_(b.otPre, b.otPreHrs) +
    '</td><td class="tnum">' + rbOtTxt_(b.otPost, b.otPostHrs) + '</td><td style="min-width:90px">' + rbBarMini_(pct) + '</td></tr>';
}
function rbTeamRows_(teams, order){ return order.map(function(t){ return rbAggRowHtml_(t, teams[t]); }).join(''); }
function rbPosRows_(positions, order) {
  return order.map(function (p) {
    var b = positions[p]; if (!b) return '';
    return '<tr><td class="b">' + p + '</td><td class="tnum">' + b.staff + '</td><td class="tnum"><b>' + (b.working + b.ot_off) +
      '</b></td><td class="tnum">' + rbOtTxt_(b.ot_off, b.otOffHrs) + '</td><td class="tnum">' + b.off + '</td><td class="tnum">' + b.sick +
      '</td><td class="tnum">' + b.leave + '</td><td class="tnum">' + rbOtTxt_(b.otPre, b.otPreHrs) + '</td><td class="tnum">' +
      rbOtTxt_(b.otPost, b.otPostHrs) + '</td></tr>';
  }).join('');
}
function rbFlightChips_(assigns) {
  if (!assigns || !assigns.length) return '<span class="muted">—</span>';
  return assigns.map(function (a) {
    var t = a.task ? (' <span class="tag">'+rbEsc_(a.task)+'</span>') : '';
    var sta = (a.STA||a.STD) ? (' '+(a.STA||'–')+'/'+(a.STD||'–')) : '';
    var op = (a.OP||a.CL) ? (' <span class="muted">'+(a.OP||'–')+'-'+(a.CL||'–')+'</span>') : '';
    return '<span class="chip" style="cursor:default">' + rbEsc_(a.flight) + t + sta + op + '</span>';
  }).join(' ');
}
function rbTtRows_(res, ll) {
  var rows = [];
  Object.keys(res.teams).forEach(function (t){ res.teams[t].records.forEach(function(r){ if(r.bucket==='working'||r.bucket==='ot_off') rows.push(r); }); });
  if (ll && ll.totals.staff>0) Object.keys(ll.sections).forEach(function(s){ ll.sections[s].records.forEach(function(r){ if(r.bucket==='working'||r.bucket==='ot_off') rows.push(r); }); });
  rows.sort(function(a,b){ return String(a.team).localeCompare(String(b.team)) || ((a.shiftStart==null?99999:a.shiftStart)-(b.shiftStart==null?99999:b.shiftStart)); });
  return rows.map(function (r) {
    var st = r.shiftStart==null?99999:r.shiftStart;
    var sh = rbEsc_(r.shift||'') + (r.shiftTime&&r.shiftTime!==r.shift ? ' <span class="muted">'+r.shiftTime+'</span>' : '');
    var ot = r.ot ? ((r.bucket==='ot_off'?'<span class="tag">OFF</span>':(r.otType==='PRE'?'<span class="tag">ก่อน</span>':'<span class="tag">หลัง</span>'))+' '+(r.otTime||'')+' <span class="muted">('+r.ot+'h)</span>') : '<span class="muted">—</span>';
    return '<tr data-team="'+rbEsc_(r.team)+'" data-start="'+st+'"><td class="b">'+rbEsc_(r.team)+'</td><td>'+rbEsc_(r.name)+
      '</td><td>'+rbEsc_(r.pos||'')+'</td><td>'+sh+'</td><td>'+ot+'</td><td class="tnum">'+(r.assignments?r.assignments.length:0)+
      '</td><td>'+rbFlightChips_(r.assignments)+'</td></tr>';
  }).join('');
}
function rbFltRows_(res, ll) {
  return slaCollectFlights_(res, ll).map(function (f) {
    function c(ph){ return '<td class="tnum '+(f.short[ph]?'badd':'okk')+'">'+f.assigned[ph]+'/'+f.req[ph]+(f.short[ph]?' ▼'+f.short[ph]:'')+'</td>'; }
    var st = f.ok ? '<span class="okk">✅ ครบ</span>' : '<span class="badd">⚠️ '+rbEsc_(slaShortText_(f))+'</span>';
    return '<tr class="'+(f.ok?'':'rowbad')+'"><td class="b">'+rbEsc_(f.flight)+'</td><td>'+f.airline+'</td><td>'+rbEsc_(f.teamList)+
      '</td><td class="tnum">'+(f.STA||'')+'</td><td class="tnum">'+(f.STD||'')+'</td><td class="tnum"><b>'+f.assigned.total+'</b>/'+f.req.total+'</td>'+
      c('SUP')+c('CI')+c('GATE')+c('ARR')+'<td>'+st+'</td></tr>';
  }).join('');
}

function rbTblCard_(title, headHtml, bodyHtml, extraHd) {
  return '<div class="tablecard"><div class="tablecard__hd"><h3>'+title+'</h3>'+(extraHd||'')+'</div>' +
    '<div style="overflow-x:auto"><table class="tbl"><thead>'+headHtml+'</thead><tbody>'+bodyHtml+'</tbody></table></div></div>';
}

function rbBuildDashboardHtml_(res, ll, master, date, iso, base, tz, staticMode) {
  var P = res.totals, L = ll && ll.totals.staff>0 ? ll.totals : null;
  function comb(k){ return P[k] + (L?L[k]:0); }
  var C = { staff:comb('staff'), working:comb('working')+comb('ot_off'), off:comb('off'), sick:comb('sick'),
            leave:comb('leave'), ot_off:comb('ot_off'), otOffHrs:Math.round(comb('otOffHrs')*10)/10,
            otPeople:comb('otPeople'), otHours:Math.round(comb('otHours')*10)/10,
            otPre:comb('otPre'), otPreHrs:Math.round(comb('otPreHrs')*10)/10,
            otPost:comb('otPost'), otPostHrs:Math.round(comb('otPostHrs')*10)/10 };
  var teamOrder = Object.keys(res.teams).sort(function(a,b){ return (res.teams[b].working+res.teams[b].ot_off)-(res.teams[a].working+res.teams[a].ot_off); });
  var shortCount = slaCollectFlights_(res, ll).filter(function(f){return !f.ok;}).length;

  var cd = { tn:teamOrder, tw:teamOrder.map(function(t){return res.teams[t].working+res.teams[t].ot_off;}),
    tt:teamOrder.map(function(t){return res.teams[t].staff;}), work:C.working, off:C.off, sick:C.sick, leave:C.leave,
    otPreN:C.otPre, otPostN:C.otPost, otOffN:C.ot_off, otPreH:C.otPreHrs, otPostH:C.otPostHrs, otOffH:C.otOffHrs, c:CI };

  var teamHead = '<tr><th>ทีม</th><th>Total</th><th>Working</th><th>OT-Off</th><th>OT ก่อน</th><th>OT หลัง</th><th>%Working</th></tr>';
  var posHead = '<tr><th>ตำแหน่ง</th><th>Total</th><th>Work</th><th>OT-Off</th><th>Off</th><th>Sick</th><th>Leave</th><th>OT ก่อน</th><th>OT หลัง</th></tr>';
  var masterLine = master ? ('<div class="sectionlabel">👥 พนักงานทั้งหมด (Active): PSA <b>'+master.PSA.total+'</b> + LL <b>'+master.LL.total+'</b> = <b>'+(master.PSA.total+master.LL.total)+'</b> คน</div>') : '';
  var llCards = '';
  if (L) {
    var secRows = Object.keys(ll.sections).map(function(s){ return rbAggRowHtml_(s, ll.sections[s]); }).join('');
    llCards = rbTblCard_('🟡 LL by Section', '<tr><th>ส่วนงาน</th><th>Total</th><th>Working</th><th>OT-Off</th><th>OT ก่อน</th><th>OT หลัง</th><th>%Working</th></tr>', secRows) +
      rbTblCard_('🟡 LL by Position', posHead, rbPosRows_(ll.positions, ['PSS','SNR','PSA','Porter','Admin','Trainee']));
  }

  var otbar = '<div class="otsplit"><div class="otrow"><span>⏱️ OT ก่อนกะ</span><b class="tnum">'+C.otPre+' คน · '+C.otPreHrs+'h</b></div>' +
    '<div class="otrow"><span>⏱️ OT หลังกะ</span><b class="tnum">'+C.otPost+' คน · '+C.otPostHrs+'h</b></div>' +
    '<div class="otrow"><span>⏱️ OT OFF</span><b class="tnum">'+C.ot_off+' คน · '+C.otOffHrs+'h</b></div>' +
    '<div class="otrow"><span>รวม OT</span><b class="tnum">'+C.otPeople+' คน · '+C.otHours+'h</b></div></div>';

  // tab contents: inline (offline file) or lazy placeholders (web app)
  var ttInner = staticMode
    ? rbTblCard_('🕓 Timetable · ตารางงานรายคน (เวลาเข้า-ออกกะ · OT · STA/STD)',
        '<tr><th>ทีม</th><th>ชื่อ</th><th>ตำแหน่ง</th><th>กะ (เข้า-ออก)</th><th>OT</th><th>#</th><th>เที่ยวบิน</th></tr>',
        rbTtRows_(res, ll), '<input id="ttq" class="search" placeholder="🔎 ค้นหา ชื่อ/ทีม/เที่ยวบิน" oninput="filterTT()">')
    : '<div id="ttbox"><div class="panel muted" style="text-align:center;padding:34px">⏳ กำลังโหลด Timetable…</div></div>';
  var fltInner = staticMode
    ? rbTblCard_('✈️ ไฟลท์บินประจำวัน + เช็ค SLA สายการบิน',
        '<tr><th>Flight</th><th>สายการบิน</th><th>ทีม</th><th>STA</th><th>STD</th><th>ส่ง/ต้องการ</th><th>SUP</th><th>Check-in</th><th>Gate</th><th>Arrival</th><th>สถานะ</th></tr>',
        rbFltRows_(res, ll))
    : '<div id="fltbox"><div class="panel muted" style="text-align:center;padding:34px">⏳ กำลังโหลด Flights &amp; SLA…</div></div>';
  var otInner = staticMode ? rbWeeklyOTHtml(iso)
    : '<div id="otbox"><div class="panel muted" style="text-align:center;padding:34px">⏳ กำลังคำนวณ OT รายสัปดาห์ (อ่านไฟล์หลายวัน อาจใช้เวลาสักครู่)…</div></div>';

  return '<!doctype html><html lang="th" data-theme="corporate"><head><meta charset="utf-8">' +
    '<link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">' +
    '<style>' + rbDesignCss_() + '</style></head><body><div class="wrap">' +
    rbAppbar_(date) + rbWeekNav_(date, iso, base, tz) + rbTabs_(shortCount) +
    '<div id="view-dash">' +
    rbKpiHero_(C, master) + masterLine +
    '<div class="grid grid--charts" style="margin-top:16px">' +
      '<div class="panel"><div class="panel__hd"><h3>📊 Working / Total ต่อทีม</h3></div><canvas id="c1" height="150"></canvas></div>' +
      '<div class="panel"><div class="panel__hd"><h3>🧭 ภาพรวมสถานะ</h3></div><canvas id="c2" height="150"></canvas></div></div>' +
    '<div class="grid grid--charts" style="margin-top:16px">' +
      '<div class="panel"><div class="panel__hd"><h3>⏱️ OT แยกประเภท (คน)</h3></div><canvas id="c3" height="140"></canvas></div>' +
      '<div class="panel"><div class="panel__hd"><h3>⏱️ OT แยกประเภท (ชม.)</h3></div><canvas id="c4" height="140"></canvas></div>' +
      '<div class="panel">' + otbar + '</div></div>' +
    '<div style="margin-top:16px">' + rbTblCard_('📌 Manpower by Team (PSA)', teamHead, rbTeamRows_(res.teams, teamOrder)) + '</div>' +
    '<div style="margin-top:16px">' + rbTblCard_('👥 PSA by Position', posHead, rbPosRows_(res.positions, ['PSS','SNR','PSA','Globlex','AdminD','Porter','Crewsign'])) + '</div>' +
    (L ? '<div style="margin-top:16px">'+llCards+'</div>' : '') +
    '</div>' +
    '<div id="view-tt" style="display:none">' + ttInner + '</div>' +
    '<div id="view-flt" style="display:none">' + fltInner + '</div>' +
    '<div id="view-ot" style="display:none">' + otInner + '</div>' +
    '<div class="foot">บริษัท บริการภาคพื้น ท่าอากาศยานไทย จำกัด (AOTGA) · live จาก Apps Script</div>' +
    '</div>' +
    '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>' +
    '<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0/dist/chartjs-plugin-datalabels.min.js"></script>' +
    '<script>var CD=' + JSON.stringify(cd) + ';var ISO=' + JSON.stringify(iso) + ';var STATIC=' + (staticMode ? 'true' : 'false') + ';' +
    'function showView(v){["dash","tt","flt","ot"].forEach(function(x){document.getElementById("view-"+x).style.display=v===x?"":"none";document.getElementById("tab-"+x).className="tab"+(v===x?" active":"");});}' +
    'var LD={};function lazy(box,fn,id){if(STATIC||LD[id])return;LD[id]=1;if(!(window.google&&google.script&&google.script.run)){document.getElementById(box).innerHTML="<div class=\\"panel muted\\" style=\\"padding:24px;text-align:center\\">เปิดผ่าน Web App URL (/exec) เพื่อดูส่วนนี้</div>";return;}' +
    'google.script.run.withSuccessHandler(function(h){document.getElementById(box).innerHTML=h;}).withFailureHandler(function(e){LD[id]=0;document.getElementById(box).innerHTML="<div class=\\"panel\\">โหลดไม่ได้: "+e.message+"</div>";})[fn](ISO);}' +
    'function loadTT(){lazy("ttbox","rbTimetableHtml","tt");}function loadFlt(){lazy("fltbox","rbFlightsHtml","flt");}function loadOT(){lazy("otbox","rbWeeklyOTHtml","ot");}' +
    'function filterTT(){var q=document.getElementById("ttq").value.toLowerCase();var t=document.querySelectorAll("#view-tt tbody tr");[].forEach.call(t,function(r){r.style.display=r.textContent.toLowerCase().indexOf(q)>=0?"":"none";});}' +
    'window.addEventListener("load",function(){if(!window.Chart)return;if(window.ChartDataLabels)Chart.register(window.ChartDataLabels);' +
    'Chart.defaults.color="'+CI.sub+'";Chart.defaults.font.family="Kanit,sans-serif";Chart.defaults.font.weight="600";' +
    'new Chart(c1,{type:"bar",data:{labels:CD.tn,datasets:[{label:"Working",data:CD.tw,backgroundColor:CD.c.teal,borderRadius:5},{label:"Total",data:CD.tt,backgroundColor:"#c9d6e8",borderRadius:5}]},options:{plugins:{legend:{labels:{boxWidth:12}},datalabels:{anchor:"end",align:"end",font:{size:9,weight:"700"},color:"#15233f"}},scales:{x:{grid:{display:false}},y:{beginAtZero:true,grid:{color:"#eef2f8"},suggestedMax:Math.max.apply(null,CD.tt)+3}}}});' +
    'new Chart(c2,{type:"doughnut",data:{labels:["Working","OFF","Sick","Leave"],datasets:[{data:[CD.work,CD.off,CD.sick,CD.leave],backgroundColor:[CD.c.teal,CD.c.grey,CD.c.red,CD.c.yellow],borderColor:"#fff",borderWidth:2}]},options:{plugins:{legend:{position:"bottom",labels:{boxWidth:12}},datalabels:{color:"#fff",font:{weight:"700"}}}}});' +
    'var OTL=["ก่อนกะ","หลังกะ","OT OFF"],OTC=[CD.c.yellow,CD.c.royal,CD.c.red];' +
    'new Chart(c3,{type:"bar",data:{labels:OTL,datasets:[{data:[CD.otPreN,CD.otPostN,CD.otOffN],backgroundColor:OTC,borderRadius:6}]},options:{plugins:{legend:{display:false},datalabels:{anchor:"end",align:"end",color:"#15233f",font:{weight:"700"},formatter:function(v){return v+" คน";}}},scales:{x:{grid:{display:false}},y:{beginAtZero:true,grid:{color:"#eef2f8"}}}}});' +
    'new Chart(c4,{type:"bar",data:{labels:OTL,datasets:[{data:[CD.otPreH,CD.otPostH,CD.otOffH],backgroundColor:OTC,borderRadius:6}]},options:{plugins:{legend:{display:false},datalabels:{anchor:"end",align:"end",color:"#15233f",font:{weight:"700"},formatter:function(v){return v+"h";}}},scales:{x:{grid:{display:false}},y:{beginAtZero:true,grid:{color:"#eef2f8"}}}}});});' +
    '</script></body></html>';
}

function rbDesignCss_() { return rbDESIGN_CSS_; }
var rbDESIGN_CSS_ = `/* ============================================================================
 * AOTGA Daily Manpower Dashboard — design system
 * Aviation operations aesthetic on the AOTGA corporate identity.
 * Themeable via [data-theme] on <html>: corporate | vibrant | soft
 * ==========================================================================*/

:root {
  /* AOTGA CI */
  --royal: #1D428A;
  --bosch: #236192;
  --sky: #4EC3E0;
  --teal: #3FBCBE;
  --yellow: #FEC909;
  --red: #D92526;
  --grey: #7C878F;

  /* semantic */
  --brand: var(--royal);
  --brand-2: var(--bosch);
  --accent: var(--sky);
  --good: #1BA37A;
  --warn: #E8A400;
  --alert: var(--red);

  /* surfaces */
  --bg: #eef3fa;
  --bg-2: #e3ecf7;
  --card: #ffffff;
  --ink: #15233f;
  --ink-2: #5a6b86;
  --ink-3: #93a1b8;
  --line: #e4ebf4;
  --line-2: #eef2f8;

  --radius: 16px;
  --radius-sm: 11px;
  --radius-lg: 22px;
  --shadow: 0 2px 4px rgba(20,40,80,.04), 0 12px 28px rgba(20,40,80,.07);
  --shadow-sm: 0 1px 2px rgba(20,40,80,.05), 0 4px 12px rgba(20,40,80,.05);
  --shadow-lg: 0 8px 18px rgba(20,40,80,.08), 0 30px 60px rgba(20,40,80,.12);

  --header-grad: linear-gradient(118deg, #16315f 0%, var(--royal) 46%, var(--bosch) 100%);
  --maxw: 1320px;
  --font: 'Kanit', -apple-system, 'Segoe UI', sans-serif;
}

/* ---- Theme: VIBRANT (modern & colorful) ---------------------------------- */
[data-theme="vibrant"] {
  --bg: #eaf1fb;
  --bg-2: #dfeafb;
  --header-grad: linear-gradient(120deg, #1b2a6b 0%, var(--royal) 38%, var(--teal) 100%);
  --shadow: 0 2px 6px rgba(29,66,138,.06), 0 16px 36px rgba(29,66,138,.12);
  --shadow-lg: 0 10px 24px rgba(29,66,138,.12), 0 36px 70px rgba(29,66,138,.18);
}

/* ---- Theme: SOFT (friendly & rounded) ------------------------------------ */
[data-theme="soft"] {
  --bg: #f4f6fb;
  --bg-2: #eef1f8;
  --card: #ffffff;
  --line: #eceff6;
  --radius: 22px;
  --radius-sm: 15px;
  --radius-lg: 28px;
  --header-grad: linear-gradient(125deg, #2a4f97 0%, #3a6fc0 60%, #5aa9d8 100%);
  --shadow: 0 3px 8px rgba(40,60,100,.05), 0 16px 40px rgba(40,60,100,.08);
}

* { box-sizing: border-box; margin: 0; padding: 0; }

html, body { background: var(--bg); }
body {
  font-family: var(--font);
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  min-height: 100vh;
  background:
    radial-gradient(1200px 600px at 85% -10%, rgba(78,195,224,.18), transparent 60%),
    radial-gradient(1000px 500px at -5% 0%, rgba(29,66,138,.10), transparent 55%),
    var(--bg);
}

.wrap { max-width: var(--maxw); margin: 0 auto; padding: 20px 24px 56px; }

/* tabular numerals everywhere numbers matter */
.tnum { font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1; }

/* ============================ HEADER ====================================== */
.appbar {
  position: relative;
  background: var(--header-grad);
  border-radius: var(--radius-lg);
  padding: 20px 28px;
  color: #fff;
  overflow: hidden;
  box-shadow: var(--shadow-lg);
}
.appbar::before {
  /* subtle radar / flight-path arcs */
  content: "";
  position: absolute; inset: 0;
  background:
    radial-gradient(520px 520px at 88% -120%, rgba(255,255,255,.14), transparent 60%),
    repeating-linear-gradient(115deg, rgba(255,255,255,.05) 0 1px, transparent 1px 64px);
  pointer-events: none;
}
.appbar__row { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 18px; flex-wrap: wrap; }
.brand { display: flex; align-items: center; gap: 15px; }
.brand__mark {
  width: 52px; height: 52px; border-radius: 14px;
  background: rgba(255,255,255,.12);
  border: 1.5px solid rgba(255,255,255,.4);
  display: grid; place-items: center; flex: 0 0 auto;
  backdrop-filter: blur(4px);
}
.brand__mark svg { width: 30px; height: 30px; }
.brand h1 { font-size: 21px; font-weight: 800; letter-spacing: .6px; line-height: 1.05; }
.brand h1 span { color: var(--sky); }
.brand p { font-size: 12px; font-weight: 300; color: #cfe1f5; margin-top: 3px; letter-spacing: .2px; white-space: nowrap; }

.appbar__meta { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.datepill {
  display: flex; flex-direction: column; align-items: flex-end;
  padding-right: 16px; border-right: 1px solid rgba(255,255,255,.22);
}
.datepill .d { font-size: 19px; font-weight: 700; line-height: 1.1; white-space: nowrap; }
.datepill .s { font-size: 11px; color: #cfe1f5; font-weight: 300; white-space: nowrap; }
.livedot { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: #d8e8f8; font-weight: 400; }
.livedot i { width: 8px; height: 8px; border-radius: 50%; background: #58e6a0; box-shadow: 0 0 0 0 rgba(88,230,160,.6); animation: pulse 2s infinite; }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(88,230,160,.5); } 70% { box-shadow: 0 0 0 7px rgba(88,230,160,0); } 100% { box-shadow: 0 0 0 0 rgba(88,230,160,0); } }

.btn {
  font-family: inherit; cursor: pointer; border: 0; border-radius: 11px;
  padding: 10px 15px; font-size: 13px; font-weight: 600; display: inline-flex;
  align-items: center; gap: 7px; transition: transform .12s ease, box-shadow .12s ease, background .12s;
}
.btn:active { transform: translateY(1px); }
.btn--ghost { background: rgba(255,255,255,.14); color: #fff; border: 1px solid rgba(255,255,255,.28); }
.btn--ghost:hover { background: rgba(255,255,255,.24); }
.btn--accent { background: var(--sky); color: #0c2c45; }
.btn--accent:hover { box-shadow: 0 6px 16px rgba(78,195,224,.4); }

/* ============================ WEEK NAV ==================================== */
.weeknav { display: flex; align-items: center; gap: 12px; margin: 16px 0 18px; }
.weeknav__strip { display: flex; gap: 7px; overflow-x: auto; flex: 1; padding: 3px 1px 6px; scrollbar-width: thin; }
.weeknav__strip::-webkit-scrollbar { height: 5px; }
.weeknav__strip::-webkit-scrollbar-thumb { background: #c7d4e6; border-radius: 4px; }
.wk {
  flex: 0 0 auto; min-width: 50px; text-align: center; cursor: pointer;
  background: var(--card); border: 1px solid var(--line); border-radius: 13px;
  padding: 7px 6px 8px; line-height: 1.1; transition: all .14s ease; user-select: none;
}
.wk:hover { border-color: var(--accent); transform: translateY(-2px); box-shadow: var(--shadow-sm); }
.wk .wd { display: block; font-size: 9.5px; color: var(--ink-3); font-weight: 500; letter-spacing: .4px; }
.wk .wn { display: block; font-size: 18px; font-weight: 700; color: var(--ink); }
.wk .wm { display: block; font-size: 9px; color: var(--ink-3); font-weight: 400; }
.wk.sel { background: var(--brand); border-color: var(--brand); box-shadow: 0 8px 18px rgba(29,66,138,.28); }
.wk.sel .wd, .wk.sel .wm { color: #bcd2ef; }
.wk.sel .wn { color: #fff; }
.wk.today:not(.sel) { border-color: var(--accent); }
.wk.today:not(.sel) .wn { color: var(--brand); }
.weeknav__date { display: flex; align-items: center; gap: 8px; }
.weeknav__date input {
  font-family: inherit; background: var(--card); border: 1px solid var(--line);
  color: var(--ink); border-radius: 11px; padding: 9px 11px; font-size: 13px; font-weight: 500;
}
.iconbtn {
  width: 38px; height: 38px; flex: 0 0 auto; border-radius: 11px; border: 1px solid var(--line);
  background: var(--card); color: var(--brand); cursor: pointer; display: grid; place-items: center;
  font-size: 16px; transition: all .14s;
}
.iconbtn:hover { border-color: var(--accent); color: var(--accent); }

/* ============================ TABS ======================================== */
.tabs { display: flex; gap: 8px; margin-bottom: 18px; flex-wrap: wrap; }
.tab {
  font-family: inherit; cursor: pointer; background: var(--card); border: 1px solid var(--line);
  color: var(--ink-2); border-radius: 13px; padding: 11px 18px; font-weight: 600; font-size: 14px;
  display: inline-flex; align-items: center; gap: 9px; transition: all .15s ease;
}
.tab svg { width: 17px; height: 17px; }
.tab:hover { color: var(--brand); border-color: #cdd9ec; }
.tab.active { background: var(--brand); color: #fff; border-color: var(--brand); box-shadow: 0 8px 18px rgba(29,66,138,.24); }
.tab .badge {
  font-size: 11px; font-weight: 700; background: rgba(255,255,255,.22); color: #fff;
  border-radius: 20px; padding: 1px 8px; min-width: 20px; text-align: center;
}
.tab:not(.active) .badge { background: #fdeaea; color: var(--red); }

/* ============================ KPI HERO ==================================== */
.kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 14px; margin-bottom: 16px; }
.kpi {
  position: relative; background: var(--card); border: 1px solid var(--line);
  border-radius: var(--radius); padding: 16px 16px 15px; box-shadow: var(--shadow-sm);
  overflow: hidden; transition: transform .16s ease, box-shadow .16s ease;
}
.kpi:hover { transform: translateY(-3px); box-shadow: var(--shadow); }
.kpi::after { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--c); }
.kpi__top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 9px; }
.kpi__ico { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center;
  background: color-mix(in srgb, var(--c) 14%, white); color: var(--c); }
.kpi__ico svg { width: 19px; height: 19px; }
.kpi__trend { font-size: 11px; font-weight: 600; color: var(--ink-3); display: inline-flex; align-items: center; gap: 3px; }
.kpi__trend.up { color: var(--good); }
.kpi__trend.down { color: var(--alert); }
.kpi__val { font-size: 34px; font-weight: 800; color: var(--ink); line-height: 1; letter-spacing: -.5px; }
.kpi__val small { font-size: 15px; font-weight: 600; color: var(--ink-3); margin-left: 2px; }
.kpi__lbl { font-size: 12.5px; color: var(--ink-2); font-weight: 500; margin-top: 5px; }
.kpi__sub { font-size: 11px; color: var(--ink-3); margin-top: 2px; }

/* primary attendance band */
.attband {
  display: grid; grid-template-columns: 1.15fr 1fr 1fr; gap: 14px; margin-bottom: 16px;
}
.panel {
  background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
  padding: 18px 20px; box-shadow: var(--shadow-sm);
}
.panel--brand { background: var(--header-grad); color: #fff; border: 0; box-shadow: var(--shadow); position: relative; overflow: hidden; }
.panel--brand::before { content: ""; position: absolute; inset: 0; background: repeating-linear-gradient(115deg, rgba(255,255,255,.05) 0 1px, transparent 1px 54px); }
.panel h3 { font-size: 13px; font-weight: 600; color: var(--ink-2); margin-bottom: 14px; display: flex; align-items: center; gap: 8px; }
.panel--brand h3 { color: #cfe1f5; }
.panel__hd { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.panel__hd h3 { margin-bottom: 0; }

/* attendance ring */
.attring { position: relative; display: flex; align-items: center; gap: 18px; }
.ring { position: relative; width: 132px; height: 132px; flex: 0 0 auto; }
.ring__center { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; }
.ring__center .big { font-size: 30px; font-weight: 800; line-height: 1; color: #fff; }
.ring__center .lbl { font-size: 10.5px; color: #cfe1f5; margin-top: 3px; }
.attlegend { display: flex; flex-direction: column; gap: 9px; flex: 1; }
.leg { display: flex; align-items: center; gap: 9px; font-size: 13px; }
.leg i { width: 11px; height: 11px; border-radius: 4px; flex: 0 0 auto; }
.leg .lk { color: #d6e4f5; font-weight: 300; flex: 1; }
.leg .lv { font-weight: 700; font-size: 15px; }

/* mini stat list */
.statlist { display: flex; flex-direction: column; gap: 12px; }
.statrow { display: flex; align-items: center; gap: 12px; }
.statrow__ico { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: color-mix(in srgb, var(--c) 13%, white); color: var(--c); flex: 0 0 auto; }
.statrow__ico svg { width: 18px; height: 18px; }
.statrow__t { flex: 1; }
.statrow__t .k { font-size: 12px; color: var(--ink-2); font-weight: 500; }
.statrow__t .v { font-size: 19px; font-weight: 800; color: var(--ink); line-height: 1.1; }
.statrow__t .v small { font-size: 12px; color: var(--ink-3); font-weight: 600; }

/* OT split mini bars */
.otsplit { display: flex; flex-direction: column; gap: 13px; }
.otrow .otrow__top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 5px; }
.otrow .otrow__top .k { font-size: 12.5px; font-weight: 500; color: var(--ink-2); }
.otrow .otrow__top .v { font-size: 13px; font-weight: 700; color: var(--ink); white-space: nowrap; padding-left: 10px; }
.otrow .otrow__top .v small { color: var(--ink-3); font-weight: 500; }
.track { height: 9px; background: var(--line-2); border-radius: 6px; overflow: hidden; }
.track > i { display: block; height: 100%; border-radius: 6px; }

/* ============================ GRID ======================================= */
.grid { display: grid; gap: 16px; }
.grid--2 { grid-template-columns: 1.35fr 1fr; }
.grid--charts { grid-template-columns: 1.4fr 1fr; margin-bottom: 16px; }

/* ============================ CHARTS ===================================== */
.barchart { display: flex; flex-direction: column; gap: 11px; }
.barchart__row { display: grid; grid-template-columns: 116px 1fr 46px; align-items: center; gap: 12px; }
.barchart__lbl { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--ink); }
.barchart__lbl .tag { font-size: 10px; font-weight: 700; color: #fff; background: var(--brand); border-radius: 6px; padding: 1px 7px; letter-spacing: .3px; }
.barchart__bar { position: relative; height: 24px; background: var(--line-2); border-radius: 8px; overflow: hidden; }
.barchart__fill { position: relative; z-index: 1; height: 100%; border-radius: 8px; background: linear-gradient(90deg, var(--teal), var(--sky)); display: flex; align-items: center; transition: width .9s cubic-bezier(.2,.8,.2,1); }
.barchart__ghost { position: absolute; inset: 0; z-index: 0; }
.barchart__val { font-size: 13px; font-weight: 700; color: var(--ink); text-align: right; }
.barchart__val small { color: var(--ink-3); font-weight: 500; }

.donut-wrap { display: flex; align-items: center; gap: 20px; }
.donut { width: 150px; height: 150px; flex: 0 0 auto; }
.donut-legend { display: flex; flex-direction: column; gap: 11px; flex: 1; }

/* ============================ TABLES ===================================== */
.tablecard { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow-sm); overflow: hidden; }
.tablecard__hd { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px 13px; }
.tablecard__hd h3 { font-size: 14.5px; font-weight: 700; color: var(--brand); display: flex; align-items: center; gap: 9px; }
.tablecard__hd .pill { font-size: 11px; font-weight: 600; color: var(--ink-2); background: var(--bg-2); border-radius: 20px; padding: 3px 11px; }
.tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
.tbl th { text-align: right; color: var(--ink-3); font-weight: 600; font-size: 10.5px; letter-spacing: .4px; text-transform: uppercase; padding: 8px 12px; background: var(--bg-2); }
.tbl th:first-child { text-align: left; }
.tbl td { text-align: right; padding: 9px 12px; border-bottom: 1px solid var(--line-2); color: var(--ink); }
.tbl td:first-child { text-align: left; }
.tbl tbody tr:last-child td { border-bottom: 0; }
.tbl tbody tr:hover td { background: color-mix(in srgb, var(--accent) 7%, white); }
.tbl tr.total td { background: color-mix(in srgb, var(--brand) 6%, white); font-weight: 700; border-top: 2px solid var(--line); }
.tbl .nm { font-weight: 600; color: var(--ink); display: flex; align-items: center; gap: 9px; }
.dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; }
.tag {
  display: inline-flex; align-items: center; justify-content: center; min-width: 34px;
  font-size: 10.5px; font-weight: 800; letter-spacing: .4px; color: #fff;
  background: var(--brand); border-radius: 6px; padding: 2px 8px;
}
.muted { color: var(--ink-3); font-weight: 400; }
.b { font-weight: 700; }

/* mini progress in cells */
.cellbar { position: relative; height: 18px; background: var(--line-2); border-radius: 6px; overflow: hidden; min-width: 90px; }
.cellbar > i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 6px; background: linear-gradient(90deg, var(--teal), var(--sky)); }
.cellbar > span { position: absolute; right: 7px; top: 0; line-height: 18px; font-size: 11px; font-weight: 700; color: var(--brand); }

/* ot mini cell */
.otcell { font-weight: 700; }
.otcell small { color: var(--ink-3); font-weight: 500; font-size: 11px; }
.otcell.pre { color: var(--warn); }
.otcell.post { color: var(--royal); }

/* ============================ TIMETABLE ================================== */
.ttbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.search { position: relative; flex: 1; min-width: 200px; }
.search input { width: 100%; font-family: inherit; border: 1px solid var(--line); border-radius: 12px; padding: 11px 12px 11px 38px; font-size: 13.5px; background: var(--card); color: var(--ink); }
.search input:focus { outline: 2px solid color-mix(in srgb, var(--accent) 50%, white); border-color: var(--accent); }
.search svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); width: 17px; height: 17px; color: var(--ink-3); }
.chipgroup { display: flex; gap: 6px; flex-wrap: wrap; }
.chip { font-family: inherit; cursor: pointer; font-size: 12px; font-weight: 600; padding: 8px 13px; border-radius: 10px; border: 1px solid var(--line); background: var(--card); color: var(--ink-2); transition: all .13s; }
.chip:hover { border-color: var(--accent); }
.chip.on { background: var(--brand); color: #fff; border-color: var(--brand); }

.ttgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 13px; }
.ttcard { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 15px 16px; box-shadow: var(--shadow-sm); transition: transform .14s, box-shadow .14s; }
.ttcard:hover { transform: translateY(-2px); box-shadow: var(--shadow); }
.ttcard__hd { display: flex; align-items: center; gap: 11px; margin-bottom: 12px; }
.avatar { width: 40px; height: 40px; border-radius: 12px; flex: 0 0 auto; display: grid; place-items: center; color: #fff; font-weight: 700; font-size: 15px; background: linear-gradient(135deg, var(--royal), var(--bosch)); }
.ttcard__id { flex: 1; min-width: 0; }
.ttcard__id .nm { font-size: 14.5px; font-weight: 700; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ttcard__id .meta { font-size: 11.5px; color: var(--ink-3); display: flex; align-items: center; gap: 7px; margin-top: 1px; }
.shiftbadge { text-align: right; flex: 0 0 auto; }
.shiftbadge .code { font-size: 13px; font-weight: 800; color: var(--brand); }
.shiftbadge .time { font-size: 11px; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.ttcard__ot { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; padding: 4px 10px; border-radius: 8px; margin-bottom: 11px; }
.ttcard__ot.pre { background: #fff6e0; color: #9a6b00; }
.ttcard__ot.post { background: #e9f0fb; color: var(--royal); }
.ttcard__ot.off { background: #fdeaea; color: var(--red); }
.fstrip { display: flex; flex-direction: column; gap: 7px; }
.fstrip__item { display: flex; align-items: center; gap: 8px; background: var(--bg-2); border-radius: 10px; padding: 7px 10px; }
.fstrip__no { font-size: 12.5px; font-weight: 800; color: var(--brand); min-width: 52px; flex: 0 0 auto; }
.fstrip__task { font-size: 10px; font-weight: 700; color: #fff; background: var(--teal); border-radius: 6px; padding: 2px 7px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 92px; flex: 0 1 auto; }
.fstrip__time { margin-left: auto; font-size: 11px; color: var(--ink-2); font-variant-numeric: tabular-nums; text-align: right; flex: 0 0 auto; white-space: nowrap; }
.fstrip__time .lab { font-size: 8.5px; font-weight: 700; color: var(--ink-3); letter-spacing: .3px; display: block; }
.ttcard__empty { font-size: 12px; color: var(--ink-3); font-style: italic; padding: 6px 0; }

/* ============================ FLIGHTS / SLA ============================== */
.slabar { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-bottom: 16px; }
.slasum { display: flex; gap: 10px; }
.slasum .pill { display: flex; align-items: center; gap: 8px; padding: 9px 15px; border-radius: 12px; font-size: 13px; font-weight: 600; background: var(--card); border: 1px solid var(--line); box-shadow: var(--shadow-sm); }
.slasum .pill b { font-size: 17px; font-weight: 800; }
.slasum .pill.ok b { color: var(--good); }
.slasum .pill.bad b { color: var(--alert); }

.fltlist { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 14px; }
.boarding {
  position: relative; display: flex; background: var(--card); border: 1px solid var(--line);
  border-radius: var(--radius); overflow: hidden; box-shadow: var(--shadow-sm); transition: transform .14s, box-shadow .14s;
}
.boarding:hover { transform: translateY(-2px); box-shadow: var(--shadow); }
.boarding.short { border-color: #f3c9c9; }
.boarding__stub {
  width: 92px; flex: 0 0 auto; background: var(--header-grad); color: #fff;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 14px 8px; position: relative;
}
.boarding.short .boarding__stub { background: linear-gradient(160deg, #b3201f, var(--red)); }
.boarding__stub .ac { font-size: 22px; font-weight: 800; letter-spacing: 1px; }
.boarding__stub .acn { font-size: 8.5px; color: rgba(255,255,255,.8); text-align: center; margin-top: 3px; line-height: 1.2; font-weight: 300; }
.boarding__perf { position: absolute; right: -7px; top: 0; bottom: 0; width: 14px; background:
  radial-gradient(circle at center, var(--bg) 0 5px, transparent 5px) repeat-y; background-size: 14px 18px; }
.boarding__body { flex: 1; padding: 13px 16px 14px; min-width: 0; }
.boarding__top { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 11px; }
.boarding__fl { font-size: 18px; font-weight: 800; color: var(--ink); letter-spacing: .5px; }
.boarding__fl small { display: block; font-size: 11px; font-weight: 400; color: var(--ink-3); }
.boarding__times { text-align: right; font-size: 11px; color: var(--ink-2); }
.boarding__times .t { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--ink); font-size: 13px; }
.slastatus { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 20px; }
.slastatus.ok { background: #e3f6ee; color: var(--good); }
.slastatus.bad { background: #fdeaea; color: var(--red); }
.phases { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.phase { text-align: center; background: var(--bg-2); border-radius: 10px; padding: 8px 4px; }
.phase.short { background: #fdecec; }
.phase .pl { font-size: 9.5px; font-weight: 700; color: var(--ink-3); letter-spacing: .4px; text-transform: uppercase; }
.phase .pv { font-size: 16px; font-weight: 800; color: var(--ink); margin-top: 2px; font-variant-numeric: tabular-nums; }
.phase.short .pv { color: var(--red); }
.phase .pv span { font-size: 11px; color: var(--ink-3); font-weight: 600; }
.phase .pd { font-size: 9.5px; font-weight: 700; margin-top: 1px; }
.phase.short .pd { color: var(--red); }
.phase.full .pd { color: var(--good); }

/* ============================ FOOT ====================================== */
.foot { margin-top: 26px; text-align: center; color: var(--ink-3); font-size: 11.5px; display: flex; align-items: center; justify-content: center; gap: 8px; flex-wrap: wrap; }
.foot b { color: var(--ink-2); font-weight: 600; }

.sectionlabel { font-size: 12px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; color: var(--ink-3); margin: 22px 2px 12px; display: flex; align-items: center; gap: 10px; }
.sectionlabel::after { content: ""; flex: 1; height: 1px; background: var(--line); }

/* ============================ RESPONSIVE ================================= */
@media (max-width: 1080px) {
  .kpis { grid-template-columns: repeat(3, 1fr); }
  .attband { grid-template-columns: 1fr 1fr; }
  .attband > :first-child { grid-column: 1 / -1; }
  .grid--2, .grid--charts { grid-template-columns: 1fr; }
}
@media (max-width: 680px) {
  .wrap { padding: 14px 14px 44px; }
  .kpis { grid-template-columns: repeat(2, 1fr); }
  .attband { grid-template-columns: 1fr; }
  .brand h1 { font-size: 18px; }
  .kpi__val { font-size: 28px; }
  .fltlist, .ttgrid { grid-template-columns: 1fr; }
}

/* reveal animation (transform-only so content is never hidden if a frame freezes) */
@keyframes rise { from { transform: translateY(9px); } to { transform: none; } }
.rise { animation: rise .5s cubic-bezier(.2,.8,.2,1) both; }

/* Tweak: flat cards */
body.flat .kpi, body.flat .panel, body.flat .tablecard, body.flat .ttcard,
body.flat .boarding, body.flat .wk, body.flat .tab, body.flat .slasum .pill {
  box-shadow: none !important;
  border-color: #d4deec;
}
body.flat .panel--brand { border: 1px solid rgba(255,255,255,.2); }

/* Tweak: disable entrance motion */
body.nomotion .rise { animation: none; }

/* server-rendered additions */
canvas{max-width:100%}
.tbl td .barmini{position:relative;height:16px;background:var(--line-2);border-radius:8px;overflow:hidden;min-width:70px}
.tbl td .barmini i{position:absolute;inset:0;background:linear-gradient(90deg,var(--teal),var(--sky));border-radius:8px}
.tbl td .barmini b{position:absolute;right:6px;top:0;line-height:16px;font-size:10px;color:var(--royal);font-weight:700}
.okk{color:var(--good);font-weight:700}.badd{color:var(--red);font-weight:700}
tr.rowbad td{background:#fdecec}
.muted{color:var(--ink-3)}
@media print{.weeknav,.tabs,.btn,.ttbar{display:none}#view-tt,#view-flt,#view-dash{display:block!important}}
`;
