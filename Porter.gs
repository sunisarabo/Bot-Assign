/**
 * Porter.gs — อ่านข้อมูลงาน Porter รายวันจากไฟล์ "SEP 2026 PORTER SUMMARY"
 * (โฟลเดอร์ "2026 PORTER SUMMARY") มาแสดงในหน้าเว็บ PAS แท็บ 🧳 Porter
 *
 * โครงชีต (0-based col): 1=ที่ · 2=สายการบิน · 3=เที่ยวบิน · 4=ชื่อพอตเตอร์ · 5=สถานะ
 *  6=ETA · 7=สแตนบายขาเข้า · 8=ETD · 9=บอร์ดดิ้ง · 10=เช็ค gate(bool) · 11=LP ที่เช็ค
 *  12=ประตู · 13=ได้รับแจ้งเคส · 14=MARK(bool) · 15=เวลารับเคส · 16=ส่งเคส · 17=ประเภท Services
 *  18=ขาเข้า(bool) · 19=ขาออก(bool) · 20=ตรวจสอบแล้ว(bool) · 21=ระยะเวลารอ · 22=REMARK · 23=SEAT
 *  ตารางพอตเตอร์ (STAFF RECORD) ทางขวา: 25=NO · 26=SKED · 27=NAME · 28=CASE SUMMARY(จำนวนเคส)
 * แต่ละแถวงาน = พอตเตอร์ 1 คน/เคส (ถ้าหลายคนในเคสเดียวจะคั่นด้วย ,) · วันที่อยู่ที่ banner คอลัมน์ A
 */

var PORTER_FOLDER_ID_ = '1nd4FnsaaVZqtTJaGz9H0zpxwiJb2mzno';
var PORTER_MON_ = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
var PORTER_SVC_ = ['WCHR','WCHS','WCHC','MAAS','AVIH','ETC'];

/** หา fileId ของไฟล์สรุป Porter เดือนของวันที่ที่ระบุ (cache รายเดือนใน ScriptProperties) */
function porterMonthFileId_(date) {
  var mon = PORTER_MON_[date.getMonth()], yr = date.getFullYear();
  var prefix = mon + ' ' + yr;                    // เช่น "SEP 2026"
  var pkey = 'PORTER_FILE_' + mon + yr;
  try {
    var cached = PropertiesService.getScriptProperties().getProperty(pkey);
    if (cached) { try { DriveApp.getFileById(cached).getName(); return cached; } catch (e0) {} }  // ยังเข้าถึงได้
  } catch (eP) {}
  var found = '';
  try {
    var it = DriveApp.getFolderById(PORTER_FOLDER_ID_).getFiles();
    while (it.hasNext()) {
      var f = it.next(), nm = String(f.getName() || '').toUpperCase();
      if (nm.indexOf(prefix.toUpperCase()) === 0 && nm.indexOf('PORTER') >= 0) { found = f.getId(); break; }
    }
  } catch (eF) { throw new Error('เข้าโฟลเดอร์ Porter ไม่ได้: ' + eF.message); }
  if (found) { try { PropertiesService.getScriptProperties().setProperty(pkey, found); } catch (eS) {} }
  return found;
}

function porterInt_(v) { var n = parseInt(String(v == null ? '' : v).replace(/[^\d\-]/g, ''), 10); return isNaN(n) ? null : n; }
function porterStr_(v) { return String(v == null ? '' : v).replace(/ /g, ' ').trim(); }
function porterBool_(v) { var s = porterStr_(v).toUpperCase(); return s === 'TRUE' || s === '✓' || s === 'YES'; }
/** วันที่จาก banner คอลัมน์ A → {day,mon,yr} (รองรับ Date object, serial number, ข้อความ "01SEP26"/"1 SEP 2026"/"01-SEP-26"; ไม่สน typo เดือน เพราะยึดไฟล์รายเดือนแล้ว) */
function porterBannerDate_(v) {
  if (v instanceof Date) { return { day: v.getDate(), mon: v.getMonth(), yr: v.getFullYear() }; }
  if (typeof v === 'number' && v > 40000 && v < 60000) {          // Google Sheets date serial
    var dt = new Date(1899, 11, 30); dt.setDate(dt.getDate() + Math.floor(v));
    return { day: dt.getDate(), mon: dt.getMonth(), yr: dt.getFullYear() };
  }
  var s = porterStr_(v).toUpperCase().replace(/[\s.\-\/]/g, '');
  var m = s.match(/^(\d{1,2})([A-Z]{3})(\d{2,4})$/);              // 01SEP26 / 1SEP2026
  if (m) { var mi = PORTER_MON_.indexOf(m[2]); return { day: parseInt(m[1], 10), mon: mi >= 0 ? mi : null, yr: null }; }
  m = s.match(/^(\d{1,2})(\d{1,2})(\d{2,4})$/);                   // 190926 (ddmmyy) — เผื่อไว้
  return null;
}

/** รวมชื่อพอตเตอร์ในเซลล์ (มักเป็นชิพหลายบรรทัด/มี ,) → "A, B, C" */
function porterNames_(v) {
  return porterStr_(v).split(/[\n,\/]+/).map(function (s) { return s.trim(); }).filter(function (s) { return s; }).join(', ');
}

/** เลือกแท็บของวันที่ระบุ (แต่ละวัน = 1 แท็บ ชื่อ "19SEP26") */
function porterFindSheet_(ss, date) {
  var sheets = ss.getSheets(), day = date.getDate(), names = [];
  var exact = null, byDay = null;
  for (var i = 0; i < sheets.length; i++) {
    var nm = sheets[i].getName(); names.push(nm);
    var bd = porterBannerDate_(nm);
    if (bd && bd.day === day) { byDay = byDay || sheets[i]; if (bd.mon == null || bd.mon === date.getMonth()) exact = exact || sheets[i]; }
  }
  return { sheet: exact || byDay, names: names };
}

/** อ่านงาน Porter ของวันที่ระบุ → {found, fileName, tab, jobs[], staff[]} */
function porterReadDay_(date) {
  var fid = porterMonthFileId_(date);
  if (!fid) return { found: false, reason: 'ไม่พบไฟล์สรุป Porter ของเดือนนี้' };
  var ss = SpreadsheetApp.openById(fid), day = date.getDate();
  var pick = porterFindSheet_(ss, date);
  if (!pick.sheet) return { found: false, fileName: ss.getName(), reason: 'ไม่พบแท็บของวันที่ ' + day, tabs: pick.names };
  // ใช้ค่าที่แสดงจริง (string) → ช่องเวลาได้ "6:20" ตรง ๆ ไม่ใช่ Date 1899 · checkbox = "TRUE"/"FALSE"
  var sh = pick.sheet, V = sh.getDataRange().getDisplayValues(), W = V.length ? V[0].length : 0;

  var jobs = [], staff = [];
  for (var rr = 0; rr < V.length; rr++) {
    var row = V[rr];
    var num = porterInt_(row[1]), airline = porterStr_(row[2]);
    if (num != null && airline && airline.toUpperCase() !== 'IATA CODE') {
      jobs.push({
        no: num, airline: airline.toUpperCase(), flight: porterStr_(row[3]).replace(/^\-$/, ''),
        porter: porterNames_(row[4]), status: porterStr_(row[5]).toUpperCase(),
        eta: porterStr_(row[6]), etd: porterStr_(row[8]),
        gate: porterStr_(row[12]).replace(/^\-$/, ''), notified: porterStr_(row[13]),
        pickup: porterStr_(row[15]), delivered: porterStr_(row[16]),
        svc: porterStr_(row[17]).toUpperCase(), arr: porterBool_(row[18]), dep: porterBool_(row[19]),
        wait: porterStr_(row[21]), remark: porterStr_(row[22]), seat: porterStr_(row[23]).replace(/^\-$/, '')
      });
    }
    if (W > 27) {
      var sn = porterInt_(row[25]), nm = porterStr_(row[27]);
      if (sn != null && nm && nm.toUpperCase() !== 'NAME') staff.push({ no: sn, name: nm, cases: porterInt_(row[28]) || 0 });
    }
  }
  return { found: true, fileName: ss.getName(), tab: sh.getName(), jobs: jobs, staff: staff };
}

/** สรุปตัวเลขจากงาน Porter ของวัน */
function porterSummarize_(data) {
  var jobs = data.jobs || [], staff = data.staff || [];
  var arr = 0, dep = 0, svc = {}, air = {}, st = {}, delays = [], bands = { '05-10': [0, 0], '10-13': [0, 0], '13-17': [0, 0], '17-21': [0, 0], '21-03': [0, 0] };
  PORTER_SVC_.forEach(function (s) { svc[s] = 0; });
  function bandOf(t) { var m = String(t).match(/(\d{1,2})[:.](\d{2})/); if (!m) return null; var h = +m[1]; if (h >= 5 && h < 10) return '05-10'; if (h < 13) return '10-13'; if (h < 17) return '13-17'; if (h < 21) return '17-21'; return '21-03'; }
  jobs.forEach(function (j) {
    if (j.arr) arr++; if (j.dep) dep++;
    var sv = j.svc && svc[j.svc] != null ? j.svc : (j.svc ? 'ETC' : null); if (sv != null) svc[sv]++;
    if (j.airline) air[j.airline] = (air[j.airline] || 0) + 1;
    if (j.status) st[j.status] = (st[j.status] || 0) + 1;
    if (j.wait && !/^0+[:.]0+(?:[:.]0+)?$/.test(j.wait)) delays.push(j);
    var b = bandOf(j.arr ? j.eta : (j.dep ? j.etd : (j.eta || j.etd)));
    if (b) { if (j.arr) bands[b][0]++; else bands[b][1]++; }
  });
  var airArr = Object.keys(air).map(function (a) { return { airline: a, n: air[a] }; }).sort(function (a, b) { return b.n - a.n; });
  var staffActive = staff.filter(function (s) { return s.cases > 0; }).length;
  var topStaff = staff.slice().sort(function (a, b) { return b.cases - a.cases; });
  return {
    total: jobs.length, arr: arr, dep: dep, svc: svc, air: airArr, status: st, delays: delays, bands: bands,
    staffN: staff.length, staffActive: staffActive, topStaff: topStaff,
    completed: st['COMPLETED'] || 0, onProcess: st['ON PROCESS'] || 0, standby: st['STANDBY'] || 0
  };
}

/** Lazy tab: หน้า Porter (เรียกจาก client) */
function rbPorterHtml(iso) {
  try {
    var date = rbDateFromIso_(iso);
    var ck = 'PORTER_HTML_' + iso, cache = null;
    try { cache = CacheService.getScriptCache(); var h = cache.get(ck); if (h) return h; } catch (eC) {}
    var data = porterReadDay_(date);
    var html = rbPorterCss_() + '<div class="tablecard"><div class="tablecard__hd"><h3>🧳 งาน Porter รายวัน';
    if (!data.found) {
      // เคสจริงของ Porter ดูล่วงหน้าไม่ได้ (บันทึกเฉพาะวันที่ทำงานจริง) — แต่ยอดจองรถเข็นล่วงหน้า (Pre-WC) ดูล่วงหน้าได้
      var pwAhead = ''; try { pwAhead = prewcPanelHtml_(date); } catch (ePWa) { pwAhead = ''; }
      html += ' <span class="tt-cnt">ดูล่วงหน้า</span></h3></div><div style="padding:8px 16px 18px">' +
        '<div class="panel muted" style="text-align:center;padding:18px;box-shadow:none">📋 เคสจริงของ Porter ดูล่วงหน้าไม่ได้ — บันทึกเฉพาะวันที่ทำงานจริง' +
        (data.reason ? '<div style="margin-top:4px;font-size:12px">' + rbEsc_(data.reason) + '</div>' : '') + '</div>' +
        (pwAhead || '<div class="muted" style="padding:10px 2px">วันนี้ยังไม่มีการจองรถเข็นล่วงหน้า</div>') +
        '</div></div>';
      return html;
    }
    var S = porterSummarize_(data);
    html += ' <span class="tt-cnt">' + S.total + ' รายการ · ' + S.staffActive + '/' + S.staffN + ' พอตเตอร์ทำงาน</span></h3>' +
      '<div style="margin-left:auto;font-size:12px;color:#64748b">ที่มา: ' + rbEsc_(data.fileName) + ' · แท็บ ' + rbEsc_(data.tab || '') + '</div></div>' +
      '<div style="padding:0 16px 18px">';
    // KPI
    function kp(big, lbl, tone) { return '<div class="pt-kpi ' + (tone || '') + '"><div class="pt-big">' + big + '</div><div class="pt-lbl">' + lbl + '</div></div>'; }
    html += '<div class="pt-bar">' +
      kp(S.total, 'เคสทั้งหมด') + kp(S.arr, 'ขาเข้า (ARR)') + kp(S.dep, 'ขาออก (DEP)') +
      kp(S.svc.WCHR + '/' + S.svc.WCHS + '/' + S.svc.WCHC, 'WCHR/S/C') +
      kp(S.svc.MAAS + '/' + S.svc.AVIH, 'MAAS/AVIH') +
      kp(S.staffActive, 'พอตเตอร์ที่ทำงาน') + '</div>';
    // สถานะ
    html += '<div class="pt-status">✅ COMPLETED ' + S.completed + ' · 🔄 ON PROCESS ' + S.onProcess + ' · ⏸️ STANDBY ' + S.standby + '</div>';
    // กราฟ Porter รายชั่วโมง
    try { html += porterHourlyChart_(data); } catch (ePH) {}
    // Pre-book Wheelchair (จองล่วงหน้า)
    try { html += prewcPanelHtml_(date); } catch (ePW) {}

    // ตารางสายการบิน + พอตเตอร์ (2 คอลัมน์)
    var airRows = S.air.map(function (a) { return '<tr><td class="b">' + rbEsc_(a.airline) + '</td><td class="tnum">' + a.n + '</td></tr>'; }).join('') || '<tr><td colspan="2" class="muted">—</td></tr>';
    var airTbl = rbTblCard_('✈️ เคสตามสายการบิน', '<tr><th>สายการบิน</th><th>เคส</th></tr>', airRows);
    var stRows = S.topStaff.map(function (s) {
      var w = S.topStaff[0] && S.topStaff[0].cases ? Math.round(s.cases / S.topStaff[0].cases * 100) : 0;
      return '<tr><td class="b">' + rbEsc_(s.name) + '</td><td class="tnum">' + s.cases + '</td>' +
        '<td style="min-width:90px"><div class="pt-track"><div class="pt-fill" style="width:' + w + '%"></div></div></td></tr>';
    }).join('') || '<tr><td colspan="3" class="muted">—</td></tr>';
    var stTbl = rbTblCard_('🧑‍✈️ เคสต่อพอตเตอร์ (STAFF RECORD)', '<tr><th>ชื่อ</th><th>เคส</th><th></th></tr>', stRows);
    html += '<div class="pt-grid">' + airTbl + stTbl + '</div>';

    // ช่วงเวลา
    var bandRows = Object.keys(S.bands).map(function (b) { var x = S.bands[b]; return '<tr><td class="b">' + b + '</td><td class="tnum">' + x[0] + '</td><td class="tnum">' + x[1] + '</td><td class="tnum">' + (x[0] + x[1]) + '</td></tr>'; }).join('');
    html += rbTblCard_('🕐 กระจายตามช่วงเวลา', '<tr><th>ช่วงเวลา</th><th>ARR</th><th>DEP</th><th>รวม</th></tr>', bandRows);

    // รายการงานทั้งหมด (พับได้)
    var jRows = data.jobs.map(function (j) {
      var dir = j.arr ? '<span class="pt-tag arr">ARR</span>' : (j.dep ? '<span class="pt-tag dep">DEP</span>' : '');
      var stc = j.status === 'COMPLETED' ? 'ok' : (j.status === 'ON PROCESS' ? 'proc' : 'sb');
      return '<tr><td class="tnum">' + j.no + '</td><td class="b">' + rbEsc_(j.airline) + '</td><td>' + rbEsc_(j.flight) + '</td>' +
        '<td>' + dir + '</td><td>' + rbEsc_(j.svc) + '</td><td>' + rbEsc_(j.porter) + '</td>' +
        '<td class="tnum">' + rbEsc_(j.eta || j.etd || '-') + '</td><td class="tnum">' + rbEsc_(j.gate || '-') + '</td>' +
        '<td class="tnum">' + rbEsc_(j.pickup || '-') + ' → ' + rbEsc_(j.delivered || '-') + '</td>' +
        '<td><span class="pt-st ' + stc + '">' + rbEsc_(j.status) + '</span></td><td>' + rbEsc_(j.remark) + '</td></tr>';
    }).join('');
    html += '<details class="pt-det"><summary>📋 รายการงาน Porter ทั้งหมด (' + data.jobs.length + ')</summary>' +
      '<div class="pt-detbox">' + rbTblCard_('', '<tr><th>#</th><th>สาย</th><th>ไฟลท์</th><th>ทิศ</th><th>บริการ</th><th>พอตเตอร์</th><th>เวลา</th><th>ประตู</th><th>รับ→ส่ง</th><th>สถานะ</th><th>หมายเหตุ</th></tr>', jRows) + '</div></details>';

    html += '</div></div>';
    try { if (cache) cache.put(ck, html, 300); } catch (eP) {}
    return html;
  } catch (e) {
    return '<div class="panel">โหลดข้อมูล Porter ไม่ได้: ' + rbEsc_((e && (e.message || e.toString())) || 'unknown') + '</div>';
  }
}

/** การ์ดสรุปเคส Porter สำหรับ Dashboard หลัก (โหลด lazy) */
function rbPorterCardHtml(iso) {
  try {
    var date = rbDateFromIso_(iso), ck = 'PORTER_CARD_' + iso, cache = null;
    try { cache = CacheService.getScriptCache(); var h = cache.get(ck); if (h != null) return h; } catch (eC) {}
    var out = rbPorterCard_(date);
    try { if (cache) cache.put(ck, out, 300); } catch (eP) {}
    return out;
  } catch (e) { return ''; }
}
function rbPorterCard_(date) {
  function kp(big, lbl, tone) { return '<div class="pt-kpi ' + (tone || '') + '"><div class="pt-big">' + big + '</div><div class="pt-lbl">' + lbl + '</div></div>'; }
  var data; try { data = porterReadDay_(date); } catch (e) { data = { found: false }; }
  var preN = null; try { preN = prewcDayTotal_(date); } catch (ePW) { preN = null; }
  if (!data || !data.found) {
    // เคสจริงดูล่วงหน้าไม่ได้ → ถ้ามียอดจองล่วงหน้า (Pre-WC) ก็ยังโชว์ได้
    var body = (preN != null && preN > 0)
      ? '<div style="padding:4px 16px 14px"><div class="pt-bar">' + kp(preN, '♿ Pre-WC จอง') + '</div>' +
        '<div class="muted" style="font-size:12px">เคสจริงของ Porter ดูล่วงหน้าไม่ได้ — แสดงเฉพาะยอดจองรถเข็นล่วงหน้า</div></div>'
      : '<div style="padding:12px 18px" class="muted">ยังไม่มีข้อมูล Porter ของวันนี้' + (data && data.reason ? ' (' + rbEsc_(data.reason) + ')' : '') + '</div>';
    return rbPorterCss_() + '<div class="tablecard"><div class="tablecard__hd"><h3>🧳 เคส Porter วันนี้</h3>' +
      '<button class="btn" style="margin-left:auto" onclick="showView(\'porter\');loadPorter()">เปิดแท็บ →</button></div>' + body + '</div>';
  }
  var S = porterSummarize_(data);
  var top = S.air.slice(0, 5).map(function (a) { return '<span class="pt-airchip">' + rbEsc_(a.airline) + ' <b>' + a.n + '</b></span>'; }).join('');
  var pre = (preN != null) ? kp(preN, '♿ Pre-WC จอง') : '';
  return rbPorterCss_() +
    '<div class="tablecard"><div class="tablecard__hd"><h3>🧳 เคส Porter วันนี้ <span class="tt-cnt">' + rbEsc_(data.tab || '') + '</span></h3>' +
    '<button class="btn" style="margin-left:auto" onclick="showView(\'porter\');loadPorter()">ดูทั้งหมด →</button></div>' +
    '<div style="padding:4px 16px 16px">' +
    '<div class="pt-bar">' + kp(S.total, 'เคสทั้งหมด') + kp(S.arr, 'ขาเข้า') + kp(S.dep, 'ขาออก') +
    kp(S.svc.WCHR + '/' + S.svc.WCHS + '/' + S.svc.WCHC, 'WCHR/S/C') + pre +
    kp(S.staffActive, 'พอตเตอร์ทำงาน') + '</div>' +
    (top ? '<div class="pt-airrow">สายที่ใช้มาก: ' + top + '</div>' : '') +
    '</div></div>';
}

/** กราฟ Porter รายชั่วโมง (SVG): พอตเตอร์ที่กำลังทำเคส (แท่ง) + เคสที่ดำเนินอยู่ (เส้น) · 27 ช่อง 00:00→03:00 */
function porterHourlyChart_(data) {
  function pm(s) { var m = String(s || '').match(/(\d{1,2})[:.](\d{2})/); return m ? (+m[1] * 60 + +m[2]) : null; }
  var cases = [], porters = []; for (var h = 0; h < 27; h++) { cases.push(0); porters.push({}); }
  (data.jobs || []).forEach(function (j) {
    var a = pm(j.pickup), b = pm(j.delivered); if (a == null) return;
    if (b == null) b = a + 30; if (b < a) b += 1440;
    var names = String(j.porter || '').split(/[,/]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    for (var h = 0; h < 27; h++) { var lo = h * 60, hi = lo + 60; if (Math.min(b, hi) - Math.max(a, lo) > 0) { cases[h]++; names.forEach(function (nm) { porters[h][nm] = 1; }); } }
  });
  var pcnt = porters.map(function (o) { return Object.keys(o).length; });
  var maxC = 1, maxP = 1; for (var i = 0; i < 27; i++) { maxC = Math.max(maxC, cases[i]); maxP = Math.max(maxP, pcnt[i]); }
  var maxY = Math.max(maxC, maxP);
  var W = 960, HT = 220, padL = 30, padR = 8, padT = 16, padB = 24, cw = W - padL - padR, ch = HT - padT - padB, gw = cw / 27, bw = Math.min(15, gw - 3);
  function y(v) { return padT + ch - v / maxY * ch; }
  var bars = '', pts = [], ticks = '', grid = '', hovers = '';
  for (var g = 0; g <= 4; g++) { var gy = padT + ch - g / 4 * ch; grid += '<line x1="' + padL + '" y1="' + gy.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + gy.toFixed(1) + '" stroke="#eef2f7"/><text x="' + (padL - 4) + '" y="' + (gy + 3).toFixed(1) + '" font-size="8.5" fill="#94a3b8" text-anchor="end">' + Math.round(maxY * g / 4) + '</text>'; }
  for (var h2 = 0; h2 < 27; h2++) {
    var cx = padL + h2 * gw + gw / 2, gx = cx - bw / 2;
    bars += '<rect x="' + gx.toFixed(1) + '" y="' + y(pcnt[h2]).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, pcnt[h2] / maxY * ch).toFixed(1) + '" fill="#bcdcc9" rx="1.5"/>';
    if (pcnt[h2] > 0) bars += '<text x="' + cx.toFixed(1) + '" y="' + (y(pcnt[h2]) - 3).toFixed(1) + '" font-size="8" fill="#3f7a5c" text-anchor="middle" font-weight="700">' + pcnt[h2] + '</text>';
    pts.push(cx.toFixed(1) + ',' + y(cases[h2]).toFixed(1));
    if (cases[h2] > 0) bars += '<circle cx="' + cx.toFixed(1) + '" cy="' + y(cases[h2]).toFixed(1) + '" r="2.2" fill="#e8842a"/>';
    if (h2 % 3 === 0 || h2 === 26) ticks += '<text x="' + cx.toFixed(1) + '" y="' + (HT - 7) + '" font-size="9" fill="#64748b" text-anchor="middle">' + ('0' + (h2 % 24)).slice(-2) + '</text>';
    var tp = ('0' + (h2 % 24)).slice(-2) + ':00–' + ('0' + ((h2 + 1) % 24)).slice(-2) + ':00¦พอตเตอร์ที่กำลังทำเคส ' + pcnt[h2] + ' คน¦เคสที่ดำเนินอยู่ ' + cases[h2];
    hovers += '<rect x="' + (padL + h2 * gw).toFixed(1) + '" y="' + padT + '" width="' + gw.toFixed(1) + '" height="' + ch + '" fill="transparent" data-tip="' + rbAttr_(tp) + '"/>';
  }
  var svg = '<svg viewBox="0 0 ' + W + ' ' + HT + '" width="100%" style="max-width:100%;height:auto" xmlns="http://www.w3.org/2000/svg">' + grid + bars + '<polyline points="' + pts.join(' ') + '" fill="none" stroke="#e8842a" stroke-width="1.6"/>' + ticks + hovers + '</svg>';
  var legend = '<div style="display:flex;gap:14px;font-size:12px;color:#64748b;margin-top:2px;flex-wrap:wrap">' +
    '<span><i style="display:inline-block;width:11px;height:11px;background:#bcdcc9;border-radius:2px;vertical-align:-1px"></i> พอตเตอร์ที่กำลังทำเคส</span>' +
    '<span><i style="display:inline-block;width:14px;height:3px;background:#e8842a;vertical-align:2px"></i> เคสที่ดำเนินอยู่</span>' +
    '<span style="margin-left:auto">🖱️ ชี้แต่ละชั่วโมงเพื่อดูตัวเลข</span></div>';
  return '<div class="pt-prewc" style="background:#f7fbf8;border-color:#cfe6d8"><div class="pt-prewc-hd">🕐 Porter รายชั่วโมง — คนทำเคส vs เคสที่ดำเนินอยู่</div>' + legend + svg + '</div>';
}

/** ปุ่มเมนู/ทดสอบใน editor */
function porterDayTest() {
  var d = porterReadDay_(new Date());
  Logger.log(JSON.stringify({ found: d.found, file: d.fileName, tab: d.tab || '', reason: d.reason || '', tabs: d.tabs || null, jobs: (d.jobs || []).length, staff: (d.staff || []).length, sample: (d.jobs || []).slice(0, 3) }, null, 2));
}

/** วินิจฉัยชีต Porter: ลิสต์ชื่อแท็บทั้งหมด + parse เป็นวันได้ไหม */
function porterDiag_() {
  var date = new Date(), fid = porterMonthFileId_(date);
  if (!fid) { Logger.log('ไม่พบไฟล์เดือนนี้'); return; }
  var ss = SpreadsheetApp.openById(fid), sheets = ss.getSheets();
  var out = sheets.map(function (s) { var bd = porterBannerDate_(s.getName()); return { tab: s.getName(), parsedDay: bd ? bd.day : null, mon: bd ? bd.mon : null }; });
  Logger.log('FILE: ' + ss.getName() + ' · ' + sheets.length + ' แท็บ · วันนี้=' + date.getDate());
  Logger.log(JSON.stringify(out, null, 2));
}

function rbPorterCss_() {
  return '<style>' +
    '.pt-bar{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0}' +
    '.pt-kpi{flex:1;min-width:104px;background:#f6f8fb;border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px;text-align:center}' +
    '.pt-kpi.warn{background:#fff4e6;border-color:#f0c479}' +
    '.pt-big{font-size:21px;font-weight:800;color:#1f4e79;line-height:1.15}' +
    '.pt-lbl{font-size:11px;color:#64748b;margin-top:3px;font-weight:600}' +
    '.pt-status{font-size:12.5px;color:#334155;margin:2px 0 12px;font-weight:600}' +
    '.pt-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}' +
    '@media(max-width:820px){.pt-grid{grid-template-columns:1fr}}' +
    '.pt-track{height:14px;background:#eef2f7;border-radius:5px;overflow:hidden}' +
    '.pt-fill{height:100%;background:#7ecfa0;border-radius:5px}' +
    '.pt-tag{font:700 9.5px/1 monospace;padding:2px 5px;border-radius:4px}' +
    '.pt-tag.arr{background:#e7f0ff;color:#2b5cc0}.pt-tag.dep{background:#fdeede;color:#b26a10}' +
    '.pt-st{font-size:10.5px;font-weight:700;padding:1px 6px;border-radius:5px}' +
    '.pt-st.ok{background:#e6f6ec;color:#1c7a4f}.pt-st.proc{background:#fff4e0;color:#b26a10}.pt-st.sb{background:#eef2f7;color:#64748b}' +
    '.pt-det{margin-top:12px;border:1px solid #e2e8f0;border-radius:12px;background:#fff}' +
    '.pt-det>summary{cursor:pointer;padding:11px 15px;font-weight:700;color:#1f4e79}' +
    '.pt-detbox{padding:0 12px 12px;overflow-x:auto}' +
    '.pt-detbox td.r,.pt-track+td{color:#c0392b;font-weight:700}' +
    '.pt-airrow{font-size:12.5px;color:#475569;font-weight:600;display:flex;flex-wrap:wrap;gap:6px;align-items:center}' +
    '.pt-airchip{background:#eef2ff;color:#3b5bdb;border-radius:20px;padding:2px 10px;font-size:12px}' +
    '.pt-airchip b{color:#1f2d5c}' +
    '.pt-prewc{margin:14px 0 4px;padding:12px 14px;border:1px solid #dbe7f3;border-radius:12px;background:#f4f9ff}' +
    '.pt-prewc-hd{font-weight:800;color:#1f4e79;font-size:14px;margin-bottom:2px}' +
    '.pt-prewc .pt-kpi{background:#fff;border-color:#dbe7f3}' +
    '</style>';
}
