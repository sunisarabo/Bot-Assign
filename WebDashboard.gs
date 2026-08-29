/**
 * WebDashboard.gs — AOTGA Daily Manpower Dashboard web app (doGet).
 * =============================================================================
 * Visual design adopted from the AOTGA dashboard design system (corporate CI,
 * Kanit, appbar / week nav / KPI hero / panels / tables). Server-rendered so it
 * runs as an Apps Script web app. Deploy → Web app → open the /exec URL.
 * Requires RosterReader.gs / LLReader.gs / MasterReader.gs / RosterBot.gs / SLA.gs.
 */

var AOTGA_LOGO_URL = '';          // ใส่ URL รูป/data-URI ตรงๆ ได้ (มาก่อน)
var PWMS_LOGO_ID   = '1Ya7VigvuEutlL3oECJQj8dJkiM2of30i';   // Google Drive file ID ของโลโก้ AOTGA → สคริปต์อ่าน+แปลง base64 ให้เอง (cache 6 ชม.)
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
    if (MASTER_FILE_ID_RB) {   // (ง) cache ไฟล์รายชื่อแยก TTL ยาว (1 ชม.) — เปลี่ยนไม่บ่อย ไม่ต้องเปิดไฟล์ซ้ำทุกครั้ง
      var mkey = 'master_hc_' + MASTER_FILE_ID_RB;
      var mc = null; try { mc = rbCacheGetBig_(mkey); } catch (eMc) {}
      if (mc) { try { master = JSON.parse(mc); } catch (eMp) {} }
      if (!master) { try { master = readMasterHeadcount(MASTER_FILE_ID_RB); if (master) rbCachePutBig_(mkey, JSON.stringify(master), RB_MASTER_TTL); } catch (e4) {} }
    }
    html = rbBuildDashboardHtml_(d.res, d.ll, master, date, iso, base, tz);
  } catch (err) {
    html = '<!doctype html><html><head><meta charset="utf-8"><style>' + rbDesignCss_() + '</style></head>' +
      '<body><div class="wrap">' + rbWeekNav_(date, iso, base, tz) +
      '<div class="panel" style="text-align:center;padding:40px"><h2>⚠️ ไม่มีข้อมูลของวันที่ ' + rbEsc_(iso) + '</h2>' +
      '<p class="muted" style="margin-top:8px">' + rbEsc_(err.message) + '</p>' +
      '<p class="muted">ยังไม่มีไฟล์ assignment ของวันนี้ หรือบัญชีไม่มีสิทธิ์ — เลือกวันอื่นจากแถบด้านบน</p></div></div></body></html>';
  }
  return HtmlService.createHtmlOutput(html).setTitle('PAS · PSA-HKT Assignment System')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Load the PSA roster (+ LL) for a date — cached ~3 นาที (CacheService) เพื่อให้สลับแท็บเร็ว
 *  ไม่ต้องไล่หาไฟล์ใน Drive / แปลง xlsx / parse ซ้ำทุกแท็บ · กดปุ่ม 🔄 รีเฟรช = ล้างแคชดึงใหม่ */
function rbLoadResLL_(date) {
  var tz = Session.getScriptTimeZone() || 'Asia/Bangkok';
  var iso = Utilities.formatDate(date, tz, 'yyyy-MM-dd');
  var hit = rbCacheGetBig_('resll_' + iso);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  // Cache เย็น: ล็อกให้ "อ่านชีตทีละคน" — กันหลายคนเปิดพร้อมกันแล้วอ่าน 20 ชีตซ้อนกัน (ช้า/quota/พัง)
  //  คนแรกอ่าน+เขียน cache · คนที่รอ พอได้ล็อกจะเจอ cache ที่คนแรกเพิ่งเติม → คืนเลย ไม่อ่านซ้ำ
  var lock = LockService.getScriptLock(), got = false;
  try { got = lock.tryLock(20000); } catch (eL) { got = false; }
  if (got) {
    var hit2 = rbCacheGetBig_('resll_' + iso);
    if (hit2) { try { lock.releaseLock(); return JSON.parse(hit2); } catch (e) {} }
  }
  var out = rbLoadResLLraw_(date);
  try { rbCachePutBig_('resll_' + iso, JSON.stringify(out), rbResllTtl_(iso)); } catch (e2) {}
  if (got) { try { lock.releaseLock(); } catch (e3) {} }
  return out;
}
/** อายุ cache: วันที่ผ่านมา (ข้อมูลไม่เปลี่ยนแล้ว) เก็บยาว 6 ชม. · วันนี้/อนาคต 30 นาที (ยังแก้ได้)
 *  → เปิดหน้าวันเก่า/สรุปสัปดาห์ (อ่าน 7 วัน) เร็วขึ้นมาก ครั้งแรกอ่าน ครั้งต่อไปดึงจาก cache */
function rbResllTtl_(iso) {
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Bangkok', 'yyyy-MM-dd');
  return (iso < today) ? RB_RESLL_TTL_PAST : RB_RESLL_TTL;
}
var RB_RESLL_TTL = 1800;  // (ก) อายุ cache ข้อมูลรายวัน — 30 นาที (trigger อุ่นทุก 5 นาที · กด 🔄 เมื่ออยากเห็นสด)
var RB_RESLL_TTL_PAST = 21600; // วันที่ผ่านมา — 6 ชม. (สูงสุดของ CacheService · ข้อมูลอดีตไม่เปลี่ยน)
var RB_MASTER_TTL = 3600; // (ง) ไฟล์รายชื่อ (master) — 1 ชม. · RB_SCHED_TTL = ตารางบิน
var RB_SCHED_TTL = 3600;  // (ง) ตารางบินสัปดาห์ต่อวัน — 1 ชม. (เปลี่ยนไม่บ่อย ไม่ต้องเปิดไฟล์ซ้ำ)

/** อุ่น cache ของ "วันนี้" ไว้ล่วงหน้า — ผู้ใช้เปิดหน้าเว็บจะได้ข้อมูลทันที ไม่ต้องรออ่าน 20 ชีต
 *  (เทียบเท่า "background process" ในระบบใหญ่ · GAS ใช้ time-driven trigger แทน worker) */
function rbWarmCache() {
  try {
    var tz = Session.getScriptTimeZone() || 'Asia/Bangkok';
    var now = new Date();
    var iso = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    var out = rbLoadResLLraw_(now);                       // อ่านสด (ข้าม cache) แล้วเขียนทับให้สด
    rbCachePutBig_('resll_' + iso, JSON.stringify(out), RB_RESLL_TTL);
    // อุ่น "เมื่อวาน" ด้วย ถ้า cache เย็น (อ่านครั้งเดียวต่อ 6 ชม.) — หน้าเมื่อวาน + สรุปสัปดาห์เร็วขึ้น
    try {
      var yst = new Date(now.getTime() - 86400000);
      var yiso = Utilities.formatDate(yst, tz, 'yyyy-MM-dd');
      if (!rbCacheGetBig_('resll_' + yiso)) rbCachePutBig_('resll_' + yiso, JSON.stringify(rbLoadResLLraw_(yst)), RB_RESLL_TTL_PAST);
    } catch (ey) {}
    return 'warmed ' + iso;
  } catch (e) { return 'warm error: ' + e; }
}
/** ตั้ง trigger อุ่น cache ทุก 5 นาที (เรียกครั้งเดียวจาก editor) — ทำให้เว็บเร็ว+เสถียรตอนมีคนเปิดหลายคน */
function rbInstallWarmCache() {
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'rbWarmCache'; });
  if (!has) ScriptApp.newTrigger('rbWarmCache').timeBased().everyMinutes(5).create();
  rbWarmCache();
  return 'ตั้ง trigger อุ่น cache ทุก 5 นาที + อุ่นรอบแรกแล้ว';
}
/** หยุด trigger อุ่น cache */
function rbStopWarmCache() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'rbWarmCache') ScriptApp.deleteTrigger(t); });
  return 'หยุด trigger อุ่น cache แล้ว';
}
/** {red,green,blue} (0-1) จาก Sheets API → "#rrggbb" (ว่าง = ขาว) */
function rbRgbToHex_(c) {
  if (!c) return '#ffffff';
  function h(x) { var v = Math.round((x == null ? 1 : x) * 255); return ('0' + v.toString(16)).slice(-2); }
  return '#' + h(c.red) + h(c.green) + h(c.blue);
}
/** อ่านทั้งไฟล์ (ทุกแท็บ + ค่า + สีพื้น + ขีดฆ่า) ด้วย Advanced Sheets API ครั้งเดียว → คืน ss จำลอง
 *  (แทน ~60 การอ่าน SpreadsheetApp ด้วย 1 API call · reader เดิมใช้งานได้เหมือน ss จริง) */
var RB_FAST_CHUNK = 4;    // ดึงทีละ 4 ชีต/คำขอ
var RB_FAST_ROWS = 200;   // อ่านสูงสุด 200 แถว/ชีต (ข้อมูลจริงสุด SU=134 · CHN=130 · เกินพอ · กัน OOM จากแถวว่างที่ถูกจัดรูปแบบเป็นพัน)
var RB_FAST_COLS = 'DZ';  // อ่านถึงคอลัมน์ DZ (=130) พอสำหรับบล็อกเคาน์เตอร์ SU (~111) และไฟลท์ CHN (~123)
/** อ่านทั้งไฟล์ผ่าน Advanced Sheets API แบบ "แบ่งก้อน" — กัน includeGridData ก้อนเดียวใหญ่เกิน
 *  จน API ตัดชีตท้าย ๆ ทิ้งเงียบ ๆ (rowData ว่าง → getLastRow=0 → ทีมหายไปจากระบบ เช่น SU/ท้ายไฟล์)
 *  ครบทุกชีตค่อยคืน · ถ้าได้ไม่ครบ → throw ให้ rbLoadResLLraw_ fallback ไปอ่านแบบปกติ (SpreadsheetApp)
 *  ดึงเฉพาะ formattedValue (ไม่ดึงสีพื้น/ขีดฆ่า) เพื่อกัน OOM — การยกเลิกไฟลท์ยังจับจากข้อความ CXL/CANCEL ได้ */
function rbFastSheets_(ssId) {
  var meta = Sheets.Spreadsheets.get(ssId, { fields: 'sheets(properties(title))' });
  var titles = ((meta && meta.sheets) || []).map(function (s) { return s.properties.title; });
  if (!titles.length) throw new Error('fast read: ไม่พบชีต');
  var FLD = 'sheets(properties(title),data(rowData(values(formattedValue))))';
  function a1(t) { return "'" + String(t).replace(/'/g, "''") + "'!A1:" + RB_FAST_COLS + RB_FAST_ROWS; }   // แถว 1..N · คอลัมน์ A..DZ
  var raw = [];
  for (var i = 0; i < titles.length; i += RB_FAST_CHUNK) {
    var chunk = titles.slice(i, i + RB_FAST_CHUNK);
    var resp = Sheets.Spreadsheets.get(ssId, { ranges: chunk.map(a1), includeGridData: true, fields: FLD });
    ((resp && resp.sheets) || []).forEach(function (sh) { if (sh && sh.properties) raw.push(sh); });
  }
  if (raw.length < titles.length) throw new Error('fast read ไม่ครบ: ' + raw.length + '/' + titles.length + ' ชีต');
  var sheets = raw.map(function (sh) {
    var title = sh.properties.title;
    var grid = (sh.data && sh.data[0] && sh.data[0].rowData) || [];
    var nRows = grid.length, nCols = 0;
    grid.forEach(function (r) { if (r.values && r.values.length > nCols) nCols = r.values.length; });
    function cel(r, c) { var row = grid[r - 1]; return (row && row.values) ? row.values[c - 1] : null; }
    function val(r, c) { var x = cel(r, c); return (x && x.formattedValue != null) ? x.formattedValue : ''; }
    function bg(r, c) { var x = cel(r, c); var f = x && x.effectiveFormat; return f ? rbRgbToHex_(f.backgroundColor) : '#ffffff'; }
    function ln(r, c) { var x = cel(r, c); var t = x && x.effectiveFormat && x.effectiveFormat.textFormat; return (t && t.strikethrough) ? 'line-through' : 'none'; }
    function blk(fn, r0, c0, nr, nc) { var o = []; for (var i = 0; i < nr; i++) { var row = []; for (var j = 0; j < nc; j++) row.push(fn(r0 + i, c0 + j)); o.push(row); } return o; }
    return {
      getName: function () { return title; },
      getLastRow: function () { return nRows; },
      getLastColumn: function () { return nCols || 1; },
      getRange: function (r, c, nr, nc) {
        nr = nr || 1; nc = nc || 1;
        // ไม่ได้ดึงสีพื้น/ขีดฆ่า (กัน OOM) → คืน [] · rrFlightCancelled_ มี guard รองรับ (ยกเลิกไฟลท์ยังจับจากข้อความได้)
        return { getValues: function () { return blk(val, r, c, nr, nc); }, getValue: function () { return val(r, c); },
          getBackgrounds: function () { return []; }, getFontLines: function () { return []; } };
      },
      getDataRange: function () { return { getValues: function () { return blk(val, 1, 1, nRows || 1, nCols || 1); } }; }
    };
  });
  var byName = {}; sheets.forEach(function (s) { byName[s.getName()] = s; });
  return { getSheets: function () { return sheets; }, getSheetByName: function (n) { return byName[n] || null; } };
}
function rbLoadResLLraw_(date) {
  var roster = rbOpenTodayRoster_(date);
  var ss = roster.ss;
  // (ข) batch-read: ดึงทั้งไฟล์ครั้งเดียวผ่าน Advanced Sheets API (เร็วกว่ามากตอน cold) · พังเมื่อไหร่ fallback อ่านปกติ
  try { if (typeof Sheets !== 'undefined' && Sheets.Spreadsheets) ss = rbFastSheets_(roster.ss.getId()); } catch (eFast) { ss = roster.ss; }
  var res = readRosterFromSpreadsheet(ss, date);
  // แท็บ "COUNTER" ในไฟล์ตารางเวรเอง (อ่านก่อนลบไฟล์ชั่วคราว) — วิธีที่ไม่ต้องแชร์ไฟล์ท่า
  res.counters = null;
  try { res.counters = counterReadFromRoster_(ss); } catch (e4) {}   // ใช้ ss ที่ดึงมาแล้ว (ไม่อ่านซ้ำ)
  if (roster.tempId) { try { DriveApp.getFileById(roster.tempId).setTrashed(true); } catch (e) {} }
  var ll = null;
  if (CONFIG_RB.LL_FILE_ID) { try { ll = readLLForDate(CONFIG_RB.LL_FILE_ID, date); } catch (e2) {} }
  // ถ้าไม่มีแท็บ COUNTER ในไฟล์เวร → ลองไฟล์ COUNTER CHECK ของท่า (ต้องแชร์ให้บัญชีที่รัน)
  if (!res.counters && CONFIG_RB.COUNTER_FILE_ID) { try { res.counters = counterReadForDate(CONFIG_RB.COUNTER_FILE_ID, date); } catch (e3) {} }
  // เติมเวลาเปิด-ปิดเคาน์เตอร์จริงจากท่า ลง assignment (ถ้าชีตเวรไม่ได้กรอก OP/CL)
  //  → coverage คิดจากเวลาเปิดจริง (เช่น เปิด 09:50 คนเข้า 09:00 = ครอบคลุม) ไม่ใช่ประมาณ STD−180
  if (res.counters) { try { rbApplyCounterTimes_(res); } catch (e5) {} }
  try { rbDedupeTeams_(res, ll); } catch (eD) {}           // รหัสซ้ำหลายทีม (คนไปช่วย) → เก็บที่ต้นสังกัด ไม่นับซ้ำ
  try { rbResolveSupportTeams_(res, ll); } catch (e6) {}   // แถวซัพที่ไม่มีรหัสทีม → ค้นทีมต้นสังกัดจากชื่อในเวรทั้งวัน
  // ตารางบินสัปดาห์ (source of truth) → เติม A/C TYPE + STA/STD · (ง) cache ต่อวัน TTL 1 ชม. (ไม่เปิดไฟล์ซ้ำ)
  if (typeof wfFileId_ === 'function' && wfFileId_()) {
    var iso2 = Utilities.formatDate(date, Session.getScriptTimeZone() || 'Asia/Bangkok', 'yyyy-MM-dd');
    var skey = 'wfsched_' + iso2;
    var sc = null; try { sc = rbCacheGetBig_(skey); } catch (eSc) {}
    if (sc) { try { res._sched = JSON.parse(sc); } catch (eSp) {} }
    if (res._sched == null) { try { res._sched = wfLoadSchedule_(wfFileId_(), date) || null; rbCachePutBig_(skey, JSON.stringify(res._sched), RB_SCHED_TTL); } catch (e7) {} }
  }
  // MODE เคาน์เตอร์ (ปกติ/Common check-in) ที่ Duty ใส่เองในฟอร์ม (แถว 2) → อ่านมาแนบกับ res
  try { if (typeof formModeIndex_ === 'function' && ss) res._flightMode = formModeIndex_(ss); } catch (e8) {}
  return { res: res, ll: ll };
}
/** ชื่อ → คีย์เทียบ (คำแรก ตัวพิมพ์ใหญ่ ตัด (…) ออก) — ใช้จับคู่คนข้ามทีม */
function rbNameKey_(name) {
  var s = String(name || '').trim().toUpperCase().split(/[\s(]/)[0];
  return s.length >= 3 ? s : '';
}
/** แถวซัพพอร์ตที่ไม่มีรหัสทีมต้นสังกัด → ค้นชื่อในเวรทั้งวัน (แถวปกติ ไม่ใช่ซัพ)
 *  เจอในทีมเดียวชัดเจน → ใส่ทีมให้อัตโนมัติ (supportTeamAuto) · เจอหลายทีม/ไม่เจอ → คงเตือน (กันเดาผิด) */
function rbResolveSupportTeams_(res, ll) {
  var idx = {};
  function add(team, r) {
    if (r.support) return;                                  // ดัชนีจากแถว "ตัวจริง" ของทีมเท่านั้น
    var k = rbNameKey_(r.name); if (!k) return;
    (idx[k] = idx[k] || {})[team] = 1;
  }
  Object.keys(res.teams).forEach(function (t) { (res.teams[t].records || []).forEach(function (r) { add(t, r); }); });
  if (ll && ll.sections) Object.keys(ll.sections).forEach(function (s) { (ll.sections[s].records || []).forEach(function (r) { add('LL·' + s, r); }); });
  var unresolved = [];
  function resolve(recvTeam, r) {
    if (!r.support || r.supportTeam) return;
    var k = rbNameKey_(r.name); if (!k) return;
    var teams = Object.keys(idx[k] || {}).filter(function (t) { return t !== recvTeam; });
    if (teams.length === 1) { r.supportTeam = teams[0]; r.supportTeamAuto = true; }   // ชัดเจนทีมเดียว → ใส่ให้
    else unresolved.push({ recv: recvTeam, r: r, k: k });                             // ไม่เจอ/กำกวมในเวรวันนี้ → ลองไฟล์ master ต่อ
  }
  Object.keys(res.teams).forEach(function (t) { (res.teams[t].records || []).forEach(function (r) { resolve(t, r); }); });
  if (ll && ll.sections) Object.keys(ll.sections).forEach(function (s) { (ll.sections[s].records || []).forEach(function (r) { resolve('LL·' + s, r); }); });
  // ชั้น 2: ค้นทีมต้นสังกัดจากไฟล์รายชื่อพนักงาน (master · Pax Manpower)
  if (unresolved.length && MASTER_FILE_ID_RB && typeof rbMasterNameTeam_ === 'function') {
    var midx = {}; try { midx = rbMasterNameTeam_(MASTER_FILE_ID_RB); } catch (em) { midx = {}; }
    unresolved.forEach(function (u) {
      if (u.r.supportTeam) return;
      var teams = Object.keys(midx[u.k] || {}).filter(function (t) { return t !== u.recv; });
      if (teams.length === 1) { u.r.supportTeam = teams[0]; u.r.supportTeamAuto = true; u.r.supportTeamSrc = 'master'; }
    });
  }
  // ชั้น 3: ตารางแมปแก้เอง (Master_Mapping) — คนเติมเคสที่เหลือได้เอง (เช่น KUNNIDA)
  var stillLeft = unresolved.filter(function (u) { return !u.r.supportTeam; });
  if (stillLeft.length && MASTER_FILE_ID_RB && typeof rbMasterMapping_ === 'function') {
    var mmap = {}; try { mmap = rbMasterMapping_(MASTER_FILE_ID_RB); } catch (e7) { mmap = {}; }
    stillLeft.forEach(function (u) {
      var ovr = mmap[u.k] || mmap[String(u.r.name || '').trim().toUpperCase()];
      if (ovr) { u.r.supportTeam = ovr; u.r.supportTeamAuto = true; u.r.supportTeamSrc = 'map'; }
    });
  }
}
/** คำนวณ agg รายทีม/ตำแหน่ง/รวม ใหม่จาก records (ข้ามแถว support) — ใช้หลังมาร์ค support เพิ่ม */
function rbRecomputeAgg_(res) {
  var totals = rrNewAgg_(), positions = {};
  Object.keys(res.teams).forEach(function (t) {
    var tm = res.teams[t], recs = tm.records || [], sd = tm.sheetDate;
    var a = rrNewAgg_(); a.records = recs; if (sd != null) a.sheetDate = sd;
    recs.forEach(function (r) {
      var isHol = !!r.isHoliday, pg = r.posGroup || 'PSA';
      rrAddBucket_(a, r, isHol);
      if (!positions[pg]) positions[pg] = rrNewAgg_();
      rrAddBucket_(positions[pg], r, isHol);
      rrAddBucket_(totals, r, isHol);
    });
    rrRoundAgg_(a); res.teams[t] = a;
  });
  Object.keys(positions).forEach(function (p) { rrRoundAgg_(positions[p]); });
  rrRoundAgg_(totals); delete totals.records;
  res.positions = positions; res.totals = totals;
}
/** เลือก "ทีมต้นสังกัด" ของรหัสที่โผล่หลายทีม: master (ชื่อ→ทีม) ก่อน · ไม่งั้นแถวที่ "เป็นตัวจริงกว่า" (ทำงาน+มีกะ+OT+งาน) */
function rbPickHome_(arr, midx) {
  var teams = arr.map(function (x) { return x.team; });
  for (var i = 0; i < arr.length; i++) {
    var k = rbNameKey_(arr[i].r.name), mt = k ? Object.keys(midx[k] || {}) : [];
    if (mt.length === 1 && teams.indexOf(mt[0]) >= 0) return mt[0];   // master ชี้ทีมเดียวที่ตรง → ทีมนั้นคือ home
  }
  function score(x) { var r = x.r, s = 0; if (r.bucket === 'working') s += 4; else if (r.bucket === 'ot_off') s += 3; if (r.shiftStart != null) s += 2; if (r.ot > 0) s += 1; s += (r.assignments ? r.assignments.length : 0) * 0.1; return s; }
  var best = arr[0]; arr.forEach(function (x) { if (score(x) > score(best)) best = x; });
  return best.team;
}
/** รหัสเดียวโผล่หลายทีม (คนไปช่วยทีมอื่นแต่ถูกใส่เป็นแถวเต็ม) → เก็บที่ทีมต้นสังกัด · ทีมที่เหลือมาร์คเป็น support (ไม่นับซ้ำ) แล้วคิดยอดใหม่ */
function rbDedupeTeams_(res, ll) {
  var idMap = {};
  function collect(teamKey, r) {
    if (r.support) return;
    var id = String(r.id || '').replace(/\D/g, '');
    if (!/^\d{6,8}$/.test(id)) return;
    (idMap[id] = idMap[id] || []).push({ team: teamKey, r: r });
  }
  Object.keys(res.teams).forEach(function (t) { (res.teams[t].records || []).forEach(function (r) { collect(t, r); }); });
  if (ll && ll.sections) Object.keys(ll.sections).forEach(function (s) { (ll.sections[s].records || []).forEach(function (r) { collect('LL·' + s, r); }); });
  var midx = null, changed = 0;
  Object.keys(idMap).forEach(function (id) {
    var arr = idMap[id], tset = {}; arr.forEach(function (x) { tset[x.team] = 1; });
    if (Object.keys(tset).length < 2) return;
    if (midx === null) { midx = {}; if (typeof MASTER_FILE_ID_RB !== 'undefined' && MASTER_FILE_ID_RB && typeof rbMasterNameTeam_ === 'function') { try { midx = rbMasterNameTeam_(MASTER_FILE_ID_RB); } catch (e) { midx = {}; } } }
    var home = rbPickHome_(arr, midx);
    arr.forEach(function (x) {
      if (x.team === home) return;
      x.r.support = true; x.r.supportTeam = home; x.r.supportTeamAuto = true; x.r.supportTeamSrc = 'dup'; changed++;
    });
  });
  if (changed) rbRecomputeAgg_(res);
  return changed;
}
/** เติม a.OP/a.CL จากเวลาเปิด-ปิดเคาน์เตอร์ของท่า (เฉพาะที่ชีตเวรไม่ได้กรอกไว้) */
function rbApplyCounterTimes_(res) {
  Object.keys(res.teams).forEach(function (t) {
    (res.teams[t].records || []).forEach(function (r) {
      (r.assignments || []).forEach(function (a) {
        if (a.OP && a.OP !== '00:00') return;                       // ชีตกรอกเวลาเปิดเองแล้ว → เคารพ
        var ct = counterTimesForFlight_(res.counters, a.flight);
        if (ct && ct.op) { a.OP = ct.op; if (ct.cl && (!a.CL || a.CL === '00:00')) a.CL = ct.cl; }
      });
    });
  });
}
/** CacheService แบบแบ่งชิ้น (รองรับค่า >100KB) */
function rbCachePutBig_(key, str, ttl) {
  var c = CacheService.getScriptCache(), CH = 95000, n = Math.ceil(str.length / CH), parts = {};
  parts[key + '_n'] = String(n);
  for (var i = 0; i < n; i++) parts[key + '_' + i] = str.substr(i * CH, CH);
  c.putAll(parts, ttl || 180);
}
function rbCacheGetBig_(key) {
  var c = CacheService.getScriptCache(), nn = c.get(key + '_n');
  if (!nn) return null;
  var n = +nn, keys = [];
  for (var i = 0; i < n; i++) keys.push(key + '_' + i);
  var got = c.getAll(keys), s = '';
  for (var j = 0; j < n; j++) { var v = got[key + '_' + j]; if (v == null) return null; s += v; }
  return s;
}
/** ล้างแคชของวันที่นั้น (เรียกจากปุ่ม 🔄 รีเฟรช) */
function rbClearCache(iso) {
  try {
    var c = CacheService.getScriptCache(), keys = [];
    // ล้างทุก cache ที่เกี่ยวกับวันนั้น + master + ตารางบิน (ให้ 🔄 ดึงสดจริง)
    ['resll_' + iso, 'wfsched_' + iso, 'master_hc_' + MASTER_FILE_ID_RB].forEach(function (base) {
      var nn = c.get(base + '_n'); keys.push(base + '_n');
      if (nn) for (var i = 0; i < +nn; i++) keys.push(base + '_' + i);
    });
    c.removeAll(keys);
  } catch (e) {}
  return true;
}
function rbDateFromIso_(iso) { var a = String(iso).split('-'); return new Date(+a[0], +a[1] - 1, +a[2]); }

/** Sheet → PDF blob (server-side · ผ่าน export URL + OAuth) — landscape/fit-width ให้เต็มหน้า */
function rbSheetToPdfBlob_(ssId, gid, name) {
  var url = 'https://docs.google.com/spreadsheets/d/' + ssId + '/export?format=pdf'
    + '&size=A4&portrait=false&fitw=true&scale=2&gridlines=false&printtitle=false&sheetnames=false'
    + '&pagenumbers=true&fzr=true&top_margin=0.4&bottom_margin=0.4&left_margin=0.4&right_margin=0.4'
    + (gid != null ? '&gid=' + gid : '');
  var resp = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (resp.getResponseCode() >= 300) throw new Error('export PDF ไม่สำเร็จ (' + resp.getResponseCode() + ')');
  return resp.getBlob().setName((name || 'export') + '.pdf');
}

/** สร้าง PDF ตารางกำลังพล/มอบหมายงานรายวัน จากไฟล์ assignment จริง → บันทึกไฟล์บน Drive · คืน URL
 *  (server-side: ไม่ต้องผ่านกล่องพิมพ์ browser · เหมาะกับแนบส่ง/เก็บอัตโนมัติ) */
function rbExportDayPdf(iso) {
  var date = iso ? rbDateFromIso_(iso) : new Date();
  var dd = rbLoadResLL_(date);
  if (!dd || !dd.res) throw new Error('ไม่มีข้อมูล assignment ของวันที่ ' + iso);
  var owner = acOwnerTeams_(dd.res, dd.ll);
  var WMAX = (typeof AC_WIN_MAX !== 'undefined') ? AC_WIN_MAX : 840;
  var head = ['ทีม', 'ชื่อ', 'ตำแหน่ง', 'กะ (เข้า-ออก)', 'OT', 'ไฟลท์ / งานที่ได้รับมอบหมาย'];
  var rows = [head], nWork = 0;
  function jobsOf(r) {
    return (r.assignments || []).filter(function (x) { return x.flight && !(typeof acIsJunkFlight_ === 'function' && acIsJunkFlight_(x.flight)); })
      .map(function (x) {
        var w = (typeof acFlightWin_ === 'function') ? acFlightWin_(x) : null; if (w && w[1] - w[0] > WMAX) w = null;
        var tm = w ? ' ' + rrFmtMin_(((w[0] % 1440) + 1440) % 1440) + '-' + rrFmtMin_(((w[1] % 1440) + 1440) % 1440) : '';
        var jb = x.task ? ' [' + String(x.task).replace(/\s+/g, ' ').trim() + ']' : '';
        var ow = (typeof acIsFlight_ === 'function' && acIsFlight_(x.flight)) ? owner[slaAirlineOf_(x.flight)] : '';
        var sup = (ow && ow !== r._team) ? ' ⟵ซัพ' : '';
        return x.flight + jb + tm + sup;
      }).join('   ·   ');
  }
  function addRec(team, r) {
    if (r.bucket !== 'working' && r.bucket !== 'ot_off') return;
    nWork++; r._team = team;
    var ot = r.ot > 0 ? (r.ot + 'h ' + (r.bucket === 'ot_off' ? 'OFF' : (r.otType === 'PRE' ? 'ก่อนกะ' : 'หลังกะ')) + (r.otTime ? ' ' + r.otTime : '')) : '-';
    rows.push([team, r.name || '', slaPosShort_(r.posGroup || r.pos || ''), (r.shiftTime || r.shift || '-'), ot, jobsOf(r) || '—']);
  }
  Object.keys(dd.res.teams).sort().forEach(function (t) {
    dd.res.teams[t].records.slice().sort(function (a, b) { return (a.shiftStart == null ? 99999 : a.shiftStart) - (b.shiftStart == null ? 99999 : b.shiftStart); })
      .forEach(function (r) { addRec(t, r); });
  });
  if (dd.ll && dd.ll.totals && dd.ll.totals.staff > 0) Object.keys(dd.ll.sections).forEach(function (s) { dd.ll.sections[s].records.forEach(function (r) { addRec('LL·' + s, r); }); });
  if (rows.length === 1) throw new Error('วันที่ ' + iso + ' ไม่มีคนขึ้นงานในไฟล์ assignment');

  var ss = rbCreateSheet_('PAS Assignment ' + iso);
  var sh = ss.getSheets()[0]; sh.setName('Assignment');
  sh.getRange(1, 1, 1, head.length).merge().setValue('PAS · ตารางมอบหมายงานรายวัน — ' + iso + ' · คนขึ้นงาน ' + nWork + ' คน')
    .setFontSize(13).setFontWeight('bold').setBackground('#1f4e79').setFontColor('#fff').setHorizontalAlignment('left');
  sh.getRange(2, 1, rows.length, head.length).setValues(rows).setVerticalAlignment('top').setFontSize(9).setWrap(true);
  sh.getRange(2, 1, 1, head.length).setFontWeight('bold').setBackground('#dce9f7').setFontColor('#1f4e79');
  [70, 150, 70, 95, 130, 620].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(2);
  SpreadsheetApp.flush();
  var blob = rbSheetToPdfBlob_(ss.getId(), sh.getSheetId(), 'PAS_Assignment_' + iso);
  var pdf = DriveApp.createFile(blob);
  try { DriveApp.getFileById(ss.getId()).setTrashed(true); } catch (e) {}   // ลบชีตชั่วคราว เหลือแต่ PDF
  return pdf.getUrl();
}

/** โลโก้: ใช้ AOTGA_LOGO_URL (URL/data-URI) ก่อน · ไม่งั้นอ่านจาก Google Drive (PWMS_LOGO_ID / Script Property)
 *  แปลงเป็น base64 data-URI แล้ว cache 6 ชม. (สคริปต์มีสิทธิ์ Drive อยู่แล้ว) */
function rbLogoDataUri_() {
  if (AOTGA_LOGO_URL) return AOTGA_LOGO_URL;
  var id = PWMS_LOGO_ID;
  if (!id) { try { id = PropertiesService.getScriptProperties().getProperty('PWMS_LOGO_ID') || ''; } catch (e) {} }
  if (!id) return '';
  var hit = rbCacheGetBig_('pwms_logo'); if (hit) return hit;
  try {
    var b = DriveApp.getFileById(id).getBlob();
    var uri = 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes());
    try { rbCachePutBig_('pwms_logo', uri, 21600); } catch (e2) {}
    return uri;
  } catch (e3) { return ''; }
}

/** Lazy tab: Timetable HTML (called from client via google.script.run). */
function rbTimetableHtml(iso) {
  try {
    var d = rbLoadResLL_(rbDateFromIso_(iso));
    var P = d.res.totals, L = d.ll && d.ll.totals.staff>0 ? d.ll.totals : null;
    var onDuty = (P.working+P.ot_off) + (L?(L.working+L.ot_off):0);
    var head = '<div class="tablecard__hd"><h3>🕓 ตารางงานรายคน <span class="tt-cnt">' + onDuty + ' คนปฏิบัติงาน</span></h3>' +
      '<div style="margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
      '<input id="gtSearch" class="gt-search" placeholder="🔍 ค้นหาชื่อ/ทีม…" oninput="gtFilter()">' +
      '<button class="btn" id="gtOffBtn" onclick="gtOff()">🙈 ซ่อนคนหยุด</button>' +
      '<button class="btn" id="gtToggle" onclick="gtView()">📋 มุมมองตาราง</button></div></div>';
    // เส้นเวลาปัจจุบัน — เฉพาะเมื่อดูวันที่ = วันนี้ (ตามเขต Asia/Bangkok)
    var nowMin = -1;
    try { var nw = new Date(), tz = Session.getScriptTimeZone(); if (Utilities.formatDate(nw, tz, 'yyyy-MM-dd') === iso) nowMin = +Utilities.formatDate(nw, tz, 'H') * 60 + +Utilities.formatDate(nw, tz, 'm'); } catch (eN) {}
    var gantt = '<div id="gtWrap">' + rbTtGantt_(d.res, d.ll, nowMin) + '</div>';
    var table = '<div id="gtTable" style="display:none">' + rbTblCard_('',
      '<tr><th>ทีม</th><th>รหัส</th><th>ชื่อ</th><th>ตำแหน่ง</th><th>กะ (เข้า-ออก)</th><th>OT</th><th>#</th><th>เที่ยวบิน</th></tr>',
      rbTtRows_(d.res, d.ll), '') + '</div>';
    return '<style>' + rbVIEW_CSS_ + '</style>' + rbGanttCss_() +
      '<div class="tablecard">' + head + '<div style="padding:0 16px 16px">' +
      rbCtrls_('view-tt', false) + gantt + table + '</div></div>';
  } catch (e) { return '<div class="panel">โหลด Timetable ไม่ได้: ' + rbEsc_(e.message) + '</div>'; }
}
/** Lazy tab: Flights & SLA HTML. */
function rbFlightsHtml(iso) {
  try {
    var d = rbLoadResLL_(rbDateFromIso_(iso));
    var flts = slaCollectFlights_(d.res, d.ll).filter(function(f){ return !(f.noTime && f.fragment); });
    var ok = flts.filter(function(f){ return f.ok && !f.noTime; }).length;
    return '<style>' + rbVIEW_CSS_ + '</style>' +
      '<div class="tablecard"><div class="tablecard__hd"><h3>✈️ ไฟลท์บินประจำวัน + เช็ค SLA <span class="tt-cnt">'+flts.length+' ไฟลท์ · '+ok+' ครบ</span></h3></div>' +
      '<div style="padding:0 18px 16px">' + rbCtrls_('view-flt', true) + rbFltCards_(d.res, d.ll) + '</div></div>';
  } catch (e) { return '<div class="panel">โหลด Flights ไม่ได้: ' + rbEsc_((e && (e.message || e.stack || e.toString())) || 'unknown') + '</div>'; }
}

/** Lazy tab: ตรวจความเหมาะสมการ Assign (ครอบคลุมไฟลท์ / OT / ช่วงว่าง). */
function rbAssignHtml(iso) {
  try {
    var d = rbLoadResLL_(rbDateFromIso_(iso));
    var an = acAnalyze_(d.res, d.ll), s = an.summary;
    var okN = (s.checked - s.bad - s.warn);
    var hd = '<style>#view-ac .acok{display:none}</style>' +
      '<div class="sectionlabel">ตรวจ <b>' + s.checked + '</b>/' + s.working +
      ' คนที่มาทำงาน · <b class="badd">🔴 ไฟลท์นอกเวลา/ขาด OT ' + s.bad + '</b> · 🟡 ควรตรวจ ' + s.warn +
      ' · <span class="okk">✅ ครบ ' + (okN < 0 ? 0 : okN) + '</span> · OT อาจเกิน ' + s.otMuch + ' · มีช่วงว่าง ' + s.gap +
      ' · <span class="muted">ไม่มีไฟลท์ ' + s.noFlt + ' (bench/standby)</span>' +
      (s.noWin ? ' · <span class="muted">ไม่มีเวลากะ ' + s.noWin + '</span>' : '') +
      ' <label style="margin-left:8px;font-weight:600;cursor:pointer;white-space:nowrap"><input type="checkbox" class="acshowok" onchange="applyFilter(\'view-ac\')" style="vertical-align:-2px"> แสดงทีมที่ครบ (✅) ทุกคน</label>' +
      '<div class="muted" style="font-size:11px;margin-top:2px">เลือกทีมจาก dropdown เพื่อดูทั้งทีม (รวมคนที่จัดครบ) · โดยปกติแสดงเฉพาะที่ต้องแก้</div></div>';
    var rows = an.rows.map(function (r) {
      var emo = r.status === 'bad' ? '🔴' : (r.status === 'warn' ? '🟡' : (r.status === 'nowin' ? '⚪' : '✅'));
      var okCls = (r.status === 'ok' || r.status === 'nowin') ? ' acok' : '';   // แถว "ครบ/ตรวจไม่ได้" — ซ่อนโดยปริยาย เปิดดูได้
      return '<tr class="' + (r.status === 'bad' ? 'rowbad' : '') + okCls + '" data-status="' + r.status + '" data-team="' + rbEsc_(r.team) + '" data-gaps="' + rbEsc_(r.gapsRaw || '') + '"><td>' + emo + '</td><td class="b">' +
        rbEsc_(r.team) + '</td><td class="tnum">' + rbEsc_(r.id || '') + '</td><td>' + rbEsc_(r.name) + '</td><td>' + rbEsc_(r.pos) + '</td><td class="tnum">' +
        rbEsc_(r.shift) + '</td><td>' + (r.ot && r.ot !== '-' ? rbEsc_(r.ot) : '<span class="muted">—</span>') + '</td><td>' + rbEsc_(r.flights) + '</td><td>' +
        (rbEsc_(r.job) || '<span class="muted">—</span>') + '</td><td class="' + (r.uncovered ? 'badd' : 'muted') + '">' +
        (rbEsc_(r.uncovered) || '—') + '</td><td>' + (rbEsc_(r.gaps) || '<span class="muted">—</span>') + '</td><td>' +
        (rbEsc_(r.otVerdict) || '<span class="muted">—</span>') + '</td><td>' + rbEsc_(r.issue) + '</td></tr>';
    }).join('');
    if (!rows) rows = '<tr><td colspan="13" class="okk" style="text-align:center;padding:20px">✅ ไม่พบการ Assign ที่ผิดปกติ — ทุกคนเวลากะครอบคลุมไฟลท์และ OT เหมาะสม</td></tr>';
    return hd + rbTblCard_('🧭 ตรวจความเหมาะสมการ Assign รายคน',
      '<tr><th>สถานะ</th><th>ทีม</th><th>รหัส</th><th>ชื่อ</th><th>ตำแหน่ง</th><th>กะ (เข้า-ออก)</th><th>OT</th><th>ไฟลท์</th><th>ไฟลท์ที่ทำ</th>' +
      '<th>ไฟลท์นอกเวลา</th><th>ช่วงว่าง</th><th>OT เหมาะสม?</th><th>ปัญหา/คำแนะนำ</th></tr>',
      rows, rbCtrls_('view-ac', true) + rbGapCtrl_('view-ac'));
  } catch (e) { return '<div class="panel">โหลดตรวจ Assign ไม่ได้: ' + rbEsc_(e.message) + '</div>'; }
}

function rbEsc_(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function rbAttr_(s){ return rbEsc_(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function rbOtTxt_(n,h){ return n>0 ? (n+' <span class="muted">('+h+'h)</span>') : '·'; }

/** chip คนที่ถูกจัด: ชื่อ "แก้ไขได้" (contenteditable) + คลิกที่ตำแหน่ง/ℹ ดูงาน/OT/ไฟลท์ (popup) */
function rbPlanChip_(p) {
  var busyCls = p.n >= 5 ? ' sup--busy' : (p.n === 0 ? ' sup--free' : '');
  return '<span class="chip chip--duty supchip planchip' + busyCls + '"' +
    ' data-nm="' + rbAttr_(p.name) + '" data-pos="' + rbAttr_(p.pos) + '" data-pteam="' + rbAttr_(p.team) + '"' +
    ' data-shift="' + rbAttr_(p.shift || '-') + '" data-ot="' + rbAttr_(p.ot || '-') + '" data-hrs="' + (p.hrs || 0) + '" data-n="' + (p.n || 0) + '"' +
    ' data-flts="' + rbAttr_((p.flts || []).join('‖')) + '">' +
    '<span class="editnm" contenteditable="true" spellcheck="false" onclick="event.stopPropagation()"' +
    ' oninput="var c=this.closest(\'.supchip\');c.dataset.nm=this.textContent;c.classList.add(\'edited\')" title="' + rbAttr_(p.name) + ' · คลิกแก้ไข">' + rbEsc_(p.name) + '</span>' +
    '<span class="planchip__i" onclick="showPsn(this.closest(\'.supchip\'))" title="ดูงาน/OT/ไฟลท์ที่ทำ"> ' + rbEsc_(p.pos) + ' ⓘ</span></span>';
}

/** กลุ่มรายชื่อคน (จัดกลุ่มตามทีม) เป็น chip แบบแก้ไขได้ + มี popup งาน/OT/ไฟลท์ */
function rbPlanNames_(arr) {
  if (!arr || !arr.length) return '<span class="muted">—</span>';
  var by = {}, order = [];
  arr.forEach(function (p) { if (!by[p.team]) { by[p.team] = []; order.push(p.team); } by[p.team].push(p); });
  return order.map(function (t) {
    return '<span class="supgrp"><span class="supgrp__t">' + rbEsc_(t) + ' ' + by[t].length + '</span>' +
      by[t].map(rbPlanChip_).join('') + '</span>';
  }).join('');
}

/** แผง "เพิ่มคนพิเศษ" — เลือกไฟลท์/ตำแหน่ง/จำนวน เพื่อขอคนเสริมเกินจาก SLA (เช่น เกทบอร์ดดิ้งคนเยอะ) */
function rbFillExtraPanel_(allFlights, exReq) {
  var flOpts = (allFlights || []).map(function (fl) { return '<option value="' + rbEsc_(fl) + '">' + rbEsc_(fl) + '</option>'; }).join('');
  var phOpts = AP_PHASES.map(function (ph) { return '<option value="' + ph + '">' + rbEsc_(SLA_PH_LB[ph]) + '</option>'; }).join('');
  var chips = '';
  Object.keys(exReq || {}).forEach(function (fl) {
    AP_PHASES.forEach(function (ph) {
      var n = +(exReq[fl] || {})[ph] || 0;
      if (n) chips += '<span class="tag">➕ ' + rbEsc_(fl) + ' · ' + rbEsc_(SLA_PH_LB[ph]) + ' +' + n + ' <a href="#" onclick="fillDropExtra(\'' + rbEsc_(fl) + '\',\'' + ph + '\');return false" style="text-decoration:none;color:#b00">✕</a></span> ';
    });
  });
  return '<div class="panel" style="margin:8px 0;padding:10px 12px;background:#f3f8ff;border:1px solid #cfe0f5;border-radius:10px">' +
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
    '<b>➕ เพิ่มคนพิเศษ</b>' +
    ' <span class="muted">เลือกไฟลท์ที่ต้องใช้คนเยอะ (เช่น เกทบอร์ดดิ้ง) แล้วระบบหาคนว่างข้ามทีมมาเสริม<u>เพิ่มจาก SLA</u></span></div>' +
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">' +
    'ไฟลท์ <select id="exflt" class="namepick">' + flOpts + '</select>' +
    ' ตำแหน่ง <select id="exph" class="namepick">' + phOpts + '</select>' +
    ' จำนวน <input id="exn" type="number" min="1" value="1" class="namepick" style="width:64px">' +
    ' <button class="btn btn--accent" onclick="fillAddExtra()">➕ เพิ่มคน</button>' +
    (chips ? ' <button class="btn" onclick="fillClearExtra()">ล้างทั้งหมด</button>' : '') +
    '</div>' +
    (chips ? '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">' + chips + '</div>' : '') +
    '</div>';
}

/** Lazy tab 1: 🤖 เติมจาก Assign เดิม (โหมด A — gap-fill) */
function rbFillPlanHtml(iso, fcJson, exJson) {
  try {
    var fcBy = {}; try { fcBy = fcJson ? JSON.parse(fcJson) : {}; } catch (e0) {}
    var exReq = {}; try { exReq = exJson ? JSON.parse(exJson) : {}; } catch (e1) {}
    var d = rbLoadResLL_(rbDateFromIso_(iso));
    var gaps = apFillGaps_(d.res, d.ll, fcBy, exReq);
    var filledN = 0, remainN = 0, extraN = 0;
    gaps.forEach(function (g) { filledN += g.picked.length; remainN += g.remain; extraN += (g.extra || 0); });
    var hd = '<div class="sectionlabel" style="background:#eef6ff;border-left:4px solid #1f4e79;padding:8px 12px;border-radius:8px">📋 <b>เติมจาก Assign เดิม</b> — จัดคนว่างข้ามทีมมาเสริมไฟลท์ที่ขาด · เสริม <b class="okk">' + filledN + ' คน</b>' +
      (extraN ? ' · <b class="okk">รวมคนพิเศษ ' + extraN + ' คน</b>' : '') +
      (remainN ? ' · <b class="badd">ยังขาด ' + remainN + ' คน</b>' : ' · ครบ ✅') + ' <span class="muted">(คลิกชื่อเพื่อแก้ไข · คลิก ⓘ ดูงาน/OT/ไฟลท์)</span></div>';
    var exPanel = rbFillExtraPanel_(gaps.allFlights || [], exReq);
    var bodyA = gaps.map(function (g) {
      var who = g.noSupport ? '<span class="badd">🚫 ' + rbEsc_(g.noSupport) + '</span>'
              : (g.picked.length ? rbPlanNames_(g.picked) : '<span class="badd">' + (g.needSys ? 'ไม่มีคนว่างที่รู้ระบบ ' + rbEsc_(g.needSys) : 'ไม่มีคนว่าง') + '</span>');
      var st = g.noSupport ? '<span class="badd">🚫 ใช้คนทีมตัวเอง</span>'
             : (g.remain === 0 ? '<span class="okk">✅ เติมครบ</span>' : (g.picked.length ? '<span class="badd">⚠️ ยังขาด ' + g.remain + '</span>' : '<span class="badd">🔴 ขาด ' + g.remain + '</span>'));
      var phCell = g.base ? '<span class="badd">' + rbEsc_(g.phase) + ' ขาด ' + g.base + '</span>' : '<span class="muted">' + rbEsc_(g.phase) + '</span>';
      if (g.extra) phCell += ' <span class="tag">➕ พิเศษ ' + g.extra + '</span>';
      return '<tr class="' + (g.remain ? 'rowbad' : (g.extra ? 'rowextra' : '')) + '" data-team="' + rbEsc_(g.airline) + '"><td class="b">' + rbEsc_(g.flight) +
        '</td><td>' + rbEsc_(g.airline) + '</td><td class="tnum">' + rbEsc_(g.std) + '</td><td>' + phCell +
        '</td><td class="tnum">' + rbEsc_(g.win) + '</td><td>' + rbEsc_(g.needSys || 'iPort/ใดก็ได้') + '</td><td>' + who + '</td><td>' + st + '</td></tr>';
    }).join('');
    if (!bodyA) bodyA = '<tr><td colspan="8" class="okk" style="text-align:center;padding:20px">✅ ทุกไฟลท์ส่งพนักงานครบตาม SLA แล้ว — ไม่ต้องเสริม (เพิ่มคนพิเศษได้ที่แผงด้านบน)</td></tr>';
    return hd + exPanel + rbExpBar_('fill') + rbCommonsHtml_(gaps.commons, 'fill') + rbTblCard_('🤖 เติมคนเสริมไฟลท์ที่ขาด (ข้ามทีม)',
      '<tr><th>Flight</th><th>สายการบิน</th><th>STD/STA</th><th>ตำแหน่งที่ขาด</th><th>ช่วงเวลา</th><th>ระบบที่ต้องใช้</th><th>คนที่จัดให้</th><th>สถานะ</th></tr>',
      bodyA, rbCtrls_('view-fill', true));
  } catch (e) { return '<div class="panel">โหลด "เติม Assign เดิม" ไม่ได้: ' + rbEsc_(e.message) + '</div>'; }
}

/** Lazy tab 2: 🤖 Auto Assign (โหมด B — จัดใหม่ทั้งหมด) */
function rbAutoAssignHtml(iso, fcJson) {
  try {
    var fcBy = {}; try { fcBy = fcJson ? JSON.parse(fcJson) : {}; } catch (e0) {}
    var d = rbLoadResLL_(rbDateFromIso_(iso));
    var rp = apReplan_(d.res, d.ll, fcBy);
    var shortF = 0;
    rp.plan.forEach(function (p) { if (Object.keys(p.shortx).length) shortF++; });
    var hd = '<div class="sectionlabel" style="background:#eef6ff;border-left:4px solid #1f4e79;padding:8px 12px;border-radius:8px">📋 <b>Auto Assign</b> — จัดเวรใหม่ทั้งหมดตาม SLA · จัดคน <b>' + rp.nAssigned + '/' + rp.nPeople +
      '</b> ลง <b>' + rp.nFlights + '</b> ไฟลท์ · พัก ' + rp.bench.length + ' คน' + (shortF ? ' · <b class="badd">' + shortF + ' ไฟลท์ยังขาด</b>' : ' · ครบ ✅') +
      ' <span class="muted">(คลิกชื่อเพื่อแก้ไข · คลิก ⓘ ดูงาน/OT/ไฟลท์)</span></div>';
    function cellB(arr, req, shortN) {
      if (!req) return '<span class="muted">— ไม่มี</span>';                // เช่น PG ไม่มีเช็คอิน
      return '<div><b>' + arr.length + '/' + req + '</b> ' + (shortN ? '<span class="badd">⚠️-' + shortN + '</span>' : '<span class="okk">✓</span>') +
        '</div>' + rbPlanNames_(arr);
    }
    var bodyB = rp.plan.map(function (p) {
      var ok = Object.keys(p.shortx).length === 0;
      return '<tr class="' + (ok ? '' : 'rowbad') + '" data-team="' + rbEsc_(p.airline) + '"><td class="b">' + rbEsc_(p.flight) +
        '</td><td>' + rbEsc_(p.airline) + '</td><td>' + rbEsc_(p.system || 'iPort') + '</td><td class="tnum">' + rbEsc_(p.sta) + '</td><td class="tnum">' + rbEsc_(p.std) +
        '</td><td>' + cellB(p.assign.SUP, p.phaseReq.SUP, p.shortx.SUP) + '</td><td>' + cellB(p.assign.CI, p.phaseReq.CI, p.shortx.CI) +
        '</td><td>' + cellB(p.assign.GATE, p.phaseReq.GATE, p.shortx.GATE) + '</td><td>' + cellB(p.assign.ARR, p.phaseReq.ARR, p.shortx.ARR) + '</td></tr>';
    }).join('');
    if (!bodyB) bodyB = '<tr><td colspan="9" class="muted" style="text-align:center;padding:20px">— ไม่มีไฟลท์</td></tr>';
    var tblB = rbTblCard_('🤖 จัดเวรใหม่ทั้งหมดตาม SLA',
      '<tr><th>Flight</th><th>สายการบิน</th><th>ระบบ</th><th>STA</th><th>STD</th><th>SUP</th><th>Check-in</th><th>Gate</th><th>Arrival</th></tr>',
      bodyB, rbCtrls_('view-auto', true));

    var benchHtml = '';
    if (rp.bench.length) {
      var by = {}, ord = [];
      rp.bench.forEach(function (b) { if (!by[b.team]) { by[b.team] = []; ord.push(b.team); } by[b.team].push(b); });
      benchHtml = '<div class="tablecard" style="margin-top:14px"><div class="tablecard__hd"><h3>😴 คนพัก/สำรอง (ยังไม่ถูกจัด) — ' + rp.bench.length + ' คน</h3></div>' +
        '<div style="padding:10px 14px">' + ord.map(function (t) {
          return '<span class="supgrp"><span class="supgrp__t">' + rbEsc_(t) + ' ' + by[t].length + '</span>' +
            by[t].map(function (p) { return '<span class="chip">' + rbEsc_(p.name) + ' <span class="muted">' + rbEsc_(p.pos) + '</span></span>'; }).join('') + '</span>';
        }).join('') + '</div></div>';
    }
    return hd + rbExpBar_('auto') + rbCommonsHtml_(rp.commons, 'auto') + tblB + benchHtml;
  } catch (e) { return '<div class="panel">โหลด "Auto Assign" ไม่ได้: ' + rbEsc_(e.message) + '</div>'; }
}

/** Lazy tab: 🆘 Support — ไฟลท์ที่คนไม่ครบ + คนที่ว่าง & รู้ระบบเช็คอินมาช่วยได้ */
function rbSupportHtml(iso, addJson) {
  try {
    var d = rbLoadResLL_(rbDateFromIso_(iso));
    var autoRows = slaSupportRows_(d.res, d.ll);
    var manualRows = [];
    if (addJson) { try { manualRows = slaManualSupportRows_(d.res, d.ll, JSON.parse(addJson)); } catch (ea) { manualRows = []; } }
    var rows = manualRows.concat(autoRows);        // คำขอ Duty (เพิ่มเอง) ขึ้นก่อน
    var nF = {}, supTeams = {};
    autoRows.forEach(function (r) { nF[r.flight] = 1; });
    rows.forEach(function (r) { r.cands.forEach(function (c) { supTeams[c.team] = 1; }); });
    var hd = '<div class="sectionlabel">🆘 <b>Support / เติมคน</b> (รวม "เติม Assign เดิม") — ไฟลท์ที่คนไม่ครบตาม SLA: <b class="badd">' + Object.keys(nF).length +
      ' ไฟลท์</b> · ตำแหน่งที่ขาด ' + autoRows.length + ' รายการ' + (manualRows.length ? ' · <b class="okk">คำขอ Duty ' + manualRows.length + '</b>' : '') +
      ' — เมนูตั้งค่าคนที่ <b>ว่าง + รู้ระบบ</b> ให้อัตโนมัติ · เลือก <b>พนักงานอื่นๆ</b> ได้จากในเมนู</div>';
    // แถบเพิ่มคำขอเอง (Duty สั่งช่วยไฟลท์/ตำแหน่งที่ระบบไม่ได้จับว่าขาด)
    var addBar = '<div class="supaddbar" style="margin:8px 0;padding:10px 12px;border:1px dashed #cdd8e6;border-radius:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
      '<b>➕ เพิ่มคำขอซัพ (Duty):</b> ไฟลท์ <input id="supAddFlt" placeholder="เช่น PG270" style="width:110px;padding:4px 7px;border:1px solid #cdd8e6;border-radius:6px;text-transform:uppercase">' +
      ' ตำแหน่ง <select id="supAddPh" style="padding:4px 7px;border:1px solid #cdd8e6;border-radius:6px"><option value="ARR">Arrival</option><option value="GATE">Gate</option><option value="CI">Check-in</option><option value="SUP">SUP</option></select>' +
      ' จำนวน <input id="supAddN" type="number" value="1" min="1" style="width:50px;padding:4px 7px;border:1px solid #cdd8e6;border-radius:6px">' +
      ' เวลา <input id="supAddWin" placeholder="0635-0735 (ไม่ใส่=คิดจาก STD)" title="ช่วงเวลาที่ Duty ระบุ — เว้นว่าง = ระบบคิดจาก STD ของไฟลท์" style="width:170px;padding:4px 7px;border:1px solid #cdd8e6;border-radius:6px">' +
      ' <button class="btn btn--accent" onclick="supAddReq()">เพิ่ม + คิดคน</button> <button class="btn" onclick="supClearReq()">ล้างคำขอ</button>' +
      '<span class="supaddmsg muted" style="font-size:12px"></span></div>';
    var expBar = '<div class="expbar" style="margin:8px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
      '<b>📤 ส่งให้พนักงาน:</b> <button class="btn btn--accent" onclick="supExport()">สร้างไฟล์ชีตแจ้ง Assignment (จากที่เลือกในเมนู · 1 แท็บ/ทีม)</button>' +
      '<span class="supexpmsg muted"></span></div>';
    // แถบเลือกหลายทีม: เลือกได้ว่าจะดึงคนจากทีมไหนมาช่วย (คลิกสลับเปิด/ปิด)
    var teamBar = Object.keys(supTeams).sort().map(function (t) {
      return '<button class="supteam on" data-t="' + rbEsc_(t) + '" onclick="toggleSupTeam(this)">' + rbEsc_(t) + '</button>';
    }).join('');
    if (teamBar) teamBar = '<div class="supbar"><b>เลือกทีมที่จะดึงมาช่วย:</b> ' + teamBar +
      ' <button class="supteam supall" onclick="allSupTeams(this)">ทั้งหมด</button>' +
      '<span class="muted" style="font-size:12px">— ถ้าทีมที่เลือกไม่พอ ระบบเติม <span class="sup--sub" style="padding:1px 6px;border-radius:6px">↪ ทดแทน</span> จากทีมอื่นให้ครบจำนวนที่ขาด</span></div>';
    var body = rows.map(function (r) {
      var who;
      var others = r.others || [];
      if (r.cands.length || others.length) {
        var grps = slaGroupCands_(r.cands);
        function optRow(p, defName) {
          return '<option value="' + rbAttr_(p.name) + '"' + (p.name === defName ? ' selected' : '') + '>' +
            rbEsc_(p.name + ' · ' + (p.pos || '') + ' · ' + (p.team || '') + ' · ' + (p.shift || '') + ' · ' + (p.n || 0) + ' ไฟลท์'
              + (p.hlevel && p.hlevel !== 'ok' ? '  ⚠️ ' + (p.htxt || 'เกินชั่วโมง') : '')) + '</option>';
        }
        function sel(defName) {
          var h = '<select class="namepick"><option value=""' + (defName ? '' : ' selected') + '>— เลือกคน —</option>';
          grps.forEach(function (g) {
            h += '<optgroup label="' + rbEsc_(g.team) + ' (' + g.people.length + ')">';
            g.people.forEach(function (p) { h += optRow(p, defName); });
            h += '</optgroup>';
          });
          // พนักงานอื่นๆ ที่ว่างช่วงนั้น (ไม่ตรงระบบ/ตำแหน่ง) — เลือกเสริมได้ถ้า Duty รู้ว่าช่วยได้
          if (others.length) {
            h += '<optgroup label="อื่นๆ · ว่างช่วงนี้ (ไม่ตรงระบบ) (' + others.length + ')">';
            others.forEach(function (p) { h += optRow(p, defName); });
            h += '</optgroup>';
          }
          return h + '</select>';
        }
        // 1 ช่อง = 1 คน · ค่าเริ่มต้นกระจายหลายทีม (แนะทีมอื่นด้วย ไม่ใช่ทีมลอยซ้ำ) แล้วค่อยเติมจากที่ดีสุด
        // คนกะปกติก่อน · คนวันหยุด (OT-OFF/OFF) เป็นตัวเลือกสำรอง เติมเฉพาะเมื่อคนกะปกติไม่พอ
        var slots = [], usedT = {}, picked = [];
        var normalC = r.cands.filter(function (c) { return !c.rest; });
        var restC = r.cands.filter(function (c) { return c.rest; });
        [normalC, restC].forEach(function (list) { list.forEach(function (c) { if (picked.length < r.shortN && !usedT[c.team]) { usedT[c.team] = 1; picked.push(c.name); } }); });
        [normalC, restC].forEach(function (list) { for (var ci = 0; picked.length < r.shortN && ci < list.length; ci++) if (picked.indexOf(list[ci].name) < 0) picked.push(list[ci].name); });
        for (var i = 0; i < r.shortN; i++) slots.push(sel(picked[i] || ''));
        who = '<div class="pickwrap">' + slots.join('') + '</div>' +
          (!r.cands.length ? '<div class="muted" style="font-size:11px">ไม่มีคนตรงระบบ — เลือกจาก "อื่นๆ" ที่ว่างช่วงนี้ได้</div>' : '');
      } else {
        who = '<span class="badd">' + (r.block ? '🚫 ' + rbEsc_(r.block)
          : (r.noFlightTime ? '⚠️ ยังไม่กรอกเวลาไฟลท์ (STA/STD)'
          : (r.needSys ? 'ไม่มีคนว่างที่รู้ระบบ ' + rbEsc_(r.needSys) : 'ไม่มีคนว่าง'))) + '</span>';
      }
      var mtag = r.manual ? '<span class="tag" style="background:#fff3cd;color:#8a6d00">➕ Duty</span> ' : '';
      return '<tr class="' + (r.cands.length || others.length ? '' : 'rowbad') + '" data-team="' + rbEsc_(r.team) +
        '" data-flight="' + rbAttr_(r.flight) + '" data-air="' + rbAttr_(r.airline) + '" data-std="' + rbAttr_(r.STD) + '" data-phase="' + rbAttr_(r.phase) +
        '"><td class="b">' + mtag + rbEsc_(r.flight) +
        '</td><td>' + rbEsc_(r.airline) + '</td><td>' + rbEsc_(r.system || '-') + '</td><td>' + rbEsc_(r.team) + '</td><td class="tnum">' + rbEsc_(r.STD) +
        '</td><td class="' + (r.manual ? '' : 'badd') + '">' + rbEsc_(r.phase) + (r.gtype ? ' <b>' + rbEsc_(r.gtype) + '</b>' : '') + (r.manual ? ' ขอ ' : ' ขาด ') + r.shortN + (r.needSys ? ' <span class="muted">(' + rbEsc_(r.needSys) + ')</span>' : '') +
        '</td><td class="tnum">' + rbEsc_(r.win) + (r.noRoster ? ' <span class="muted">(ไม่พบไฟลท์ในเวร)</span>' : '') + '</td><td>' + who + '</td></tr>';
    }).join('');
    if (!body) body = '<tr><td colspan="8" class="okk" style="text-align:center;padding:20px">✅ ทุกไฟลท์ส่งพนักงานครบตาม SLA — เพิ่มคำขอ Duty เองได้ที่แถบด้านบน</td></tr>';
    var sosTxt = ''; try { sosTxt = slaSOSText_(d.res, d.ll, iso); } catch (es) { sosTxt = ''; }
    var sosBlock = '<details class="tablecard" style="margin-bottom:10px"><summary style="cursor:pointer;padding:10px 14px;font-weight:700">📋 ข้อความ SOS (คัดลอกส่งไลน์ได้เลย · เฉพาะคนทีมอื่น)</summary>' +
      '<div style="padding:8px 14px"><button class="btn btn--accent" onclick="(function(b){var t=b.parentNode.querySelector(\'textarea\');t.focus();t.select();if(navigator.clipboard){navigator.clipboard.writeText(t.value);}else{document.execCommand(\'copy\');}b.textContent=\'✓ คัดลอกแล้ว\';setTimeout(function(){b.textContent=\'📋 คัดลอกข้อความ\';},1500);})(this)">📋 คัดลอกข้อความ</button>' +
      '<textarea readonly rows="16" style="width:100%;margin-top:8px;font-family:monospace;font-size:12px;white-space:pre;overflow:auto">' + rbEsc_(sosTxt) + '</textarea></div></details>';
    var checkPanel = '<details class="tablecard" style="margin-bottom:10px"><summary style="cursor:pointer;padding:10px 14px;font-weight:700">✅ ตรวจรายชื่อที่จะส่งซัพ (วางข้อความ Duty / รายชื่อ แล้วกดตรวจ — เช็ค OFF · กะไม่ครอบ · เวลาซ้อน · ลงเทรน)</summary>' +
      '<div style="padding:8px 14px"><textarea id="supchkin" rows="6" placeholder="วางข้อความขอซัพจาก Duty ได้เลย (มีเลขไฟลท์+ชื่อ) หรือพิมพ์บรรทัดละ ไฟลท์ ตามด้วยชื่อ" style="width:100%;font-size:13px;font-family:monospace"></textarea>' +
      '<div style="margin-top:6px"><button class="btn btn--accent" onclick="supCheck()">🔍 ตรวจรายชื่อ</button> <span id="supchkmsg" class="muted"></span></div>' +
      '<div id="supchkout" style="margin-top:8px"></div></div></details>';
    var importPanel = '<details class="tablecard" style="margin-bottom:10px"><summary style="cursor:pointer;padding:10px 14px;font-weight:700">📥 แปลงข้อความ Duty → ชีต (วางข้อความขอซัพจากไลน์ → แตกเป็นตาราง + สร้างชีต)</summary>' +
      '<div style="padding:8px 14px"><textarea id="supimpin" rows="7" placeholder="วางข้อความขอซัพจาก Duty (ไลน์) ทั้งก้อนได้เลย — รองรับหลายสาย/หลายไฟลท์" style="width:100%;font-size:13px;font-family:monospace"></textarea>' +
      '<div style="margin-top:6px"><button class="btn btn--accent" onclick="supDutyPlan()">📋 คิด + แสดงแบบสรุป (แนะนำ/สำรอง)</button> <button class="btn" onclick="supDutyToRows()">➕ แตกเป็นแถวเลือกคน</button> <button class="btn" onclick="supImport()">🔎 แปลงชื่อ</button> <button class="btn" onclick="supImportSheet()">📤 สร้างชีต</button> <span id="supimpmsg" class="muted"></span></div>' +
      '<div class="muted" style="font-size:11.5px;margin-top:4px">📋 = ตารางสรุป แนะนำ/สำรอง (อ่าน+คัดลอกส่งไลน์) · ➕ = แตกเป็นแถวเลือกคนเองในตาราง Support</div>' +
      '<div id="supplanout" style="margin-top:8px"></div>' +
      '<div id="supimpout" style="margin-top:8px"></div></div></details>';
    return hd + addBar + expBar + checkPanel + importPanel + sosBlock + rbTblCard_('🆘 ไฟลท์คนไม่ครบ + เลือกคนมาช่วย (แสดงกะ · จำนวนไฟลท์)',
      '<tr><th>Flight</th><th>สายการบิน</th><th>ระบบเช็คอิน</th><th>ทีม</th><th>STD</th><th>ตำแหน่งที่ขาด</th><th>ช่วงเวลา</th><th>เลือกคนมาช่วย (ทีมเจ้าของก่อน · กะ · จำนวนไฟลท์)</th></tr>',
      body, rbCtrls_('view-sup', true));
  } catch (e) { return '<div class="panel">โหลด Support ไม่ได้: ' + rbEsc_(e.message) + '</div>'; }
}

/** แผนซัพจาก Duty (แนะนำ/สำรอง) — วางข้อความขอซัพ → ตารางอ่านง่าย + ข้อความคัดลอกส่งไลน์ */
function rbSupDutyPlanHtml(iso, text) {
  try {
    var reqs = (typeof dutyParseRequests_ === 'function') ? dutyParseRequests_(text) : [];
    if (!reqs.length) return '<div class="panel muted" style="padding:14px">ไม่พบคำขอในข้อความ — ต้องมีเลขไฟลท์ + ตำแหน่ง (ARR/GATE) + จำนวน</div>';
    var d = rbLoadResLL_(rbDateFromIso_(iso));
    var rows = slaManualSupportRows_(d.res, d.ll, reqs);
    var txt = [];
    function nm(c) { return '<b>' + rbEsc_(c.name) + '</b> <span class="muted">' + rbEsc_(c.team) + '</span>'; }
    function nmMuted(c) { return rbEsc_(c.name) + ' <span class="muted">(' + rbEsc_(c.team) + ')</span>'; }
    var body = rows.map(function (r) {
      var win = r.win || '-';
      var w = (typeof slaParseWin_ === 'function' && r.win) ? slaParseWin_(r.win) : null;
      var over = w && w[1] > 1440;                                    // ข้ามเที่ยงคืน
      var pick, alt = '', pickTxt;
      if (r.block) { pick = '<span class="badd">🚫 ' + rbEsc_(r.block) + '</span>'; pickTxt = '(' + r.block + ')'; }
      else if (!r.cands.length) {
        pick = r.others.length ? '<span class="muted">อื่นๆว่าง: ' + r.others.slice(0, 2).map(nmMuted).join(', ') + '</span>' : '<span class="badd">ไม่มีคนว่าง</span>';
        pickTxt = r.others.length ? ('อื่นๆ ' + r.others.slice(0, 2).map(function (c) { return c.name + '(' + c.team + ')'; }).join(', ')) : 'ไม่มีคนว่าง';
      } else {
        var top = r.cands.slice(0, r.shortN);
        pick = top.map(nm).join(' · ');
        alt = r.cands.slice(r.shortN, r.shortN + 3).map(nmMuted).join(', ');
        pickTxt = top.map(function (c) { return c.name + '(' + c.team + ')'; }).join(', ');
      }
      var pos = r.label || r.phase;
      var altTxt = r.cands.slice(r.shortN, r.shortN + 3).map(function (c) { return c.name; }).join(', ');
      txt.push(r.flight + ' · ' + pos + ' · ' + win + ' → ' + pickTxt + (altTxt ? ('  (สำรอง ' + altTxt + ')') : ''));
      return '<tr data-team="' + rbEsc_(r.team) + '"><td class="b">' + rbEsc_(r.flight) + (over ? ' <span title="ดึกข้ามคืน">⚠️</span>' : '') +
        '</td><td>' + rbEsc_(pos) + '</td><td class="tnum">' + rbEsc_(win) + '</td><td>' + pick + '</td><td>' + (alt || '<span class="muted">—</span>') + '</td></tr>';
    }).join('');
    var copyText = txt.join('\n');
    var hd = '<div class="sectionlabel">📋 <b>แผนซัพจาก Duty</b> — แตกได้ <b>' + reqs.length + '</b> คำขอ · แนะนำคนที่ <b>ว่าง + รู้ระบบ</b> (กันเวลาซ้อนแล้ว)</div>';
    var copyBar = '<div style="margin:8px 0"><button class="btn btn--accent" onclick="(function(b){var t=b.parentNode.querySelector(\'textarea\');t.style.display=\'block\';t.focus();t.select();if(navigator.clipboard)navigator.clipboard.writeText(t.value);b.textContent=\'✓ คัดลอกแล้ว\';setTimeout(function(){b.textContent=\'📋 คัดลอกข้อความ (ส่งไลน์)\';},1500);})(this)">📋 คัดลอกข้อความ (ส่งไลน์)</button>' +
      '<textarea readonly rows="' + Math.min(rows.length + 1, 18) + '" style="display:none;width:100%;margin-top:8px;font-family:monospace;font-size:12px;white-space:pre;overflow:auto">' + rbEsc_(copyText) + '</textarea></div>';
    return hd + copyBar + rbTblCard_('📋 แนะนำ / สำรอง (ตามคำขอ Duty)',
      '<tr><th>ไฟลท์</th><th>ตำแหน่ง</th><th>ช่วง</th><th>แนะนำ (ชื่อ · ทีม)</th><th>สำรอง</th></tr>', body,
      rbCtrls_('view-sup', true));
  } catch (e) { return '<div class="panel">คิดแผนไม่ได้: ' + rbEsc_(e.message) + '</div>'; }
}
/** ตรวจรายชื่อที่จะส่งซัพ (เรียกจากปุ่มในแท็บ Support) */
function rbCheckDeployHtml(iso, text) {
  try {
    var d = rbLoadResLL_(rbDateFromIso_(iso));
    var rows = slaCheckDeploy_(d.res, d.ll, text);
    if (!rows.length) return '<div class="panel muted" style="padding:14px">ไม่พบชื่อที่ตรงกับ roster วันนี้ — ตรวจการสะกด (ใช้ชื่อตัวแรกให้ตรงตาราง) หรือมีเลขไฟลท์กำกับ</div>';
    function row(r) {
      var fl = (r.issues || []).slice(); if (r.overlap) fl.push('เวลาซ้อนกับงานอื่น');
      return '<tr class="' + (fl.length ? 'rowbad' : '') + '"><td class="b">' + rbEsc_(r.name) + '</td><td>' + rbEsc_(r.team) +
        '</td><td>' + rbEsc_(r.shift || '') + '</td><td class="b">' + rbEsc_(r.flight) + '</td><td>' +
        (fl.length ? '<span class="badd">⚠️ ' + rbEsc_(fl.join(' · ')) + '</span>' : '<span class="okk">✅ พร้อม</span>') + '</td></tr>';
    }
    var bad = rows.filter(function (r) { return r.issues.length || r.overlap; });
    var ok = rows.filter(function (r) { return !r.issues.length && !r.overlap; });
    var sum = '<div class="sectionlabel">ตรวจ ' + rows.length + ' รายการ · <b class="badd">' + bad.length + ' ติดปัญหา</b> · <b class="okk">' + ok.length + ' พร้อม</b></div>';
    return sum + rbTblCard_('ผลตรวจรายชื่อซัพพอร์ต', '<tr><th>ชื่อ</th><th>ทีม</th><th>กะ</th><th>ไฟลท์</th><th>สถานะ</th></tr>',
      bad.map(row).join('') + ok.map(row).join(''), '');
  } catch (e) { return '<div class="panel">ตรวจไม่ได้: ' + rbEsc_(e.message) + '</div>'; }
}
/** ตัวกรองหัวการ์ด: ช่องค้นหา + dropdown เลือกทีม (เติม option ด้วย JS หลังโหลด) */
function rbCtrls_(viewId, withSearch){
  return (withSearch ? '<input class="search" placeholder="🔎 ค้นหา" oninput="applyFilter(\''+viewId+'\')">' : '') +
    '<select class="teamsel" onchange="applyFilter(\''+viewId+'\')"><option value="">ทุกทีม</option></select>';
}
/** ตัวกรอง "หาคนว่างในช่วงเวลา" — แสดงเฉพาะแถวที่มีช่วงว่างคาบเกี่ยวเวลาที่เลือก */
function rbGapCtrl_(viewId){
  return '<span class="gapfilter" style="display:inline-flex;align-items:center;gap:4px;margin-left:8px">' +
    '🕓 ว่างช่วง <input type="time" class="gapfrom" onchange="applyFilter(\''+viewId+'\')" style="padding:4px 6px;border:1px solid #cdd8e6;border-radius:6px">' +
    '– <input type="time" class="gapto" onchange="applyFilter(\''+viewId+'\')" style="padding:4px 6px;border:1px solid #cdd8e6;border-radius:6px">' +
    '<button class="btn" onclick="clearGap(\''+viewId+'\')" style="padding:4px 10px">ล้าง</button> <span class="gapcount" style="font-size:12px;color:var(--good);font-weight:600"></span></span>';
}
/** แสดงผล common check-in (SU/SQ): เคาน์เตอร์รวมหมุนเวียน + เกทต่อไฟลท์ · kind = "fill"|"auto" */
function rbCommonsHtml_(commons, kind){
  if (!commons || !commons.length) return '';
  return commons.map(function(cm){
    var nCt = (cm.counters[0] && cm.counters[0].slots.length) || 0;
    var fcSel = cm.fc ? ' <span class="muted" style="font-weight:400;font-size:12px">· 🎧 Flight Controller:</span> <select class="fcpick" data-code="'+rbEsc_(cm.code)+'" onchange="fcPick(\''+(kind||'fill')+'\')" style="padding:3px 6px;border:1px solid #cdd8e6;border-radius:6px;font-size:12px">'+(cm.members||[]).map(function(m){return '<option value="'+rbAttr_(m.name)+'"'+(m.name===cm.fc.name?' selected':'')+'>'+rbEsc_(m.name)+' ('+rbEsc_(m.pos)+')</option>';}).join('')+'</select>' : '';
    var h = '<div class="tablecard" style="margin-top:14px"><div class="tablecard__hd"><h3>🛄 '+rbEsc_(cm.code)+' — เช็คอินคอมมอน '+nCt+' เคาน์เตอร์ (หมุนเวียน ≤3 ชม./คน)'+fcSel+'</h3></div><div style="padding:6px 14px 12px">';
    cm.counters.forEach(function(b){
      h += '<div class="sectionlabel" style="margin:8px 0 4px">⏱️ ช่วง <b>'+rbEsc_(b.time)+'</b>'+(b.round?' · รอบ '+rbEsc_(b.round):'')+' · ไฟลท์ '+rbEsc_(b.flights)+' · <span class="muted">คนว่าง '+b.nAvail+'</span></div>';
      h += '<div style="display:flex;flex-wrap:wrap;gap:6px">'+b.slots.map(function(s){
        return '<span class="chip">'+rbEsc_(s.counter)+': '+(s.chosen?rbEsc_(s.chosen.name)+' <span class="muted">'+rbEsc_(s.chosen.pos)+'</span>':'<span class="muted">— ว่าง —</span>')+'</span>';
      }).join('')+'</div>';
    });
    h += '</div></div>';
    if (cm.gates && cm.gates.length){
      h += '<div class="tablecard" style="margin-top:10px"><div class="tablecard__hd"><h3>🚪 '+rbEsc_(cm.code)+' — Gate ต่อไฟลท์ (คนต่อเนื่องจากเช็คอิน)</h3></div><div style="padding:6px 14px 12px">';
      cm.gates.forEach(function(g){
        h += '<div class="sectionlabel" style="margin:8px 0 4px">✈️ <b>'+rbEsc_(g.flight)+'</b> · STD '+rbEsc_(g.std)+'</div>';
        h += '<div style="display:flex;flex-wrap:wrap;gap:6px">'+g.roles.map(function(rl){
          return rl.picks.map(function(pk,idx){
            return '<span class="chip">'+rbEsc_(rl.lb)+(rl.need>1?' '+(idx+1):'')+' <span class="muted">'+rbEsc_(rl.win)+'</span>: '+(pk?rbEsc_(pk.name)+' <span class="muted">'+rbEsc_(pk.pos)+'</span>':'<span class="badd">— ขาด —</span>')+'</span>';
          }).join('');
        }).join('')+'</div>';
      });
      h += '</div></div>';
    }
    return h;
  }).join('');
}
/** แถบส่งออกไฟล์ชีตรายทีม (FillPlan / AutoAssign) — kind = "fill" | "auto" */
function rbExpBar_(kind){
  return '<div class="expbar" style="margin:8px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
    '<b>📤 ส่งให้พนักงาน:</b> <select class="expteam"><option value="">ทุกทีม</option></select> ' +
    '<button class="btn btn--accent" onclick="'+kind+'Export()">สร้างไฟล์ชีต (1 แท็บ/ทีม)</button>' +
    '<span class="expmsg muted"></span></div>';
}

// ── header + week nav + tabs ────────────────────────────────────────────────
function rbAppbar_(date) {
  var be = date.getFullYear()+543;
  var logo = ''; try { logo = rbLogoDataUri_(); } catch (elg) {}
  return '<div class="appbar rise"><div class="appbar__row">' +
    '<div class="brand">' + (logo ? '<img class="brand__logo" src="' + logo + '" alt="AOTGA">' : '<div class="brand__mark">✈</div>') + '<div><h1>P<span>AS</span></h1>' +
    '<p>PSA-HKT Assignment System</p></div></div>' +
    '<div class="appbar__meta"><div class="datepill"><div class="d tnum">' + date.getDate()+' '+MONW[date.getMonth()]+' '+be +
    '</div><div class="s">Daily Manpower · ตารางกำลังพลรายวัน</div></div>' +
    '<div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">' +
    '<div class="livedot"><i></i>Live</div>' +
    '<div style="display:flex;gap:8px">' +
    '<button class="btn" onclick="pwmsHelp(1)" title="คู่มือการใช้งาน">ℹ️ ช่วยเหลือ</button>' +
    '<button class="btn" onclick="exportServerPdf(this)">📄 บันทึกไฟล์ PDF</button>' +
    '<button class="btn btn--accent" onclick="exportPdf()">⬇ Export PDF</button></div></div></div></div></div>';
}

/** AOTGA Manpower — แถบเมนูซ้าย (Phase 4): brand + เมนู + Live */
var RB_NAV_ = [
  ['dash','▦','Dashboard',''], ['tt','☰','Timetable','loadTT()'],
  ['flt','✈','Flights & SLA','loadFlt()','s'], ['sup','🆘','Support / เติมคน','loadSup()','s'],
  ['ac','🧭','ตรวจ Assign','loadAC()','a'],
  ['auto','🤖','Auto Assign','loadAuto()'], ['adv','📅','จัดล่วงหน้า','loadAdv()'],
  ['advw','🗂️','ภาพรวมสัปดาห์','loadAdvW()'],
  ['week','🗓️','ไฟลท์สัปดาห์','loadWeek()'], ['rq','📨','RQ ซัพ (คำร้อง)','loadRq()'],
  ['ot','⏱️','OT Dashboard',''], ['wh','📆','ชม./สัปดาห์','loadWh()'], ['wsum','📊','สรุปสัปดาห์','loadWsum()'], ['dc','🩺','ตรวจข้อมูล','loadDc()']
];
function rbRail_(shortCount, acCount) {
  var logo = ''; try { logo = rbLogoDataUri_(); } catch (e) {}
  var nav = RB_NAV_.map(function (it) {
    var click = "showView('" + it[0] + "')" + (it[3] ? ';' + it[3] : '');
    var bn = it[4] === 's' ? shortCount : (it[4] === 'a' ? acCount : 0);
    var badge = bn ? '<span class="rail-badge tnum">' + bn + '</span>' : '';
    return '<button class="rail-item' + (it[0] === 'dash' ? ' active' : '') + '" id="tab-' + it[0] + '" data-title="' + rbEsc_(it[2]) + '" onclick="' + click + '">' +
      '<span class="rail-ic">' + it[1] + '</span><span class="rail-txt">' + it[2] + '</span>' + badge + '</button>';
  }).join('');
  return '<aside class="app-rail">' +
    '<div class="rail-brand">' + (logo ? '<img class="rail-logo" src="' + logo + '" alt="AOTGA">' : '<div class="rail-mark">✈</div>') +
      '<div class="rail-brandtxt"><b>P<span>AS</span></b><small>Passenger Services</small></div></div>' +
    '<nav class="rail-nav">' + nav + '</nav>' +
    '<div class="rail-foot"><button class="rail-refresh" onclick="rbRefresh(this)" title="ล้างแคช ดึงข้อมูลล่าสุด">🔄 รีเฟรช</button>' +
      '<div class="rail-live"><i class="pl-dot"></i>Live · sync</div></div>' +
    '</aside>';
}
/** แถบหัวในพื้นที่หลัก: ชื่อหน้า + วันที่ + ปุ่ม */
function rbTopbar_(date) {
  var be = date.getFullYear() + 543;
  return '<div class="topbar rise"><div class="topbar-h"><h2 id="pageTitle">Dashboard</h2>' +
    '<div class="topbar-sub">Daily Manpower · ตารางกำลังพลรายวัน</div></div>' +
    '<div class="topbar-actions"><div class="datepill"><div class="d tnum">' + date.getDate() + ' ' + MONW[date.getMonth()] + ' ' + be + '</div></div>' +
    '<button class="btn" onclick="pwmsHelp(1)" title="คู่มือการใช้งาน">ℹ️ ช่วยเหลือ</button>' +
    '<button class="btn btn--accent" onclick="exportPdf()">⬇ Export PDF</button></div></div>';
}
/** หน้าต่างคู่มือการใช้งาน (เปิดด้วยปุ่ม ℹ️ ช่วยเหลือ) */
function rbHelpModal_() {
  return '<div id="helpov" class="helpov" style="display:none" onclick="if(event.target===this)pwmsHelp(0)">' +
    '<div class="helpbox">' +
    '<div class="helpbox__hd"><h3>ℹ️ คู่มือการใช้งาน PAS</h3><button class="helpx" onclick="pwmsHelp(0)">✕</button></div>' +
    '<div class="helpbox__bd">' +
    '<p class="muted">ระบบอ่านไฟล์ assignment รายวันจาก Drive แล้วสรุปกำลังพล · ตรวจ SLA · หาคนช่วยข้ามทีม — เลือกวันที่ได้จากแถบบน · กด 🔄 เมื่อแก้ไฟล์แล้วอยากให้ดึงใหม่</p>' +

    '<h4>📑 แท็บต่าง ๆ</h4><ul class="helpul">' +
    '<li><b>▦ Dashboard</b> — ภาพรวมกำลังพล แยกราย<b>ทีม</b>/<b>ตำแหน่ง</b> (Total · มาทำงาน · หยุด · OT)</li>' +
    '<li><b>🕓 Timetable</b> — รายคน: กะเข้า-ออก · OT · ไฟลท์ที่รับผิดชอบ (ค้นหาชื่อได้)</li>' +
    '<li><b>✈️ Flights & SLA</b> — ราย<b>ไฟลท์</b>: จัดจริง vs SLA ต้องการ → ✅ ครบ / ⚠️ ขาด</li>' +
    '<li><b>🆘 ไฟลท์คนไม่ครบ</b> — ไฟลท์ที่ขาด + แนะคนมาช่วยข้ามทีม</li>' +
    '<li><b>📅 จัดล่วงหน้า</b> — จัดเวรอัตโนมัติลงเคาน์เตอร์/เกท + export 1 แท็บ/ทีม</li>' +
    '<li><b>🔧 ตรวจ Assign</b> — ตรวจ OT เกิน · ช่วงว่าง · ครอบคลุมไฟลท์</li>' +
    '<li><b>OT Dashboard</b> — สรุปชั่วโมง OT สะสมรายทีม</li></ul>' +

    '<h4>🆘 วิธีอ่านแท็บ "ไฟลท์คนไม่ครบ"</h4>' +
    '<p>คอลัมน์: <code>Flight · สายการบิน · ระบบเช็คอิน · ทีม · STD · ตำแหน่งที่ขาด · ช่วงเวลา · เลือกคนมาช่วย</code></p>' +
    '<ul class="helpul">' +
    '<li><b>ตำแหน่งที่ขาด</b> เช่น "Check-in ขาด 3 (Sabre)" = ขาดคนเช็คอิน 3 · ต้องรู้ระบบ Sabre</li>' +
    '<li><b>ช่วงเวลา</b> = คนช่วยต้องว่างครอบช่วงนี้</li>' +
    '<li>ป้ายคนช่วย: <code>ชื่อ · ตำแหน่ง · กะ · X ไฟลท์</code> → <b>"0 ไฟลท์" = ว่างสุด เลือกก่อน</b></li>' +
    '<li><b>OFF · re-sked 08:00-20:00</b> = คนหยุด เรียกมาช่วยได้ตามกะเดิม (ทางเลือกท้ายสุด)</li>' +
    '<li>ลำดับแนะ: <b>ทีมลอย (PVTLP/STBY) ก่อน</b> → คนทำงาน → คนหยุด</li></ul>' +

    '<h4>🟢 สถานะคน (นับเป็น "มาทำงาน" ไหม)</h4><ul class="helpul">' +
    '<li><b>working</b> (Onduty) → ✅ &nbsp; <b>ot_off</b> (วันหยุดมาทำ OT จริง) → ✅</li>' +
    '<li><b>off</b> (รวม "OT OFF" ที่ยังไม่มีชั่วโมง OT) → ❌ &nbsp; <b>sick/vac/ลา</b> → ❌</li>' +
    '<li><b>on-duty = working + ot_off</b></li></ul>' +

    '<h4>✈️ SLA — คนต่อไฟลท์ (ตัวอย่าง)</h4>' +
    '<table class="helptb"><tr><th>สาย</th><th>ระบบ</th><th>SUP</th><th>Check-in</th><th>Arr</th><th>Gate</th><th>รวม</th></tr>' +
    '<tr><td>EK</td><td>AS Connect</td><td>1</td><td>7</td><td>3</td><td>2</td><td>13</td></tr>' +
    '<tr><td>EY</td><td>Altea</td><td>1</td><td>9</td><td>1</td><td>2</td><td>13</td></tr>' +
    '<tr><td>QR</td><td>Altea</td><td>1</td><td>9</td><td>2</td><td>2</td><td>14</td></tr>' +
    '<tr><td>SQ</td><td>Altea</td><td>1</td><td>5</td><td>1</td><td>2</td><td>9</td></tr>' +
    '<tr><td>AK</td><td>Gonow</td><td>1</td><td>3</td><td>1</td><td>2</td><td>7</td></tr>' +
    '<tr><td>PG</td><td>Altea</td><td>1</td><td>0</td><td>1</td><td>2</td><td>5</td></tr></table>' +
    '<p class="muted">Gate Agent ใช้คนจากเช็คอินย้ายไปเกท (ไม่นับซ้ำใน "รวม") · ขาออกอย่างเดียว→ไม่นับ Arrival · ขาเข้าอย่างเดียว→ไม่นับ Check-in/Gate · ตารางเต็มดูในเอกสาร docs/</p>' +

    '<h4>⚠️ ตัวเลขเพี้ยน เช็คก่อน</h4><ul class="helpul">' +
    '<li>แก้ไฟล์แล้วยังเห็นของเก่า → กด <b>🔄 รีเฟรช</b></li>' +
    '<li>ทีมมาทำงานเยอะผิดปกติ → ไฟล์เปลี่ยนฟอร์ม / คอลัมน์สถานะชื่อแปลก</li>' +
    '<li>ไฟลท์จัดคนซ้ำ → เลขไฟลท์เขียน 2 แถว (เช่น EK396/397 กับ EK397)</li></ul>' +

    '</div></div></div>';
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
    '<a class="iconbtn" href="' + u(next) + '" target="_top">›</a>' +
    '<input type="date" class="navdate" value="' + iso + '" title="เลือกวันที่ — ข้ามไปวันไหน/เดือนไหนก็ได้" ' +
    'onchange="if(this.value)window.top.location.href=\'' + (base || '') + '?date=\'+this.value">' +
    '</div>' +
    '<div class="weeknav__strip">' + chips.join('') + '</div></div>';
}
function rbTabs_(shortCount, acCount) {
  return '<div class="tabs">' +
    '<button class="tab active" id="tab-dash" onclick="showView(\'dash\')">▦ Dashboard</button>' +
    '<button class="tab" id="tab-tt" onclick="showView(\'tt\');loadTT()">☰ Timetable</button>' +
    '<button class="tab" id="tab-flt" onclick="showView(\'flt\');loadFlt()">✈ Flights &amp; SLA' +
    (shortCount ? '<span class="badge tnum">' + shortCount + '</span>' : '') + '</button>' +
    '<button class="tab" id="tab-sup" onclick="showView(\'sup\');loadSup()">🆘 Support' +
    (shortCount ? '<span class="badge tnum">' + shortCount + '</span>' : '') + '</button>' +
    '<button class="tab" id="tab-ac" onclick="showView(\'ac\');loadAC()">🧭 ตรวจ Assign' +
    (acCount ? '<span class="badge tnum">' + acCount + '</span>' : '') + '</button>' +
    '<button class="tab" id="tab-fill" onclick="showView(\'fill\');loadFill()">🤖 เติม Assign เดิม</button>' +
    '<button class="tab" id="tab-auto" onclick="showView(\'auto\');loadAuto()">🤖 Auto Assign</button>' +
    '<button class="tab" id="tab-adv" onclick="showView(\'adv\');loadAdv()">📅 จัดล่วงหน้า</button>' +
    '<button class="tab" id="tab-ot" onclick="showView(\'ot\')">⏱️ OT Dashboard</button>' +
    '<button class="tab" id="tab-wh" onclick="showView(\'wh\');loadWh()">⏱️ ชม./สัปดาห์</button>' +
    '<button class="tab" id="tab-wsum" onclick="showView(\'wsum\');loadWsum()">📊 สรุปสัปดาห์</button>' +
    '<button class="tab" id="tab-dc" onclick="showView(\'dc\');loadDc()">🩺 ตรวจข้อมูล</button>' +
    '<button class="tab" onclick="rbRefresh(this)" title="ล้างแคช ดึงข้อมูลล่าสุดจากชีต" style="margin-left:auto">🔄 รีเฟรช</button></div>';
}

/** Lazy tab: 🩺 ตรวจข้อมูล — ฟ้องจุดผิดในชีตรายวัน (ให้แก้ที่ต้นทาง ไม่ต้องไล่แก้สรุปทีหลัง) */
function rbDataCheckHtml(iso) {
  try {
    var d = rbLoadResLL_(rbDateFromIso_(iso));
    var res = d.res, ll = d.ll;
    var cats = { droptab: [], dupblock: [], staledate: [], offflt: [], noshift: [], flttime: [], dupteam: [], dupname: [], supnoteam: [] };
    (res.droppedTabs || []).forEach(function (nm) {
      cats.droptab.push({ team: nm, who: 'อ่านไม่ได้ทั้งแท็บ', detail: 'แท็บนี้มีข้อมูลแต่ระบบอ่านไม่ออก (เช่น ไม่มีคอลัมน์ ID/หัวตารางไม่ตรงแบบมาตรฐาน) — ทั้งทีมหายจากยอด/ไฟลท์' });
    });
    (res.dupBlockTabs || []).forEach(function (nm) {
      cats.dupblock.push({ team: nm, who: 'บล็อกซ้อนซ้ำในแท็บ', detail: 'แท็บนี้มีตารางคน 2 บล็อกซ้อนกัน (ID ซ้ำ) — ระบบใช้บล็อกแรก ข้ามบล็อกซ้ำ · ถ้าบล็อกล่างมี assignment ต่างจากบล็อกบน จะตกหล่น → ควรลบบล็อกซ้ำออกจากชีต' });
    });
    var idMap = {};
    function scan(t, recs) {
      var nameSeen = {};
      (recs || []).forEach(function (r) {
        if (!r.support && r.id && /^\d{6,8}$/.test(String(r.id))) (idMap[r.id] = idMap[r.id] || []).push({ team: t, name: r.name });
        var nk = String(r.name || '').trim().toUpperCase();
        if (nk.length > 1) { if (nameSeen[nk]) cats.dupname.push({ team: t, who: r.name, detail: 'ชื่อซ้ำในทีม (อาจกรอกซ้ำ 2 แถว)' }); nameSeen[nk] = 1; }
        // อ่านเวลางานไม่ได้จริง = ไม่มีทั้งเวลากะ และไม่มีช่วง OT ที่อ่านได้ (คน "OT OFF" รหัส XX มีช่วง OT → ครอบคลุมไฟลท์ได้ ไม่ต้องเตือน)
        var hasWin = r.shiftStart != null || (r.otSpans && r.otSpans.some(function (s) { return s && s.a != null; }));
        if ((r.bucket === 'working' || r.bucket === 'ot_off') && !hasWin && !r.support && r.assignments && r.assignments.length)
          cats.noshift.push({ team: t, who: r.name, detail: 'มาทำงาน/มีไฟลท์ แต่อ่านเวลากะไม่ได้' + (r.shift ? ' (รหัส ' + r.shift + ')' : ' (ไม่มีรหัสกะ)') });
        if (r.support && !r.supportTeam)
          cats.supnoteam.push({ team: t, who: r.name, detail: 'แถวซัพพอร์ตแต่ไม่มีรหัสทีมต้นสังกัด — ใส่ "ชื่อ + รหัสทีม" เช่น "สมชาย PVT"' });
        // เขียน OFF/XX (นับเป็นหยุด) แต่มีไฟลท์จริง → ระบบนับเป็นไม่มาทำงาน ทั้งที่นั่งไฟลท์อยู่ (ยอด/ครอบคลุมเพี้ยน)
        if (r.bucket === 'off' && !r.support && r.assignments && r.assignments.some(function (a) { return acIsFlight_(a.flight); }))
          cats.offflt.push({ team: t, who: r.name, detail: 'ชีตเขียนหยุด (OFF/XX) แต่ถูกจัดลงไฟลท์ — ถ้ามาทำงานให้แก้เป็น Onduty · ถ้ามาช่วย OT ให้กรอกชั่วโมง OT' });
      });
    }
    Object.keys(res.teams).forEach(function (t) { scan(t, res.teams[t].records); });
    if (ll && ll.sections) Object.keys(ll.sections).forEach(function (s) { scan('LL·' + s, ll.sections[s].records); });
    Object.keys(idMap).forEach(function (id) {
      var arr = idMap[id], ts = {}; arr.forEach(function (x) { ts[x.team] = 1; });
      if (Object.keys(ts).length > 1) cats.dupteam.push({ team: Object.keys(ts).join(' + '), who: arr[0].name + ' (' + id + ')', detail: 'รหัสเดียวกันโผล่หลายทีม — นับซ้ำ · ถ้าไปช่วยให้ทำเป็นแถว SUPPORT แทน' });
    });
    (slaCollectFlights_(res, ll) || []).forEach(function (f) {
      if (acIsFlight_(f.flight) && f.noTime && !(f.fragment)) cats.flttime.push({ team: f.teamList || '', who: f.flight, detail: 'ไฟลท์ไม่มี STA/STD — เติมเวลาในชีต' });
    });
    // แท็บทีมที่ลืมอัปเดตวันที่ (เช่น TR ยังเป็น 24/JUN ทั้งที่ทีมอื่น 29/JUN → ข้อมูลทั้งทีมเป็นของวันเก่า)
    var dcount = {};
    Object.keys(res.teams).forEach(function (t) { var sd = res.teams[t].sheetDate; if (sd) dcount[sd] = (dcount[sd] || 0) + 1; });
    var majDate = '', majN = 0;
    Object.keys(dcount).forEach(function (dd) { if (dcount[dd] > majN) { majN = dcount[dd]; majDate = dd; } });
    if (majDate && Object.keys(dcount).length > 1) {
      Object.keys(res.teams).forEach(function (t) {
        var sd = res.teams[t].sheetDate;
        if (sd && sd !== majDate) cats.staledate.push({ team: t, who: 'วันที่บนแท็บ = ' + sd, detail: 'แท็บนี้เป็นวันที่ ' + sd + ' แต่ทีมส่วนใหญ่เป็น ' + majDate + ' — อาจลืมอัปเดตแท็บ (ข้อมูลทั้งทีมเป็นของวันเก่า)' });
      });
    }
    var defs = [
      { k: 'droptab', t: '🛑 แท็บอ่านไม่ได้ (หายทั้งทีม)', hint: 'แท็บมีข้อมูลแต่ parser อ่านไม่ออก (ไม่มีคอลัมน์ ID/เลย์เอาต์ไม่มาตรฐาน) — ทั้งทีมหายจากยอดและ SLA' },
      { k: 'dupblock', t: '👥 บล็อกซ้อนซ้ำในแท็บ (ใช้บล็อกแรก)', hint: 'แท็บมีตารางคนซ้ำ 2 บล็อก (ID ซ้ำ) — ระบบอ่านบล็อกแรก ทิ้งบล็อกซ้ำ · ลบบล็อกซ้ำเพื่อกันข้อมูลตกหล่น' },
      { k: 'staledate', t: '📅 แท็บวันที่ไม่ตรงกัน', hint: 'ทีมนี้พิมพ์วันที่ต่างจากทีมอื่น — อาจลืมอัปเดตแท็บ (ข้อมูลทั้งทีมเป็นของวันเก่า)' },
      { k: 'offflt', t: '🚫 เขียน OFF แต่มีไฟลท์', hint: 'คนที่ชีตเขียนหยุด (OFF/XX) แต่ถูกจัดลงไฟลท์ — นับเป็นไม่มาทำงานทั้งที่นั่งไฟลท์อยู่' },
      { k: 'noshift', t: '⏰ มาทำงานแต่อ่านเวลากะไม่ได้', hint: 'รหัสกะไม่อยู่ใน ShiftDB/ลืมกรอกเวลา → ชั่วโมง+ครอบคลุมไฟลท์เพี้ยน' },
      { k: 'flttime', t: '✈️ ไฟลท์ขาด STA/STD', hint: 'เติมเวลาในชีต ไม่งั้นเช็ค SLA / หาคนช่วยไม่ได้' },
      { k: 'dupteam', t: '👯 รหัสซ้ำหลายทีม', hint: 'คนเดียวอยู่ 2 ทีม = นับซ้ำ · คนไปช่วยให้ใช้แถว SUPPORT' },
      { k: 'dupname', t: '📋 ชื่อซ้ำในทีม', hint: 'ตรวจว่ากรอกชื่อซ้ำหรือเป็นคนละคน' },
      { k: 'supnoteam', t: '🤝 ซัพพอร์ตไม่ระบุทีม', hint: 'ใส่รหัสทีมต้นสังกัดท้ายชื่อ' },
    ];
    var total = defs.reduce(function (a, def) { return a + cats[def.k].length; }, 0);
    var hd = '<div class="sectionlabel" style="' + (total ? 'background:#fff4e6;border-left:4px solid #f59e0b' : 'background:#e8f5e9;border-left:4px solid #16a34a') + ';padding:8px 12px;border-radius:8px">🩺 <b>ตรวจข้อมูล</b> · ' +
      (total ? 'พบ <b class="badd">' + total + '</b> จุดที่ควรแก้ในชีต' : '<b class="okk">ไม่พบปัญหา — ข้อมูลครบถูกต้อง ✅</b>') + ' <span class="muted">(แก้ที่ชีตต้นทาง แล้วกด 🔄 รีเฟรช)</span></div>';
    var body = '';
    defs.forEach(function (def) {
      var rows = cats[def.k]; if (!rows.length) return;
      var trs = rows.map(function (x) { return '<tr><td>' + rbEsc_(x.team) + '</td><td class="b">' + rbEsc_(x.who) + '</td><td>' + rbEsc_(x.detail) + '</td></tr>'; }).join('');
      body += rbTblCard_(def.t + ' <span class="badge tnum">' + rows.length + '</span>',
        '<tr><th>ทีม</th><th>ใคร / ไฟลท์</th><th>รายละเอียด</th></tr>', trs, '<span class="muted" style="font-size:12px">' + def.hint + '</span>');
    });
    if (!body) body = '<div class="tablecard"><div class="panel okk" style="text-align:center;padding:24px">✅ ทุกทีมข้อมูลครบ ไม่พบจุดที่ต้องแก้</div></div>';
    return hd + body;
  } catch (e) { return '<div class="panel">ตรวจข้อมูลไม่ได้: ' + rbEsc_(e && e.message) + '</div>'; }
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
      return '<tr class="' + (p.total > OT_WEEK_LIMIT ? 'rowbad' : '') + '" data-team="' + rbEsc_(p.team) + '"><td class="b">' + rbEsc_(p.name) + '</td><td>' +
        rbEsc_(p.team) + '</td><td>' + rbEsc_(p.pos) + '</td>' + tds + '<td class="tnum"><b>' + p.total + 'h</b></td><td>' + status + '</td></tr>';
    }).join('');
    var hd = '<div class="sectionlabel">สัปดาห์ ' + wk.startDay + '-' + wk.endDay + ' · อ่าน ' + wk.daysRead.length +
      ' วัน · <b class="badd">เกิน ' + OT_WEEK_LIMIT + ' ชม.: ' + wk.over.length + ' คน</b></div>';
    return hd + '<div class="tablecard"><div class="tablecard__hd"><h3>⏱️ OT รายสัปดาห์ (เกิน ' + OT_WEEK_LIMIT + ' ชม./สัปดาห์)</h3>' + rbCtrls_('view-ot', true) + '</div>' +
      '<div style="overflow-x:auto"><table class="tbl"><thead>' + th + '</thead><tbody>' +
      (rows || '<tr><td colspan="' + (dayCols.length + 5) + '" class="muted">ยังไม่มีข้อมูล OT ในสัปดาห์นี้</td></tr>') +
      '</tbody></table></div></div>';
  } catch (e) { return '<div class="panel">โหลด OT รายสัปดาห์ไม่ได้: ' + rbEsc_(e.message) + '</div>'; }
}

// ── KPI hero ────────────────────────────────────────────────────────────────
function rbKpiHero_(C, master, shortCount, fltTotal, urgent) {
  var attPct = C.staff>0 ? Math.round((C.working)/C.staff*100) : 0;
  var avg = C.otPeople>0 ? Math.round(C.otHours/C.otPeople*10)/10 : 0;
  var okFlt = Math.max(0, (fltTotal||0) - (shortCount||0));
  function chip(cl, lb, n){ return '<span class="hchip"><i style="background:'+cl+'"></i>'+lb+' <b class="tnum">'+n+'</b></span>'; }
  // ── Hero: attendance donut + working/total + OFF/OT-OFF/Sick chips (AOT gradient) ──
  var hero = '<div class="hero rise">' +
      '<div class="hero__ring" style="background:conic-gradient('+CI.sky+' 0 '+attPct+'%,rgba(255,255,255,.16) '+attPct+'% 100%)">' +
        '<div class="hero__ring-in"><div class="hero__pct tnum">'+attPct+'%</div><div class="hero__pctl">Attendance</div></div></div>' +
      '<div class="hero__main">' +
        '<div class="hero__lbl">มาปฏิบัติงานวันนี้'+(master?(' · Active '+(master.PSA.total+master.LL.total)):'')+'</div>' +
        '<div class="hero__big"><span class="tnum">'+C.working+'</span><span class="hero__tot"> / '+C.staff+'</span></div>' +
        '<div class="hero__chips">'+chip('#8fa6c4','OFF',C.off)+chip(CI.yellow,'OT OFF',C.ot_off)+chip(CI.red,'Sick',C.sick)+(C.leave?chip('#5ea9e6','Vac',C.leave):'')+'</div>' +
      '</div>' +
      '<div class="hero__kpis">' +
        '<div class="hkpi"><div class="hkpi__n tnum">'+C.otPeople+'</div><div class="hkpi__l">OT · People</div><div class="hkpi__s">คนทำ OT วันนี้</div></div>' +
        '<div class="hkpi"><div class="hkpi__n tnum">'+C.otHours+'<span class="hkpi__u">h</span></div><div class="hkpi__l">OT · Hours</div><div class="hkpi__s">เฉลี่ย '+avg+'h / คน</div></div>' +
        '<div class="hkpi"><div class="hkpi__n tnum" style="color:'+(shortCount>0?'#ffd0cb':'#bff0da')+'">'+(shortCount||0)+'</div><div class="hkpi__l">ไฟลท์ขาดคน</div><div class="hkpi__s">ต่ำกว่า SLA</div></div>' +
        '<div class="hkpi"><div class="hkpi__n tnum">'+(fltTotal||0)+'</div><div class="hkpi__l">ไฟลท์วันนี้</div><div class="hkpi__s">'+okFlt+' ครบ SLA</div></div>' +
      '</div></div>';
  // ── Urgent flights strip (top short flights) ──
  var urg = '';
  if (urgent && urgent.length) {
    urg = '<div class="urgent rise"><div class="urgent__hd"><h3>🚨 ไฟลท์ต้องเสริมด่วน</h3><button class="urgent__all" onclick="showView(\'flt\');loadFlt()">ดูทั้งหมด '+shortCount+' ไฟลท์ →</button></div>' +
      '<div class="urgent__list">' + urgent.slice(0,4).map(function(u){
        return '<div class="ufl"><div class="ufl__l"><div class="ufl__flt">'+rbEsc_(u.flt)+'</div><div class="ufl__std">STD '+rbEsc_(u.std||'—')+' · '+rbEsc_(u.team||'')+'</div></div>' +
          '<div class="ufl__x">'+rbEsc_(u.txt||'ขาดคน')+'</div></div>';
      }).join('') + '</div></div>';
  }
  return hero + urg;
}

// ── table rows ──────────────────────────────────────────────────────────────
function rbBarMini_(pct){ return '<div class="barmini"><i style="width:'+pct+'%"></i><b>'+pct+'%</b></div>'; }
function rbAggRowHtml_(label, b) {
  var work = b.working + b.ot_off, tr = b.training || 0, avail = Math.max(0, work - tr);
  var pct = b.staff>0 ? Math.round(work/b.staff*100) : 0;
  var trCell = tr ? ('<b class="badd">' + tr + '</b> <span class="muted">→ว่าง ' + avail + '</span>') : '<span class="muted">—</span>';
  return '<tr><td class="b">' + rbEsc_(label) + '</td><td class="tnum">' + b.staff + '</td><td class="tnum"><b>' + work +
    '</b></td><td class="tnum">' + trCell + '</td><td class="tnum">' + b.off + '</td><td class="tnum">' + b.sick + '</td><td class="tnum">' + b.leave + '</td><td class="tnum">' + rbOtTxt_(b.ot_off, b.otOffHrs) +
    '</td><td class="tnum">' + rbOtTxt_(b.otPre, b.otPreHrs) + '</td><td class="tnum">' + rbOtTxt_(b.otPost, b.otPostHrs) +
    '</td><td style="min-width:90px">' + rbBarMini_(pct) + '</td></tr>';
}
function rbTeamRows_(teams, order){ return order.map(function(t){ return rbAggRowHtml_(t, teams[t]); }).join(''); }
/** Lazy view: 📆 ภาพรวมไฟลท์ทั้งสัปดาห์ (7 วัน) — ไฟลท์/เวลา/เครื่อง/จำนวนคนที่ต้องใช้ ตาม SLA จากตารางบิน */
function rbWeekFlightsHtml(iso) {
  try {
    var date = iso ? rbDateFromIso_(iso) : new Date();
    var week = wfWeekSummary_((typeof wfFileId_ === 'function' ? wfFileId_() : ''), date);   // ไม่มีไฟล์ตารางบิน → wfWeekSummary_ ใช้ assignment แทน
    if (week && week._noAccess) return rbNoAccessCard_('ตารางบิน (Weekly Flight)', week._noAccess);
    if (!week) return '<div class="panel muted" style="padding:22px">ไม่มีข้อมูลไฟลท์ (ทั้งตารางบินและ assignment)</div>';
    var anyFound = week.some(function (d) { return d.found; });
    if (!anyFound) {
      var pres = (week._tabsPresent && week._tabsPresent.length)
        ? '<br><span class="muted">แท็บที่มีในไฟล์ตารางบินตอนนี้: <b>' + rbEsc_(week._tabsPresent.join(', ')) + '</b></span>'
        : '';
      return '<div class="panel muted" style="padding:22px">สัปดาห์นี้ยังไม่มีไฟลท์ — ทั้งในไฟล์ตารางบิน (แท็บ DDMON เช่น <b>' + rbEsc_(week[0] ? week[0].label.split(' ')[0] : '13JUL') + '</b>) และในไฟล์ assignment รายวัน' + pres + '</div>';
    }
    var wSum = { SUP: 0, CI: 0, GATE: 0, ARR: 0, bodies: 0, nFlt: 0 };
    var rows = week.map(function (d) {
      if (!d.found) return '<tr class="muted"><td class="b">' + rbEsc_(d.label) + '</td><td colspan="7" style="text-align:center">— ไม่มีแท็บวันนี้ —</td></tr>';
      var t = d.tot; ['SUP', 'CI', 'GATE', 'ARR'].forEach(function (p) { wSum[p] += t[p]; }); wSum.bodies += d.bodies; wSum.nFlt += d.nFlt;
      return '<tr><td class="b">' + rbEsc_(d.label) + (d.fromAsg ? ' <span class="okk" style="font-size:9px" title="ดึงจากไฟล์ assignment (ไม่มีในตารางบิน)">·asg</span>' : '') + '</td><td class="tnum">' + d.nFlt + (d.nCancel ? ' <span class="badd">ยก' + d.nCancel + '</span>' : '') +
        '</td><td class="tnum">' + t.SUP + '</td><td class="tnum">' + t.CI + '</td><td class="tnum">' + t.GATE + '</td><td class="tnum">' + t.ARR +
        '</td><td class="tnum b" style="background:#eef6ff">' + d.bodies + '</td><td class="tnum">' + (d.peakHr ? (d.peakHr + ':00·' + d.peakN) : '-') + '</td></tr>';
    }).join('');
    var foot = '<tr style="border-top:2px solid #1f4e79;font-weight:700"><td>รวมสัปดาห์</td><td class="tnum">' + wSum.nFlt + '</td><td class="tnum">' + wSum.SUP +
      '</td><td class="tnum">' + wSum.CI + '</td><td class="tnum">' + wSum.GATE + '</td><td class="tnum">' + wSum.ARR + '</td><td class="tnum" style="background:#dceafe">' + wSum.bodies + '</td><td></td></tr>';
    var sum = rbTblCard_('📆 ภาพรวมกำลังคนรายสัปดาห์ (ตาม SLA จากตารางบิน)',
      '<tr><th>วันที่</th><th>ไฟลท์</th><th>SUP</th><th>Check-in</th><th>Gate</th><th>Arrival</th><th>คน~</th><th>พีคออก</th></tr>', rows + foot,
      '<span class="muted" style="font-weight:400">คน~ = ผลรวมคน·ไฟลท์ (person-slots · เกทใช้คนเช็คอินต่อ) ใช้เทียบภาระแต่ละวัน — คนจริงน้อยกว่านี้ (1 คนทำหลายไฟลท์) · พีคออก = ชั่วโมงบินออกมากสุด</span>');
    var det = week.filter(function (d) { return d.found; }).map(function (d) {
      var fr = d.flights.map(function (f) {
        var r = f.req, cls = f.cancelled ? ' style="text-decoration:line-through;opacity:.5"' : '';
        return '<tr' + cls + '><td class="b">' + rbEsc_(f.flight) + '</td><td>' + rbEsc_(f.airline) + '</td><td class="tnum">' + rbEsc_(f.sta || '–') + '/' + rbEsc_(f.std || '–') +
          '</td><td>' + rbEsc_(f.ac || '<span class="badd">?</span>') + '</td><td class="tnum">' + r.SUP + '</td><td class="tnum">' + r.CI + '</td><td class="tnum">' + r.GATE +
          '</td><td class="tnum">' + r.ARR + '</td><td class="tnum b">' + wfBodies_(r) + '</td></tr>';
      }).join('');
      return '<details style="margin-top:8px"><summary style="cursor:pointer;padding:9px 13px;background:#eef6ff;border-radius:8px;font-weight:600">' +
        rbEsc_(d.label) + ' — ' + d.nFlt + ' ไฟลท์ · คน~ <b>' + d.bodies + '</b>' + (d.nCancel ? ' · <span class="badd">ยกเลิก ' + d.nCancel + '</span>' : '') + '</summary>' +
        '<div style="overflow-x:auto;margin-top:4px">' + rbTblCard_('',
          '<tr><th>Flight</th><th>สาย</th><th>STA/STD</th><th>เครื่อง</th><th>SUP</th><th>CI</th><th>Gate</th><th>Arr</th><th>คน~</th></tr>', fr, '') + '</div></details>';
    }).join('');
    return sum + '<div class="sectionlabel" style="margin-top:14px">📋 รายไฟลท์ต่อวัน <span class="muted">(กดวันเพื่อกางดู)</span></div>' + det;
  } catch (e) { return '<div class="panel" style="padding:20px">ภาพรวมสัปดาห์ผิดพลาด: ' + rbEsc_(e.message) + '</div>'; }
}
/** การ์ดแจ้ง: เปิดไฟล์ไม่ได้เพราะบัญชีที่รันสคริปต์ไม่มีสิทธิ์ — บอกอีเมลที่ต้องแชร์ให้ + ลิงก์ไฟล์ */
function rbNoAccessCard_(what, fileId) {
  var acct = '';
  try { acct = Session.getEffectiveUser().getEmail(); } catch (e) {}
  return '<div class="panel" style="padding:22px">' +
    '<b>⚠️ เปิดไฟล์' + rbEsc_(what) + 'ไม่ได้ — บัญชีที่รันสคริปต์ไม่มีสิทธิ์เข้าถึง</b>' +
    '<div class="muted" style="margin-top:8px;line-height:1.7">วิธีแก้: เปิดไฟล์ใน Google Drive → ปุ่ม <b>Share</b> → เพิ่มอีเมล' +
    (acct ? ' <b>' + rbEsc_(acct) + '</b>' : ' <b>ที่ deploy เป็น "Execute as"</b>') + ' เป็น <b>Viewer/Editor</b> แล้วรีเฟรช<br>' +
    '(ไฟล์นี้ถูกสร้างด้วยอีกบัญชี ระบบเลยเปิดไม่ได้ — แชร์ครั้งเดียวจบ)</div>' +
    '<div style="margin-top:10px"><a href="https://docs.google.com/spreadsheets/d/' + rbEsc_(fileId) + '" target="_blank">🔗 เปิดไฟล์เพื่อกด Share</a></div></div>';
}
/** การ์ดเตือน: คนที่อยู่ในเวรวันนี้แต่ไม่มีรหัสในไฟล์รายชื่อ (master) → ให้ไปเพิ่มใน master ให้ครบ
 *  (ตัดแถว SUPPORT/รหัสจำลองออก · เทียบเฉพาะรหัสจริง 6-8 หลัก) */
function rbMasterMissingCard_(res, ll, master) {
  if (!master || !master.ids) return '';
  var miss = [], seen = {};
  function scan(team, r) {
    var id = String(r.id || '').trim();
    if (!/^\d{6,8}$/.test(id)) return;                         // ข้ามแถวซัพ/รหัสจำลอง (SUP...)
    if (master.ids[id] || seen[id]) return;
    seen[id] = 1; miss.push({ team: team, id: id, name: r.name || '' });
  }
  Object.keys(res.teams).forEach(function (t) { (res.teams[t].records || []).forEach(function (r) { scan(t, r); }); });
  if (ll && ll.sections) Object.keys(ll.sections).forEach(function (s) { (ll.sections[s].records || []).forEach(function (r) { scan('LL·' + s, r); }); });
  if (!miss.length) return '';
  miss.sort(function (a, b) { return a.team < b.team ? -1 : a.team > b.team ? 1 : 0; });
  var rows = miss.map(function (m) {
    return '<tr><td>' + rbEsc_(m.team) + '</td><td class="tnum">' + rbEsc_(m.id) + '</td><td class="b">' + rbEsc_(m.name) + '</td></tr>';
  }).join('');
  return '<div style="margin-top:16px">' + rbTblCard_('⚠️ ในเวรวันนี้แต่ไม่มีรหัสในไฟล์รายชื่อ (master) — ' + miss.length + ' คน',
    '<tr><th>ทีม(แท็บเวร)</th><th>รหัส</th><th>ชื่อ</th></tr>', rows,
    '<span class="muted" style="font-weight:400">ทำให้ยอดทีมไม่ตรง master · เพิ่มคนเหล่านี้เข้าไฟล์รายชื่อให้ครบ</span>') + '</div>';
}
function rbPosRows_(positions, order) {
  return order.map(function (p) {
    var b = positions[p]; if (!b) return '';
    return '<tr><td class="b">' + p + '</td><td class="tnum">' + b.staff + '</td><td class="tnum"><b>' + (b.working + b.ot_off) +
      '</b></td><td class="tnum">' + rbOtTxt_(b.ot_off, b.otOffHrs) + '</td><td class="tnum">' + b.off + '</td><td class="tnum">' + b.sick +
      '</td><td class="tnum">' + b.leave + '</td><td class="tnum">' + rbOtTxt_(b.otPre, b.otPreHrs) + '</td><td class="tnum">' +
      rbOtTxt_(b.otPost, b.otPostHrs) + '</td></tr>';
  }).join('');
}
function rbFlightChips_(assigns, team, owner) {
  if (!assigns || !assigns.length) return '<span class="muted">—</span>';
  var chips = assigns.map(function (a) {
    var t = a.task ? (' <span class="tag">'+rbEsc_(a.task)+'</span>') : '';
    var sta = (a.STA||a.STD) ? (' '+(a.STA||'–')+'/'+(a.STD||'–')) : '';
    var op = (a.OP||a.CL) ? (' <span class="muted">'+(a.OP||'–')+'-'+(a.CL||'–')+'</span>') : '';
    var isFl = acIsFlight_(a.flight);
    var sup = isFl && owner && team && !slaSkipTeam_(team) && owner[slaAirlineOf_(a.flight)] && owner[slaAirlineOf_(a.flight)] !== team;
    var cls = !isFl ? 'chip chip--duty' : (sup ? 'chip chip--sup' : 'chip');   // ซัพพอร์ตข้ามทีม = ส้ม
    return '<span class="'+cls+'" style="cursor:default">' + rbEsc_(a.flight) + (sup ? ' 🔁' : '') + t + sta + op + '</span>';
  }).join('');
  return '<div class="chipgroup">' + chips + '</div>';      // flex-wrap container กันชิปซ้อนกัน
}
function rbFltCount_(assigns) {                              // นับเฉพาะรหัสไฟลท์จริง (ให้ตรงกับแท็บตรวจ Assign)
  return (assigns || []).filter(function (a) { return acIsFlight_(a.flight); }).length;
}
function rbTtRows_(res, ll) {
  var rows = [];
  var owner = acOwnerTeams_(res, ll);   // ทีมเจ้าของแต่ละสายการบิน (ไว้มาร์คไฟลท์ซัพพอร์ตข้ามทีม)
  Object.keys(res.teams).forEach(function (t){ res.teams[t].records.forEach(function(r){ rows.push(r); }); });
  if (ll && ll.totals.staff>0) Object.keys(ll.sections).forEach(function(s){ ll.sections[s].records.forEach(function(r){ rows.push(r); }); });
  var ord={working:0,ot_off:1,off:2,vac:3,sick:4};
  rows.sort(function(a,b){ return String(a.team).localeCompare(String(b.team)) || ((ord[a.bucket]||0)-(ord[b.bucket]||0)) || ((a.shiftStart==null?99999:a.shiftStart)-(b.shiftStart==null?99999:b.shiftStart)); });
  var STLB={off:'⬛ OFF',sick:'🔴 SL (ป่วย)',vac:'🌴 ลา'}, STCLS={off:'row-off',sick:'row-sl',vac:'row-vac'};
  return rows.map(function (r) {
    var st = r.shiftStart==null?99999:r.shiftStart;
    var lbl = STLB[r.bucket];
    if (lbl) {   // OFF / SL / ลา — แสดงสถานะ ไฮไลท์สี ไม่มีไฟลท์/OT
      return '<tr class="'+STCLS[r.bucket]+'" data-team="'+rbEsc_(r.team)+'" data-start="'+st+'"><td class="b">'+rbEsc_(r.team)+
        '</td><td class="tnum">'+rbEsc_(r.id||'')+'</td><td>'+rbEsc_(r.name)+'</td><td>'+rbEsc_(r.pos||'')+'</td><td class="b">'+lbl+
        '</td><td class="muted">—</td><td class="tnum">0</td><td class="muted">—</td></tr>';
    }
    var sh = rbEsc_(r.shift||'') + (r.shiftTime&&r.shiftTime!==r.shift ? ' <span class="muted">'+r.shiftTime+'</span>' : '');
    var hs = (typeof slaHoursStat_==='function') ? slaHoursStat_(r.shiftHrs, r.ot, r.bucket, r) : null;   // สถานะชั่วโมงตามระเบียบ (กะ 7-12ช · ot_off นับแค่ OT)
    var ot = r.ot ? ((r.bucket==='ot_off'?'<span class="tag">OFF</span>':(r.otType==='PRE'?'<span class="tag">ก่อน</span>':'<span class="tag">หลัง</span>'))+' '+(r.otTime||'')+' <span class="muted">('+r.ot+'h)</span>') : '<span class="muted">—</span>';
    if (hs) ot += ' <span class="muted">· รวม '+hs.total+'ช</span>' + (hs.level!=='ok' ? ' <span class="'+(hs.level==='short'?'tag':'badd')+'">⚠️ '+rbEsc_(hs.txt)+'</span>' : '');
    var _src = {master:'·จากรายชื่อ', map:'·จากตารางแมป', '':'·จากชื่อในเวร'};
    var _srcTitle = {master:' (ค้นจากไฟล์รายชื่อพนักงาน)', map:' (จากตาราง Master_Mapping)', '':' (ค้นจากชื่อในเวรวันนี้)'};
    var supAutoLbl = r.supportTeamAuto ? ' <span class="muted">'+(_src[r.supportTeamSrc||'']||'·จากชื่อ')+'</span>' : '';
    var supTag = r.support ? ' <span class="tag" title="มาช่วยจากทีม '+rbEsc_(r.supportTeam||'')+(r.supportTeamAuto?(_srcTitle[r.supportTeamSrc||'']||''):'')+'">🤝 ซัพจาก '+rbEsc_(r.supportTeam||'?')+supAutoLbl+'</span>' : '';
    return '<tr data-team="'+rbEsc_(r.team)+'" data-start="'+st+'"><td class="b">'+rbEsc_(r.team)+'</td><td class="tnum">'+rbEsc_(r.support?'ซัพ':(r.id||''))+
      '</td><td>'+rbEsc_(r.name)+supTag+'</td><td>'+rbEsc_(r.pos||'')+'</td><td>'+sh+'</td><td>'+ot+'</td><td class="tnum">'+rbFltCount_(r.assignments)+
      '</td><td>'+rbFlightChips_(r.assignments, r.team, owner)+'</td></tr>';
  }).join('');
}
/** CSS สำหรับมุมมอง Gantt รายคน (แถบเวลา 24 ชม.) */
function rbGanttCss_() {
  return '<style>'+
  '.gt{border:1px solid #d7e3f0;border-radius:12px;overflow:hidden;background:#fff}'+
  '.gt-scroll{max-height:72vh;overflow-y:auto;overflow-x:hidden}'+
  '.gt-row{display:grid;grid-template-columns:186px 1fr;align-items:stretch;border-bottom:1px solid #eef3f9}'+
  '.gt-row:last-child{border-bottom:0}'+
  '.gt-ruler{position:sticky;top:0;z-index:3;background:#f6f9fd;border-bottom:1px solid #d7e3f0}'+
  '.gt-lbl{padding:7px 10px;border-right:1px solid #eef3f9;display:flex;flex-direction:column;justify-content:center;line-height:1.2;background:#fff}'+
  '.gt-ruler .gt-lbl{background:#f6f9fd;font-weight:700;color:#1f4e79;font-size:12px}'+
  '.gt-lbl b{font-size:13px;color:#12242f;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'+
  '.gt-lbl small{font-size:10.5px;color:#5b7189;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'+
  '.gt-axis{position:relative;height:26px}'+
  '.gt-tick{position:absolute;top:5px;font-size:10.5px;color:#5b7189;transform:translateX(-50%);font-variant-numeric:tabular-nums}'+
  '.gt-track{position:relative;min-height:44px;background:'+
    'repeating-linear-gradient(90deg,#eef3f9 0 1px,transparent 1px,transparent calc(100%/24)),'+
    'repeating-linear-gradient(90deg,#dbe6f2 0 1px,transparent 1px,transparent calc(100%/12))}'+
  '.gt-seg{position:absolute;top:5px;height:20px;border-radius:6px;display:flex;align-items:center;padding:0 7px;overflow:hidden;box-shadow:0 1px 3px rgba(16,40,64,.18);min-width:3px}'+
  '.gt-seg span{font-size:11px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'+
  '.gt-shift{background:linear-gradient(180deg,#2f74ad,#245d8f);color:#fff}'+
  '.gt-ot{background:linear-gradient(180deg,#f7b733,#e39a10);color:#3a2800}'+
  '.gt-flt{position:absolute;height:16px;border-radius:5px;padding:0 5px;display:flex;align-items:center;overflow:hidden;min-width:3px;z-index:1;border:1px solid}'+
  '.gt-flt span{font-size:10px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'+
  '.gt-flt.ci{background:#dcebfa;border-color:#a8c6e6}.gt-flt.ci span{color:#1f4e79}'+
  '.gt-flt.gate{background:#dcf2e4;border-color:#96d1ab}.gt-flt.gate span{color:#1c7a4f}'+
  '.gt-flt.arr{background:#ece8fb;border-color:#c1b9e8}.gt-flt.arr span{color:#584fb0}'+
  '.gt-flt.sod{background:#d6efee;border-color:#5cb8b6}.gt-flt.sod span{color:#0f6f6d}'+   /* หัวหน้า/SOD */
  '.gt-flt.lp{background:#fbe3ee;border-color:#e2a3c6}.gt-flt.lp span{color:#a33272}'+   /* โซน LP (Private/LP) */
  '.gt-flt.stby{background:repeating-linear-gradient(45deg,#f2f4f7,#f2f4f7 6px,#e7ebf1 6px,#e7ebf1 12px);border:1px dashed #aab6c4}.gt-flt.stby span{color:#6b7b8e}'+   /* STBY รอจัดไฟลท์ */
  '.gt-flt.na{background:#eef1f5;border-color:#d3ddea}.gt-flt.na span{color:#5b7189}'+
  '.gt-flt.sup{border-color:#e39a10;border-width:1.5px}'+
  '.gt-now{position:absolute;top:0;bottom:0;width:2px;background:#e5484d;z-index:2;pointer-events:none}'+
  '.gt-hideoff .gt-dim{display:none}'+
  '.gt-tip{position:fixed;z-index:99999;display:none;background:#0f2438;color:#eaf3fb;padding:9px 12px;border-radius:10px;font-size:12px;line-height:1.55;box-shadow:0 10px 30px rgba(0,0,0,.32);pointer-events:none;max-width:280px;border:1px solid #24445f}'+
  '.gt-tip>div{color:#b7cfe6}'+
  '.gt-tip>.gt-tip-h{color:#fff;font-weight:800;font-size:13.5px;margin-bottom:2px}'+
  '.gt-seg,.gt-flt{cursor:default}'+
  '.gt-lg{display:inline-flex;align-items:center;gap:4px;margin-right:10px;font-size:11px;color:#5b7189}'+
  '.gt-lg i{width:11px;height:11px;border-radius:3px;display:inline-block;border:1px solid}'+
  '.gt-status{position:absolute;top:11px;left:8px;font-size:11.5px;font-weight:700;padding:2px 10px;border-radius:6px}'+
  '.gt-status.off{background:#eef1f5;color:#5b7189}.gt-status.sl{background:#fbe9ec;color:#c93a4e}.gt-status.vac{background:#e8f1fa;color:#1f4e79}'+
  '.gt-dim{opacity:.7}'+
  '.gt-search{padding:6px 12px;border:1px solid #cfddec;border-radius:8px;font-family:inherit;font-size:13px;min-width:180px}'+
  '@media(max-width:640px){.gt-row{grid-template-columns:120px 1fr}.gt-seg span{font-size:9.5px}}'+
  '</style>';
}
/** เฟสของไฟลท์จากรหัสงาน → สีป้าย (ci/gate/arr/na) */
function rbFltPhase_(task) {
  // ใช้ตัวจำแนกเฟสตัวเดียวกับ SLA/ตรวจ Assign (slaPhasesOf_) เพื่อไม่ให้ตีความต่างกัน
  // — รวมรหัสเกททั้งตระกูล (G/GA/GB/GC/GK/GM/D/I/PFD/BOARD) ที่ regex เดิมจับไม่ครบ
  var phs = (typeof slaPhasesOf_ === 'function') ? slaPhasesOf_(task) : null;
  if (phs && phs.length) {
    if (phs.indexOf('GATE') >= 0) return 'gate';                 // มีเกท → ทำถึงเครื่องออก (STD)
    if (phs.indexOf('ARR') >= 0 && phs.indexOf('CI') < 0) return 'arr';   // ขาเข้าล้วน → รับเครื่องรอบ STA
    if (phs.indexOf('CI') >= 0) return 'ci';
    if (phs.indexOf('ARR') >= 0) return 'arr';
    if (phs.indexOf('SUP') >= 0) return 'sod';                   // หัวหน้า/FC/SOD ล้วน (คุมงาน) → สีแยก
  }
  return 'na';
}
/** มุมมอง Gantt: 1 คน = 1 แถบเวลา 24 ชม. (กะ=น้ำเงิน · OT=ส้ม · ไฟลท์=สีตามเฟส) · nowMin>=0 → เส้นเวลาปัจจุบัน */
function rbTtGantt_(res, ll, nowMin) {
  if (nowMin == null) nowMin = -1;
  var owner = acOwnerTeams_(res, ll);
  var rows = [];
  Object.keys(res.teams).forEach(function (t) { res.teams[t].records.forEach(function (r) { rows.push(r); }); });
  if (ll && ll.totals.staff > 0) Object.keys(ll.sections).forEach(function (s) { ll.sections[s].records.forEach(function (r) { rows.push(r); }); });
  var ord = { working: 0, ot_off: 1, off: 2, vac: 3, sick: 4 };
  rows.sort(function (a, b) { return String(a.team).localeCompare(String(b.team)) || ((ord[a.bucket] || 0) - (ord[b.bucket] || 0)) || ((a.shiftStart == null ? 99999 : a.shiftStart) - (b.shiftStart == null ? 99999 : b.shiftStart)); });
  function pmin(s) { var m = String(s || '').match(/(\d{1,2})[:.](\d{2})/); return m ? (+m[1] * 60 + +m[2]) : null; }
  function pct(m) { return (m / 1440 * 100); }
  function seg(lo, hi, cls, label, tip) {
    var out = '';
    function one(a, b) { if (b <= a) return; out += '<div class="gt-seg ' + cls + '" style="left:' + pct(a) + '%;width:' + pct(b - a) + '%" data-tip="' + rbAttr_(tip || label) + '"><span>' + rbEsc_(label) + '</span></div>'; }
    while (lo >= 1440) { lo -= 1440; hi -= 1440; }            // ช่วงที่เริ่มหลัง 24:00 (OT หลังเที่ยงคืนที่จัด timeline แล้ว) → ดึงกลับเข้าวันก่อนวาด
    if (hi > 1440) { one(lo, 1440); one(0, hi - 1440); } else one(lo, hi);
    return out;
  }
  var STLB = { off: 'OFF', sick: 'SL (ป่วย)', vac: 'ลา' }, STCLS = { off: 'off', sick: 'sl', vac: 'vac' };
  var ticks = '';
  for (var h = 0; h <= 24; h += 2) ticks += '<span class="gt-tick" style="left:' + pct(h * 60) + '%">' + ('0' + h).slice(-2) + '</span>';
  var ruler = '<div class="gt-row gt-ruler"><div class="gt-lbl">คน (' + rows.length + ')</div><div class="gt-axis">' + ticks + '</div></div>';
  var body = rows.map(function (r) {
    var dn = rbAttr_(String(r.name + ' ' + r.team + ' ' + (r.id || '')).toLowerCase());
    var bkkTag = r.bkk ? ' <span style="font:600 8.5px/1 monospace;background:#eef2ff;color:#3b5bdb;padding:1px 4px;border-radius:4px;vertical-align:1px">BKK</span>' : '';   // พนักงาน BKK มาช่วย (ID ขึ้นต้น B)
    var head = '<div class="gt-lbl"><b>' + rbEsc_(r.name) + bkkTag + '</b><small>' + rbEsc_(r.team) + (r.pos ? ' · ' + rbEsc_(r.pos) : '') + '</small></div>';
    var stl = STLB[r.bucket];
    if (stl) return '<div class="gt-row gt-dim" data-team="' + rbEsc_(r.team) + '" data-name="' + dn + '">' + head + '<div class="gt-track"><div class="gt-status ' + STCLS[r.bucket] + '">' + stl + '</div>' + (nowMin >= 0 ? '<div class="gt-now" style="left:' + pct(nowMin) + '%"></div>' : '') + '</div></div>';
    var du = acDuty_(r), track = '';
    var isOtOff = r.bucket === 'ot_off';
    var barLo = isOtOff ? du.ds : du.ss, barHi = isOtOff ? du.de : du.se;   // OT OFF = วันหยุดมาทำ OT → แถบคือช่วง OT (ds/de)
    if (barLo != null && barHi != null) {
      var shTxt = isOtOff ? ('OT' + (r.ot ? ' ' + r.ot + 'h' : '') + ' ' + rrFmtMin_(barLo) + '-' + rrFmtMin_(barHi % 1440))
                          : ((r.shift || '') + ' ' + (r.shiftTime || (rrFmtMin_(du.ss) + '-' + rrFmtMin_(du.se % 1440))));
      track += seg(barLo, barHi, isOtOff ? 'gt-ot' : 'gt-shift', shTxt.trim(),
        r.name + '¦' + (isOtOff ? 'มาทำ OT (วันหยุด)' : ('กะ ' + shTxt)) + '¦' + r.team + (r.pos ? ' · ' + r.pos : ''));
    }
    if (r.bucket !== 'ot_off') {
      (du.otSegs || []).forEach(function (sg) {                // ใช้ช่วง OT ที่ acDuty_ จัด timeline แล้ว (PRE/POST จากเวลาจริง) → วางตรงตำแหน่ง ไม่หล่นซ้าย/ข้ามวัน
        var a = sg[0], b = sg[1];
        var pre = (du.ss != null && a < du.ss);
        track += seg(a, b, 'gt-ot', 'OT' + (r.ot ? ' ' + r.ot + 'h' : ''),
          r.name + '¦OT' + (r.ot ? ' ' + r.ot + ' ชม.' : '') + (pre ? ' (ก่อนกะ)' : ' (หลังกะ)') + '¦เวลา ' + rrFmtMin_(((a % 1440) + 1440) % 1440) + '-' + rrFmtMin_(((b % 1440) + 1440) % 1440));
      });
    }
    // เก็บช่วงเวลาไฟลท์ (วางตามเวลาที่ถูก assign จริง: เคาน์เตอร์ OP–CL ก่อน · ไม่งั้น STA–STD)
    var flts = [];
    (r.assignments || []).forEach(function (a) {
      if (!acIsFlight_(a.flight) && !(typeof acIsCoverWork_ === 'function' && acIsCoverWork_(a.flight))) return;   // ไฟลท์จริง + งานโซน/เคาน์เตอร์ (LP MORNING/AFTERNOON · Counter Gx · CHECK-IN COMMON) → วางแท่งด้วย
      // วางแถบตาม "เวลาของ JOB ที่ได้รับ assign" — ใช้ acFlightWin_ ตัวเดียวกับหน้า ตรวจ Assign
      //   (เช็คอิน OP–CL · เกท→STD · CS OP+2h · FR/GK→STD · ไม่มีเคาน์เตอร์→STA/STD · ตัดค่าขยะ/หน้าต่างเพี้ยน)
      var win = (typeof acFlightWin_ === 'function') ? acFlightWin_(a) : null;
      var capMax = (typeof AC_WIN_MAX !== 'undefined') ? AC_WIN_MAX : 840;
      if (!win || (win[1] - win[0]) > capMax) return;           // ไม่มีเวลา/หน้าต่างเพี้ยน → ไม่วางแถบ
      var lo = win[0], hi = win[1];
      if (hi - lo < 35) hi = lo + 35;                           // min 35 นาที ให้ป้ายพออ่าน
      var ph = /^LP\s+(MORNING|AFTERNOON|EVENING|NIGHT)/i.test(a.flight) ? 'lp' : rbFltPhase_(a.task);   // โซน LP → สีแยก
      var sup = owner && owner[slaAirlineOf_(a.flight)] && owner[slaAirlineOf_(a.flight)] !== r.team && !slaSkipTeam_(r.team);
      var leg1 = String(a.flight).split('/')[0].trim();   // ย่อเหลือขาแรก: "9C8665/9C8663" → "9C8665"
      var phL = { ci: 'เช็คอิน', gate: 'เกท', arr: 'ขาเข้า', sod: 'หัวหน้า/คุมงาน', lp: 'โซน LP', stby: 'STBY (รอจัดไฟลท์)', na: 'งาน' }[ph];
      var barTx = rrFmtMin_(((lo % 1440) + 1440) % 1440) + '-' + rrFmtMin_(((hi % 1440) + 1440) % 1440);
      var raw = (a.STD ? ('STD ' + a.STD) : '') + ((a.OP || a.CL) ? ((a.STD ? ' · ' : '') + 'เคาน์เตอร์ ' + (a.OP || '–') + '-' + (a.CL || '–')) : '');
      var tip = a.flight + (sup ? ' 🔁' : '') + '¦' + phL + (a.task ? ' · ' + a.task : '') + '¦ช่วงงาน ' + barTx + (raw ? '¦' + raw : '') + (sup ? '¦🔁 ซัพข้ามทีม' : '');
      flts.push({ lo: lo, hi: hi, ph: ph, sup: sup, lab: rbEsc_(leg1) + (sup ? ' 🔁' : ''), tip: rbAttr_(tip) });
    });
    // ทีมพูล/สแตนด์บาย (PVT/LP · CHARTER/ZF) ที่มาทำงานแต่ยังไม่มีงาน = STBY รอจัดไฟลท์ → แสดงแท่ง standby คลุมกะ (ไม่ปล่อยว่างเหมือนไม่มีงาน)
    if (!flts.length && r.bucket === 'working' && du.ss != null && du.se != null && typeof slaIsFloatTeam_ === 'function' && slaIsFloatTeam_(r.team)) {
      flts.push({ lo: du.ss, hi: du.se, ph: 'stby', sup: false, lab: 'STBY · รอ assign',
        tip: rbAttr_(r.name + '¦STBY (พูลสแตนด์บาย) — รอจัดไฟลท์¦' + r.team + (r.shiftTime ? ' · กะ ' + r.shiftTime : '')) });
    }
    // จัดเลนกันทับ: เรียงตามเวลาเริ่ม แล้ววางเลนแรกที่ว่าง
    flts.sort(function (x, y) { return x.lo - y.lo; });
    var laneEnd = [];
    flts.forEach(function (f) {
      var ln = -1;
      for (var i = 0; i < laneEnd.length; i++) { if (f.lo >= laneEnd[i] - 1) { ln = i; break; } }
      if (ln < 0) { ln = laneEnd.length; laneEnd.push(0); }
      laneEnd[ln] = f.hi; f.lane = ln;
    });
    var nLanes = laneEnd.length;
    flts.forEach(function (f) {
      var top = 30 + f.lane * 18;
      function fone(x, y) { if (y <= x) return; track += '<div class="gt-flt ' + f.ph + (f.sup ? ' sup' : '') + '" style="left:' + pct(x) + '%;width:' + pct(y - x) + '%;top:' + top + 'px" data-tip="' + f.tip + '"><span>' + f.lab + '</span></div>'; }
      if (f.hi > 1440) { fone(f.lo, 1440); fone(0, f.hi - 1440); } else fone(f.lo < 0 ? 0 : f.lo, f.hi);
    });
    if (nowMin >= 0) track += '<div class="gt-now" style="left:' + pct(nowMin) + '%"></div>';
    var H = nLanes ? (30 + nLanes * 18 + 6) : 44;
    return '<div class="gt-row" data-team="' + rbEsc_(r.team) + '" data-name="' + dn + '">' + head + '<div class="gt-track" style="height:' + H + 'px">' + track + '</div></div>';
  }).join('');
  return '<div class="gt"><div class="gt-scroll">' + ruler + body + '</div></div>' +
    '<div style="margin-top:8px">' +
    '<span class="gt-lg"><i style="background:#2f74ad;border-color:#245d8f"></i>กะ</span>' +
    '<span class="gt-lg"><i style="background:#f7b733;border-color:#e39a10"></i>OT</span>' +
    '<span class="gt-lg"><i style="background:#dcebfa;border-color:#a8c6e6"></i>เช็คอิน</span>' +
    '<span class="gt-lg"><i style="background:#dcf2e4;border-color:#96d1ab"></i>เกท</span>' +
    '<span class="gt-lg"><i style="background:#ece8fb;border-color:#c1b9e8"></i>ขาเข้า</span>' +
    '<span class="gt-lg"><i style="background:#d6efee;border-color:#5cb8b6"></i>หัวหน้า/SOD</span>' +
    '<span class="gt-lg"><i style="background:#fbe3ee;border-color:#e2a3c6"></i>โซน LP</span>' +
    '<span class="gt-lg"><i style="background:#e7ebf1;border:1px dashed #aab6c4"></i>STBY (รอจัดไฟลท์)</span>' +
    '<span class="gt-lg"><i style="background:#eef1f5;border-color:#d3ddea"></i>อื่น ๆ</span>' +
    '<span class="gt-lg"><i style="background:#e5484d;border-color:#e5484d;width:3px"></i>เวลาปัจจุบัน</span>' +
    '<span class="gt-lg">🔁 ซัพข้ามทีม (ขอบส้ม)</span>' +
    '<span class="muted" style="font-size:11px">· ไฟลท์วางตามเวลาเคาน์เตอร์/งานจริง · ทับกันแยกเป็นเลน</span></div>';
}
/** POC — Gantt "ข้อเสนอจัดเวรอัตโนมัติ" ราย 1 ทีม 1 วัน (อ่านอย่างเดียว ไม่แตะ assignment จริง)
 *  รัน apReplan_ → เอาเฉพาะคนของทีมที่เลือก มาวางแท่งงานที่ "ระบบเสนอ" ลง timeline รายคน
 *  ใช้หน้าต่างเวลาเดียวกับ ตรวจ Assign (slaPhaseWindow_/acFlightWin_) → ตำแหน่งตรงของจริง */
function rbProposeGanttHtml(iso, team) {
  try {
    var d = rbLoadResLL_(rbDateFromIso_(iso)), res = d.res, ll = d.ll;
    if (!res.teams[team]) return '<div class="panel">ไม่พบทีม ' + rbEsc_(team) + ' ในไฟล์วันนี้</div>';
    var rp = apReplan_(res, ll);
    var fIdx = {}; slaCollectFlights_(res, ll).forEach(function (f) { fIdx[f.flight] = f; });
    var PHT = { SUP: 'sod', CI: 'ci', ARR: 'arr', GATE: 'gate' };
    var byName = {};                                                       // ชื่อ → [ {flight, ph, win:[lo,hi], std} ] เฉพาะคนทีมนี้
    (rp.plan || []).forEach(function (pf) {
      var fobj = fIdx[pf.flight];
      ['SUP', 'CI', 'ARR', 'GATE'].forEach(function (ph) {
        (pf.assign[ph] || []).forEach(function (pv) {
          if (pv.team !== team) return;
          var win = fobj ? (slaPhaseWindow_(fobj, ph) || (typeof acFlightWin_ === 'function' ? acFlightWin_(fobj) : null)) : null;
          (byName[pv.name] = byName[pv.name] || []).push({ flight: pf.flight, ph: PHT[ph], win: win, std: pf.std });
        });
      });
    });
    function pct(m) { return (m / 1440 * 100); }
    var ticks = '';
    for (var h = 0; h <= 24; h += 2) ticks += '<span class="gt-tick" style="left:' + pct(h * 60) + '%">' + ('0' + h).slice(-2) + '</span>';
    var recs = res.teams[team].records.slice().sort(function (a, b) {
      return ((a.shiftStart == null ? 99999 : a.shiftStart) - (b.shiftStart == null ? 99999 : b.shiftStart)) || String(a.name).localeCompare(String(b.name));
    });
    var STLB = { off: 'OFF', sick: 'SL (ป่วย)', vac: 'ลา' }, STCLS = { off: 'off', sick: 'sl', vac: 'vac' };
    var nWork = 0, nAssigned = 0;
    var body = recs.map(function (r) {
      var head = '<div class="gt-lbl"><b>' + rbEsc_(r.name) + '</b><small>' + rbEsc_(r.pos || r.team) + '</small></div>';
      var stl = STLB[r.bucket];
      if (stl) return '<div class="gt-row gt-dim">' + head + '<div class="gt-track"><div class="gt-status ' + STCLS[r.bucket] + '">' + stl + '</div></div></div>';
      nWork++;
      var du = acDuty_(r), track = '';
      if (du.ss != null && du.se != null) {
        var seHi = (du.se % 1440 === 0 ? 1440 : du.se);
        track += '<div class="gt-seg gt-shift" style="left:' + pct(du.ss) + '%;width:' + pct(seHi - du.ss) + '%"><span>' +
          rbEsc_(((r.shift || '') + ' ' + (r.shiftTime || (rrFmtMin_(du.ss) + '-' + rrFmtMin_(du.se % 1440)))).trim()) + '</span></div>';
      }
      var flts = (byName[r.name] || []).filter(function (x) { return x.win && (x.win[1] - x.win[0]) < 840; }).map(function (x) {
        var lo = x.win[0], hi = x.win[1]; if (hi - lo < 35) hi = lo + 35;
        var phL = { ci: 'เช็คอิน', gate: 'เกท', arr: 'ขาเข้า', sod: 'หัวหน้า/คุมงาน' }[x.ph] || 'งาน';
        var tip = '🤖 เสนอ · ' + x.flight + '¦' + phL + '¦' + rrFmtMin_(((lo % 1440) + 1440) % 1440) + '-' + rrFmtMin_(((hi % 1440) + 1440) % 1440) + (x.std ? '¦STD ' + x.std : '');
        return { lo: lo, hi: hi, ph: x.ph, lab: rbEsc_(String(x.flight).split('/')[0].trim()), tip: rbAttr_(tip) };
      });
      if (flts.length) nAssigned++;
      flts.sort(function (a, b) { return a.lo - b.lo; });
      var laneEnd = [];
      flts.forEach(function (f) {
        var ln = -1; for (var i = 0; i < laneEnd.length; i++) { if (f.lo >= laneEnd[i] - 1) { ln = i; break; } }
        if (ln < 0) { ln = laneEnd.length; laneEnd.push(0); } laneEnd[ln] = f.hi; f.lane = ln;
      });
      flts.forEach(function (f) {
        var top = 30 + f.lane * 18;
        function fone(x, y) { if (y <= x) return; track += '<div class="gt-flt ' + f.ph + '" style="left:' + pct(x) + '%;width:' + pct(y - x) + '%;top:' + top + 'px" data-tip="' + f.tip + '"><span>' + f.lab + '</span></div>'; }
        if (f.hi > 1440) { fone(f.lo, 1440); fone(0, f.hi - 1440); } else fone(f.lo < 0 ? 0 : f.lo, f.hi);
      });
      var nLanes = laneEnd.length, H = nLanes ? (30 + nLanes * 18 + 6) : 44;
      return '<div class="gt-row">' + head + '<div class="gt-track" style="height:' + H + 'px">' + track + '</div></div>';
    }).join('');
    var ruler = '<div class="gt-row gt-ruler"><div class="gt-lbl">คน (' + recs.length + ')</div><div class="gt-axis">' + ticks + '</div></div>';
    var banner = '<div class="panel" style="background:#eef6ff;border:1px solid #b6d4f0;padding:10px 12px;margin-bottom:8px;border-radius:10px">' +
      '🤖 <b>ข้อเสนอจัดเวรอัตโนมัติ — ทีม ' + rbEsc_(team) + '</b> · <span class="muted">อ่านอย่างเดียว ไม่แตะ assignment จริง</span> · ขึ้นเวร ' + nWork + ' คน · เสนองานให้ ' + nAssigned + ' คน</div>';
    return banner + rbGanttCss_() + '<div class="gt"><div class="gt-scroll">' + ruler + body + '</div></div>' +
      '<div style="margin-top:8px">' +
      '<span class="gt-lg"><i style="background:#2f74ad;border-color:#245d8f"></i>กะ</span>' +
      '<span class="gt-lg"><i style="background:#dcebfa;border-color:#a8c6e6"></i>เช็คอิน</span>' +
      '<span class="gt-lg"><i style="background:#dcf2e4;border-color:#96d1ab"></i>เกท</span>' +
      '<span class="gt-lg"><i style="background:#ece8fb;border-color:#c1b9e8"></i>ขาเข้า</span>' +
      '<span class="gt-lg"><i style="background:#d6efee;border-color:#5cb8b6"></i>หัวหน้า/SOD</span>' +
      '<span class="muted" style="font-size:11px">· แท่ง = งานที่ระบบเสนอตามไฟลท์ · วางตามเวลาเคาน์เตอร์/งานจริง</span></div>';
  } catch (e) {
    return '<div class="panel">เสนอจัดเวรไม่ได้: ' + rbEsc_(e && e.message) + '</div>';
  }
}
function rbFltRows_(res, ll) {
  return slaCollectFlights_(res, ll).filter(function (f) { return !(f.noTime && f.fragment); }).map(function (f) {   // ซ่อนเศษขา (ขาที่สองซ้ำของไฟลท์ที่มีอยู่แล้ว)
    try {
      var R = slaRoles_(f.airline) || {};
      var asg = f.assigned || {}, req = f.req || {};
      function rc(n){ return '<td class="tnum">'+(n||0)+'</td>'; }
      // ตัวเลขที่ต่างตามชนิดเครื่อง (CI/ARR/Gate/รวม) ใช้ตาม req ที่จับเครื่องแล้ว · FC/GA/post คงจาก roles
      var sCI=(req.CI!=null?req.CI:R.CI), sARR=(req.ARR!=null?req.ARR:R.ARR), sGM=(req.GATE!=null?req.GATE:R.GM), sTot=(req.total||R.total||0);
      var acTag = f.AC ? ('<br><span class="muted" style="font-size:11px">✈ '+rbEsc_(slaAcModel_(f.AC))+(req.ac?'':' ·SLA ลำใหญ่')+'</span>') : '';
      var RDLB={CI:'เช็คอิน',GATE:'เกท',ARR:'ขาเข้า'};
      var st = f.noTime ? '<span class="badd">⚠️ ขาด STA/STD — เติมเวลาในชีต</span>'
             : (f.ok ? ('<span class="okk">✅ ครบ</span>'+(f.redist&&f.redist.length?' <span class="muted">· คนพอ จัด '+f.redist.map(function(p){return RDLB[p]||p;}).join('/')+' จากคนที่มี</span>':''))
                     : '<span class="badd">⚠️ '+rbEsc_(slaShortText_(f))+'</span>');
      if (f.hasTransfer) st += ' <span class="tag">🔄 มี T/S — อาจ +1/+2 agent</span>';
      return '<tr class="'+(f.ok&&!f.noTime?'':'rowbad')+'" data-team="'+rbEsc_(f.teamList)+'"><td class="b">'+rbEsc_(f.flight)+acTag+'</td><td>'+rbEsc_(f.airline)+'</td><td>'+rbEsc_(f.teamList)+
        '</td><td class="tnum">'+(f.STA||'')+'</td><td class="tnum">'+(f.STD||'')+'</td><td class="tnum"><b>'+(asg.total||0)+'</b>/'+sTot+'</td>'+
        rc(req.SUP||R.SUP)+rc(R.FC)+rc(sCI)+rc(sARR)+rc(sGM)+rc(R.GA)+rc(R.post)+'<td>'+st+'</td></tr>';
    } catch (eRow) { return '<tr class="rowbad"><td class="b">'+rbEsc_(f && f.flight)+'</td><td colspan="13" class="muted">แสดงไม่ได้: '+rbEsc_(eRow && eRow.message)+'</td></tr>'; }
  }).join('');
}

/** Flights & SLA — การ์ดต่อไฟลท์ (ดีไซน์ AOTGA Manpower): แถบสายการบิน + เฟส SUP/CI/ARR/GATE จัด/ต้องการ */
function rbFltCards_(res, ll) {
  var flts = slaCollectFlights_(res, ll).filter(function (f) { return !(f.noTime && f.fragment); });
  var _m = function(t){ var x=String(t||'').match(/(\d{1,2})[:.](\d{2})/); return x?(+x[1]*60+ +x[2]):99999; };
  flts.sort(function(a,b){ return _m(a.STD||a.STA)-_m(b.STD||b.STA); });
  var cards = flts.map(function (f) {
    try {
      var a = f.assigned || {}, req = f.req || {};
      var air = String(f.airline||'').toUpperCase();
      var short = f.short || {};
      function tile(lb, av, rv, ph){
        var bad = short[ph] > 0;
        var sub = (ph==='GATE' && (a.GD||a.GI)) ? '<div class="tnum" style="font-size:10px;color:#7c8ba1;margin-top:2px">DOM '+(a.GD||0)+' · INT '+(a.GI||0)+'</div>' : '';   // แยกเกทใน/นอก
        return '<div class="fc-tile'+(bad?' fc-tile--bad':'')+'"><div class="fc-tile__l">'+lb+'</div>' +
          '<div class="fc-tile__v tnum">'+(av||0)+'<span class="fc-tile__r">/'+(rv||0)+'</span></div>'+sub+'</div>';
      }
      var stat = f.noTime ? '<span class="fc-pill fc-pill--warn">ขาด STA/STD</span>'
               : (f.ok ? '<span class="fc-pill fc-pill--ok">✔ ครบ</span>'
                       : '<span class="fc-pill fc-pill--bad">'+rbEsc_(typeof slaShortText_==='function'?slaShortText_(f):'ขาดคน')+'</span>');
      var ac = f.AC ? '<span class="fc-ac">✈ '+rbEsc_(slaAcModel_(f.AC))+'</span>' : '';
      var ctr = (f.ctr!=null) ? '<span class="fc-ctr'+(f.ctrCap?' fc-ctr--cap':'')+'" title="เคาน์เตอร์ที่ท่าจัดให้'+(f.ctrCap?(' (SLA '+f.ctrCap+' · ท่าตัดเหลือ '+f.ctr+')'):'')+'">🎫 '+f.ctr+' ctr'+(f.ctrCap?' ⤵':'')+'</span>' : '';
      var cmode = /common/i.test(f.mode||'') ? '<span class="fc-common" title="Duty ระบุเปิดแบบ Common check-in">🔗 Common</span>' : '';
      var txt = (f.flight+' '+air+' '+(f.teamList||'')+' '+slaAirName_(air)).toLowerCase();
      return '<div class="fltcard'+(f.ok&&!f.noTime?'':' fltcard--bad')+'" data-team="'+rbEsc_(f.teamList||'')+'" data-txt="'+rbEsc_(txt)+'">' +
          '<div class="fltcard__air"><div class="fltcard__code">'+rbEsc_(air)+'</div><div class="fltcard__name">'+rbEsc_(slaAirName_(air))+'</div></div>' +
          '<div class="fltcard__body"><div class="fltcard__top"><div><div class="fltcard__flt">'+rbEsc_(f.flight)+'</div>' +
            '<div class="fltcard__time">STA '+rbEsc_(f.STA||'–')+' · STD '+rbEsc_(f.STD||'–')+' '+ac+' '+ctr+' '+cmode+'</div></div>'+stat+'</div>' +
            '<div class="fltcard__tiles">'+tile('SUP',a.SUP,req.SUP,'SUP')+tile('Check-in',a.CI,req.CI,'CI')+tile('Arrival',a.ARR,req.ARR,'ARR')+tile('Gate',a.GATE,req.GATE,'GATE')+'</div>' +
          '</div></div>';
    } catch (ec) { return '<div class="fltcard fltcard--bad"><div class="fltcard__body">'+rbEsc_(f&&f.flight)+' — แสดงไม่ได้</div></div>'; }
  }).join('');
  return '<div class="fltgrid">' + cards + '</div>';
}

function rbTblCard_(title, headHtml, bodyHtml, extraHd) {
  return '<div class="tablecard"><div class="tablecard__hd"><h3>'+title+'</h3>'+(extraHd||'')+'</div>' +
    '<div style="overflow-x:auto"><table class="tbl"><thead>'+headHtml+'</thead><tbody>'+bodyHtml+'</tbody></table></div></div>';
}

function rbBuildDashboardHtml_(res, ll, master, date, iso, base, tz, staticMode) {
  var logo = ''; try { logo = rbLogoDataUri_(); } catch (elg) {}
  var P = res.totals, L = ll && ll.totals.staff>0 ? ll.totals : null;
  function comb(k){ return P[k] + (L?L[k]:0); }
  var C = { staff:comb('staff'), working:comb('working')+comb('ot_off'), off:comb('off'), sick:comb('sick'),
            leave:comb('leave'), ot_off:comb('ot_off'), otOffHrs:Math.round(comb('otOffHrs')*10)/10,
            otPeople:comb('otPeople'), otHours:Math.round(comb('otHours')*10)/10,
            otPre:comb('otPre'), otPreHrs:Math.round(comb('otPreHrs')*10)/10,
            otPost:comb('otPost'), otPostHrs:Math.round(comb('otPostHrs')*10)/10 };
  var teamOrder = Object.keys(res.teams).sort(function(a,b){ return (res.teams[b].working+res.teams[b].ot_off)-(res.teams[a].working+res.teams[a].ot_off); });
  var shortCount = 0; try { shortCount = slaCollectFlights_(res, ll).filter(function(f){return !f.ok && !f.noTime;}).length; } catch (esc) {}
  var acCount = 0; try { acCount = acAnalyze_(res, ll).summary.bad; } catch (eac) {}
  // สรุปจำนวนไฟลท์วันนี้
  var fltTotal = 0;
  try { fltTotal = slaCollectFlights_(res, ll).filter(function(f){ return !(f.noTime && f.fragment); }).length; } catch (efs) {}
  // ไฟลท์ที่ขาดคน (top ตามเวลา) → แถบ "ต้องเสริมด่วน" ในหน้า Dashboard
  var urgent = [];
  try {
    var _m = function(t){ var x=String(t||'').match(/(\d{1,2})[:.](\d{2})/); return x?(+x[1]*60+ +x[2]):99999; };
    urgent = slaCollectFlights_(res, ll).filter(function(f){ return !f.ok && !f.noTime; })
      .sort(function(a,b){ return _m(a.STD||a.STA)-_m(b.STD||b.STA); })
      .map(function(f){ return { flt:f.flight, std:f.STD||f.STA||'', team:(f.teamList||'').replace(/,$/,''), txt:(typeof slaShortText_==='function'?slaShortText_(f):'ขาดคน') }; });
  } catch (eu) {}

  var cd = { tn:teamOrder, tw:teamOrder.map(function(t){return res.teams[t].working+res.teams[t].ot_off;}),
    tt:teamOrder.map(function(t){return res.teams[t].staff;}), work:C.working, off:C.off, sick:C.sick, leave:C.leave,
    otPreN:C.otPre, otPostN:C.otPost, otOffN:C.ot_off, otPreH:C.otPreHrs, otPostH:C.otPostHrs, otOffH:C.otOffHrs,
    otHolN:C.otHol, otHolH:C.otHolHrs, c:CI };

  var teamHead = '<tr><th>ทีม</th><th>Total</th><th>Working</th><th>เทรน</th><th>OFF</th><th>Sick</th><th>Vac</th><th>OT-Off</th><th>OT ก่อน</th><th>OT หลัง</th><th>%Working</th></tr>';
  var posHead = '<tr><th>ตำแหน่ง</th><th>Total</th><th>Work</th><th>OT-Off</th><th>Off</th><th>Sick</th><th>Leave</th><th>OT ก่อน</th><th>OT หลัง</th></tr>';
  var masterLine = master ? ('<div class="sectionlabel">👥 พนักงานทั้งหมด (Active): PSA <b>'+master.PSA.total+'</b> + LL <b>'+master.LL.total+'</b> = <b>'+(master.PSA.total+master.LL.total)+'</b> คน</div>') : '';
  var llCards = '';
  if (L) {
    var secRows = Object.keys(ll.sections).map(function(s){ return rbAggRowHtml_(s, ll.sections[s]); }).join('');
    llCards = rbTblCard_('🟡 LL by Section', '<tr><th>ส่วนงาน</th><th>Total</th><th>Working</th><th>เทรน</th><th>OFF</th><th>Sick</th><th>Vac</th><th>OT-Off</th><th>OT ก่อน</th><th>OT หลัง</th><th>%Working</th></tr>', secRows) +
      rbTblCard_('🟡 LL by Position', posHead, rbPosRows_(ll.positions, ['PSS','SNR','PSA','Porter','Admin','Trainee']));
  }

  var otbar = '<div class="otsplit"><div class="otrow"><span>⏱️ OT ก่อนกะ</span><b class="tnum">'+C.otPre+' คน · '+C.otPreHrs+'h</b></div>' +
    '<div class="otrow"><span>⏱️ OT หลังกะ</span><b class="tnum">'+C.otPost+' คน · '+C.otPostHrs+'h</b></div>' +
    '<div class="otrow"><span>⏱️ OT OFF</span><b class="tnum">'+C.ot_off+' คน · '+C.otOffHrs+'h</b></div>' +
    (C.otHolHrs > 0 ? '<div class="otrow"><span>🎉 OT นักขัต ×1</span><b class="tnum">'+C.otHol+' คน · '+C.otHolHrs+'h</b></div>' : '') +
    '<div class="otrow"><span>รวม OT</span><b class="tnum">'+C.otPeople+' คน · '+C.otHours+'h</b></div></div>';
  var holBanner = res.holiday ? '<div class="sectionlabel" style="background:#fff4e6;border-left:4px solid #f97316;padding:9px 12px;border-radius:8px;margin-bottom:4px">🎉 วันนี้เป็น<b>วันหยุดประเพณี</b>: '+rbEsc_(res.holiday)+' — ผู้ที่มาทำงานได้ <b>OT นักขัต ×1</b> เท่าชั่วโมงกะ ('+C.otHol+' คน · '+C.otHolHrs+'h)</div>' : '';

  // tab contents: inline (offline file) or lazy placeholders (web app)
  var ttInner = staticMode
    ? rbTblCard_('🕓 Timetable · ตารางงานรายคน (เวลาเข้า-ออกกะ · OT · STA/STD)',
        '<tr><th>ทีม</th><th>รหัส</th><th>ชื่อ</th><th>ตำแหน่ง</th><th>กะ (เข้า-ออก)</th><th>OT</th><th>#</th><th>เที่ยวบิน</th></tr>',
        rbTtRows_(res, ll), rbCtrls_('view-tt', true))
    : '<div id="ttbox"><div class="panel muted" style="text-align:center;padding:34px">⏳ กำลังโหลด Timetable…</div></div>';
  var fltInner = staticMode
    ? rbTblCard_('✈️ ไฟลท์บินประจำวัน + เช็ค SLA สายการบิน',
        '<tr><th>Flight</th><th>สายการบิน</th><th>ทีม</th><th>STA</th><th>STD</th><th>จัด/รวม</th><th>SUP</th><th>FC</th><th>Check-in</th><th>Arrival</th><th>Gate<br>Controller</th><th>Gate<br>Agent</th><th>Post<br>Dep.</th><th>สถานะ</th></tr>',
        rbFltRows_(res, ll), rbCtrls_('view-flt', true))
    : '<div id="fltbox"><div class="panel muted" style="text-align:center;padding:34px">⏳ กำลังโหลด Flights &amp; SLA…</div></div>';
  var otInner = otDashHtml_();                                         // แท็บ OT: ตารางเดิม (รายเดือน/สัปดาห์) + sub-tab กราฟสรุปเต็ม (embed)
  var acInner = staticMode ? rbAssignHtml(iso)
    : '<div id="acbox"><div class="panel muted" style="text-align:center;padding:34px">⏳ กำลังตรวจการ Assign…</div></div>';
  var supInner = staticMode ? rbSupportHtml(iso)
    : '<div id="supbox"><div class="panel muted" style="text-align:center;padding:34px">⏳ กำลังหาคนซัพพอร์ต…</div></div>';
  var autoInner = staticMode ? rbAutoAssignHtml(iso)
    : '<div id="autobox"><div class="panel muted" style="text-align:center;padding:34px">⏳ กำลังจัดเวรใหม่ทั้งหมดตาม SLA…</div></div>';
  var advInner = '<div id="advbox"><div class="panel muted" style="text-align:center;padding:34px">⏳ กดแท็บเพื่อจัดเวรล่วงหน้า (อ่านลิงก์ ROSTER/FLIGHT/รายชื่อจริง)…</div></div>';

  return '<!doctype html><html lang="th" data-theme="corporate"><head><meta charset="utf-8">' +
    '<link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">' +
    '<style>' + rbDesignCss_() + otDashCss_() + '</style></head><body><div class="app-shell" id="appShell">' +
    rbRail_(shortCount, acCount) +
    '<main class="app-main"><div class="app-pad">' +
    rbTopbar_(date) + rbWeekNav_(date, iso, base, tz) +
    '<div id="view-dash">' +
    holBanner + rbKpiHero_(C, master, shortCount, fltTotal, urgent) + masterLine +
    '<div class="grid grid--charts" style="margin-top:16px">' +
      '<div class="panel"><div class="panel__hd"><h3>📊 Working / Total ต่อทีม</h3></div><canvas id="c1" height="150"></canvas></div>' +
      '<div class="panel"><div class="panel__hd"><h3>🧭 ภาพรวมสถานะ</h3></div><canvas id="c2" height="150"></canvas></div></div>' +
    '<div class="grid grid--charts" style="margin-top:16px">' +
      '<div class="panel"><div class="panel__hd"><h3>⏱️ OT แยกประเภท (คน)</h3></div><canvas id="c3" height="140"></canvas></div>' +
      '<div class="panel"><div class="panel__hd"><h3>⏱️ OT แยกประเภท (ชม.)</h3></div><canvas id="c4" height="140"></canvas></div>' +
      '<div class="panel">' + otbar + '</div></div>' +
    '<div style="margin-top:16px">' + rbTblCard_('📌 Manpower by Team (PSA)', teamHead, rbTeamRows_(res.teams, teamOrder)) + '</div>' +
    rbMasterMissingCard_(res, ll, master) +
    '<div style="margin-top:16px">' + rbTblCard_('👥 PSA by Position', posHead, rbPosRows_(res.positions, ['PSS','SNR','PSA','Globlex','AdminD','Porter','Crewsign'])) + '</div>' +
    (L ? '<div style="margin-top:16px">'+llCards+'</div>' : '') +
    '</div>' +
    '<div id="view-tt" style="display:none">' + ttInner + '</div>' +
    '<div id="view-flt" style="display:none">' + fltInner + '</div>' +
    '<div id="view-sup" style="display:none">' + supInner + '</div>' +
    '<div id="view-ac" style="display:none">' + acInner + '</div>' +
    '<div id="view-auto" style="display:none">' + autoInner + '</div>' +
    '<div id="view-adv" style="display:none">' + advInner + '</div>' +
    '<div id="view-advw" style="display:none"><div id="advwbox"><div class="panel muted" style="text-align:center;padding:34px">⏳ กำลังวางแผนหลายวัน…</div></div></div>' +
    '<div id="view-ot" style="display:none">' + otInner + '</div>' +
    '<div id="view-week" style="display:none"><div id="weekbox"><div class="panel muted" style="text-align:center;padding:34px">⏳ กำลังโหลดตารางบินสัปดาห์…</div></div></div>' +
    '<div id="view-rq" style="display:none"><div id="rqbox"><div class="panel muted" style="text-align:center;padding:34px">⏳ กำลังอ่านคำร้อง RQ…</div></div></div>' +
    '<div id="view-wh" style="display:none"><div id="whbox"><div class="panel muted" style="text-align:center;padding:34px">⏳ กำลังโหลด…</div></div></div>' +
    '<div id="view-wsum" style="display:none"><div id="wsumbox"><div class="panel muted" style="text-align:center;padding:34px">⏳ กำลังสรุปสัปดาห์…</div></div></div>' +
    '<div id="view-dc" style="display:none"><div id="dcbox"><div class="panel muted" style="text-align:center;padding:34px">⏳ กำลังตรวจข้อมูล…</div></div></div>' +
    '<div class="foot">' + (logo ? '<img class="foot__logo" src="' + logo + '" alt="AOTGA">' : '') + '<span>แผนกการโดยสาร ท่าอากาศยานภูเก็ต · บริษัท บริการภาคพื้น ท่าอากาศยานไทย จำกัด (AOTGA)</span></div>' +
    '</div></main></div>' +
    '<div id="psnpop" class="psnpop" style="display:none" onclick="event.stopPropagation()"></div>' +
    rbHelpModal_() +
    '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>' +
    '<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0/dist/chartjs-plugin-datalabels.min.js"></script>' +
    '<script>var CD=' + JSON.stringify(cd) + ';var ISO=' + JSON.stringify(iso) + ';var STATIC=' + (staticMode ? 'true' : 'false') + ';' +
    'function showView(v){["dash","tt","flt","sup","ac","auto","adv","advw","week","rq","ot","wh","wsum","dc"].forEach(function(x){var vv=document.getElementById("view-"+x),tb=document.getElementById("tab-"+x);if(vv)vv.style.display=v===x?"":"none";if(tb){tb.classList.toggle("active",v===x);if(v===x){var pt=document.getElementById("pageTitle");if(pt)pt.textContent=tb.getAttribute("data-title")||pt.textContent;}}});var m=document.getElementById("app-main-scroll")||document.querySelector(".app-main");if(m)m.scrollTop=0;}' +
    'function exportPdf(){var pt=document.getElementById("pageTitle");var nm=(pt&&pt.textContent.trim())||"PAS";var old=document.title;document.title=nm+" "+ISO;window.print();setTimeout(function(){document.title=old;},600);}' +
    'function exportServerPdf(b){if(!(window.google&&google.script&&google.script.run)){alert("เปิดผ่าน Web App URL (/exec) เพื่อสร้างไฟล์");return;}var old=b?b.textContent:"";if(b){b.textContent="⏳ กำลังสร้างไฟล์ PDF…";b.disabled=true;}google.script.run.withSuccessHandler(function(url){if(b){b.textContent=old;b.disabled=false;}window.open(url,"_blank");}).withFailureHandler(function(e){if(b){b.textContent=old;b.disabled=false;}alert("สร้าง PDF ไม่ได้: "+e.message);}).rbExportDayPdf(ISO);}' +
    'function loadWh(){lazy("whbox","rbWeekHoursHtml","wh");}' +
    'function loadWsum(){lazy("wsumbox","rbWeekSummaryHtml","wsum");}' +
    'function loadWeek(){lazy("weekbox","rbWeekFlightsHtml","week");}' +
    'function loadRq(){lazy("rqbox","rqFindSupport","rq");}' +
    'function rqReload(alt){var b=document.getElementById("rqbox");if(!b||!(window.google&&google.script&&google.script.run)){alert("เปิดผ่าน /exec");return;}b.innerHTML="<div class=\\"panel muted\\" style=\\"padding:24px;text-align:center\\">⏳ กำลังคิดทางเลือก…</div>";google.script.run.withSuccessHandler(function(h){b.innerHTML=h;makeSortable();}).withFailureHandler(function(e){b.innerHTML="<div class=\\"panel\\">โหลดไม่ได้: "+e.message+"</div>";}).rqFindSupport(ISO,alt);}' +
    'function loadDc(){lazy("dcbox","rbDataCheckHtml","dc");}' +
    'function pwmsHelp(s){var o=document.getElementById("helpov");if(o){o.style.display=s?"flex":"none";document.body.style.overflow=s?"hidden":"";}}' +
    'document.addEventListener("keydown",function(e){if(e.key==="Escape")pwmsHelp(0);});' +
    'var LD={};function lazy(box,fn,id){if(STATIC||LD[id])return;LD[id]=1;if(!(window.google&&google.script&&google.script.run)){document.getElementById(box).innerHTML="<div class=\\"panel muted\\" style=\\"padding:24px;text-align:center\\">เปิดผ่าน Web App URL (/exec) เพื่อดูส่วนนี้</div>";return;}' +
    'google.script.run.withSuccessHandler(function(h){document.getElementById(box).innerHTML=h;makeSortable();buildTeamSels();buildExpTeams();}).withFailureHandler(function(e){LD[id]=0;document.getElementById(box).innerHTML="<div class=\\"panel\\">โหลดไม่ได้: "+e.message+"</div>";})[fn](ISO);}' +
    'function loadTT(){lazy("ttbox","rbTimetableHtml","tt");}function loadFlt(){lazy("fltbox","rbFlightsHtml","flt");}function loadOT(){}function loadAC(){lazy("acbox","rbAssignHtml","ac");}function loadSup(){lazy("supbox","rbSupportHtml","sup");}' +
    'function gtView(){var w=document.getElementById("gtWrap"),t=document.getElementById("gtTable"),b=document.getElementById("gtToggle");if(!w||!t)return;var g=w.style.display!=="none";w.style.display=g?"none":"";t.style.display=g?"":"none";if(b)b.textContent=g?"📊 มุมมอง Gantt":"📋 มุมมองตาราง";}' +
    'function gtSync(){var v=document.getElementById("view-tt");if(!v)return;var ts=v.querySelector(".teamsel"),team=ts?ts.value:"";var sb=document.getElementById("gtSearch"),q=sb?sb.value.toLowerCase().trim():"";[].forEach.call(document.querySelectorAll("#gtWrap .gt-row"),function(r){if(r.classList.contains("gt-ruler"))return;var dt=r.getAttribute("data-team")||"";var okT=!team||dt===team||dt.split(",").indexOf(team)>=0;var okQ=!q||(r.getAttribute("data-name")||"").indexOf(q)>=0;r.style.display=(okT&&okQ)?"":"none";});}function gtFilter(){gtSync();}' +
    'function advPropose(){var sel=document.getElementById("advPropTeam");var team=sel?sel.value:"";if(!team){alert("เลือกทีมก่อน");return;}if(!(window.google&&google.script&&google.script.run)){alert("เปิดผ่าน /exec เพื่อใช้เสนอจัดเวร");return;}var box=document.getElementById("advPropBox");if(!box)return;var date=(typeof advCurDate==="function")?advCurDate():ISO;box.innerHTML="<div class=\\"panel muted\\" style=\\"padding:24px;text-align:center\\">🤖 กำลังเสนอการจัดเวรทีม "+team+"…</div>";google.script.run.withSuccessHandler(function(h){box.innerHTML=h;}).withFailureHandler(function(e){box.innerHTML="<div class=\\"panel\\">เสนอไม่ได้: "+e.message+"</div>";}).rbProposeGanttHtml(date,team);}' +
    'function gtManning(){if(!(window.google&&google.script&&google.script.run)){alert("เปิดผ่าน /exec เพื่อใช้เมนูนี้");return;}var b=document.getElementById("gtManBtn");if(b){b.disabled=true;b.textContent="⏳ กำลังเตรียมชีต…";}google.script.run.withSuccessHandler(function(url){if(b){b.disabled=false;b.textContent="⚙️ กฎกำลังพล (แก้ในชีต)";}if(url){window.open(url,"_blank");if(confirm("เปิดชีตกฎกำลังพลแล้ว — แก้ตัวเลขเสร็จ กด OK เพื่อล้าง cache ให้ระบบอ่านค่าใหม่"))google.script.run.withSuccessHandler(function(m){alert(m);}).manClearCache();}}).withFailureHandler(function(e){if(b){b.disabled=false;b.textContent="⚙️ กฎกำลังพล (แก้ในชีต)";}alert("เปิดชีตไม่ได้: "+e.message);}).apSetupManning();}' +
    'function gtOff(){var w=document.getElementById("gtWrap"),b=document.getElementById("gtOffBtn");if(!w)return;var h=w.classList.toggle("gt-hideoff");if(b)b.textContent=h?"👁️ แสดงคนหยุด":"🙈 ซ่อนคนหยุด";}' +
    '(function(){var tp;function hide(){if(tp)tp.style.display="none";}document.addEventListener("mouseover",function(e){var el=e.target.closest&&e.target.closest("[data-tip]");if(!el)return;if(!tp){tp=document.createElement("div");tp.className="gt-tip";document.body.appendChild(tp);}var ps=(el.getAttribute("data-tip")||"").split("¦");tp.innerHTML="<div class=\\"gt-tip-h\\">"+ps[0]+"</div>"+ps.slice(1).map(function(p){return "<div>"+p+"</div>";}).join("");tp.style.display="block";});document.addEventListener("mousemove",function(e){if(!tp||tp.style.display!=="block")return;var x=e.clientX+14,y=e.clientY+18,w=tp.offsetWidth,h=tp.offsetHeight;if(x+w>window.innerWidth-8)x=e.clientX-w-14;if(y+h>window.innerHeight-8)y=e.clientY-h-18;tp.style.left=x+"px";tp.style.top=y+"px";});document.addEventListener("mouseout",function(e){if(e.target.closest&&e.target.closest("[data-tip]"))hide();});})();' +
    'window.__supAdd=window.__supAdd||[];' +
    'function supAddReq(){var fe=document.getElementById("supAddFlt");var f=(fe?fe.value:"").trim().toUpperCase();var ph=document.getElementById("supAddPh").value;var n=Math.max(1,parseInt(document.getElementById("supAddN").value||"1",10)||1);var we=document.getElementById("supAddWin");var win=(we?we.value:"").trim();if(!f){alert("ใส่เลขไฟลท์ก่อน เช่น PG270");return;}window.__supAdd.push({flight:f,phase:ph,n:n,win:win});supReload();}' +
    'function supClearReq(){window.__supAdd=[];supReload();}' +
    'function supDutyPlan(){var el=document.getElementById("supimpin");var t=el?el.value:"";if(!t.trim()){alert("วางข้อความขอซัพก่อน");return;}if(!(window.google&&google.script&&google.script.run)){alert("เปิดผ่าน /exec");return;}var m=document.getElementById("supimpmsg");if(m)m.textContent="⏳ กำลังคิดแผนซัพ…";google.script.run.withSuccessHandler(function(h){if(m)m.textContent="";document.getElementById("supplanout").innerHTML=h;makeSortable();buildTeamSels();}).withFailureHandler(function(e){if(m)m.textContent="";document.getElementById("supplanout").innerHTML="<div class=\\"panel\\">คิดไม่ได้: "+e.message+"</div>";}).rbSupDutyPlanHtml(ISO,t);}' +
    'function supDutyToRows(){var el=document.getElementById("supimpin");var t=el?el.value:"";if(!t.trim()){alert("วางข้อความขอซัพก่อน");return;}if(!(window.google&&google.script&&google.script.run)){alert("เปิดผ่าน /exec");return;}var m=document.getElementById("supimpmsg");if(m)m.textContent="⏳ กำลังแตกคำขอ + คิดคน…";google.script.run.withSuccessHandler(function(json){var reqs=[];try{reqs=JSON.parse(json);}catch(e){}if(!reqs.length){if(m)m.textContent="";alert("แตกคำขอไม่ได้ — ตรวจรูปแบบ (ต้องมีเลขไฟลท์ + ตำแหน่ง เช่น ARR/GATE + จำนวน)");return;}window.__supAdd=(window.__supAdd||[]).concat(reqs);if(m)m.textContent="แตกได้ "+reqs.length+" คำขอ ↓";supReload();}).withFailureHandler(function(e){if(m)m.textContent="";alert("แตกไม่ได้: "+e.message);}).dutyRequestsJson(t);}' +
    'function supReload(){if(STATIC){alert("เปิดผ่าน /exec เพื่อคิดคนตามคำขอ");return;}if(!(window.google&&google.script&&google.script.run)){alert("เปิดผ่าน /exec");return;}var b=document.getElementById("supbox");if(b)b.innerHTML="<div class=\\"panel muted\\" style=\\"padding:20px;text-align:center\\">⏳ กำลังคิดคนตามคำขอ Duty…</div>";google.script.run.withSuccessHandler(function(h){b.innerHTML=h;makeSortable();buildTeamSels();buildExpTeams();}).withFailureHandler(function(e){b.innerHTML="<div class=\\"panel\\">คิดคนไม่ได้: "+e.message+"</div>";}).rbSupportHtml(ISO,JSON.stringify(window.__supAdd));}' +
    'function supExport(){var v=document.getElementById("view-sup");if(!v)return;var picks=[];[].forEach.call(v.querySelectorAll("tbody tr[data-flight]"),function(tr){if(tr.style.display==="none")return;var names=[];[].forEach.call(tr.querySelectorAll(".namepick"),function(s){if(s.value.trim())names.push(s.value.trim());});if(!names.length)return;picks.push({flight:tr.getAttribute("data-flight"),airline:tr.getAttribute("data-air"),std:tr.getAttribute("data-std"),phase:tr.getAttribute("data-phase"),names:names});});if(!picks.length){alert("ยังไม่ได้เลือกคนในเมนู");return;}if(!(window.google&&google.script&&google.script.run)){alert("เปิดผ่าน /exec เพื่อสร้างไฟล์");return;}var m=v.querySelector(".supexpmsg");if(m)m.innerHTML="⏳ กำลังสร้างไฟล์ชีต…";google.script.run.withSuccessHandler(function(url){if(m)m.innerHTML="📤 <a href=\\""+url+"\\" target=\\"_blank\\">เปิดไฟล์แจ้ง Assignment (Support)</a>";}).withFailureHandler(function(e){if(m)m.innerHTML="";alert("สร้างไฟล์ไม่ได้: "+e.message);}).supExportSheet(ISO,JSON.stringify(picks));}' +
    'function supCheck(){var el=document.getElementById("supchkin");var t=el?el.value:"";if(!t.trim()){alert("วางรายชื่อก่อน");return;}if(!(window.google&&google.script&&google.script.run)){alert("เปิดผ่าน /exec เพื่อใช้ปุ่มตรวจ");return;}var m=document.getElementById("supchkmsg");if(m)m.textContent="⏳ กำลังตรวจ…";google.script.run.withSuccessHandler(function(h){if(m)m.textContent="";document.getElementById("supchkout").innerHTML=h;makeSortable();}).withFailureHandler(function(e){if(m)m.textContent="";document.getElementById("supchkout").innerHTML="<div class=\\"panel\\">ตรวจไม่ได้: "+e.message+"</div>";}).rbCheckDeployHtml(ISO,t);}' +
    'function supImport(){var el=document.getElementById("supimpin");var t=el?el.value:"";if(!t.trim()){alert("วางข้อความ Duty ก่อน");return;}if(!(window.google&&google.script&&google.script.run)){alert("เปิดผ่าน /exec");return;}var m=document.getElementById("supimpmsg");if(m)m.textContent="⏳ กำลังแปลง…";google.script.run.withSuccessHandler(function(h){if(m)m.textContent="";document.getElementById("supimpout").innerHTML=h;makeSortable();}).withFailureHandler(function(e){if(m)m.textContent="";document.getElementById("supimpout").innerHTML="<div class=\\"panel\\">แปลงไม่ได้: "+e.message+"</div>";}).rbDutyImportHtml(ISO,t);}' +
    'function supImportSheet(){var el=document.getElementById("supimpin");var t=el?el.value:"";if(!t.trim()){alert("วางข้อความ Duty ก่อน");return;}if(!(window.google&&google.script&&google.script.run)){alert("เปิดผ่าน /exec เพื่อสร้างชีต");return;}var m=document.getElementById("supimpmsg");if(m)m.innerHTML="⏳ กำลังสร้างชีต…";google.script.run.withSuccessHandler(function(url){if(m)m.innerHTML="📤 <a href=\\""+url+"\\" target=\\"_blank\\">เปิดชีต Support Duty</a>";}).withFailureHandler(function(e){if(m)m.innerHTML="";alert("สร้างชีตไม่ได้: "+e.message);}).dutyExportSheet(ISO,t);}function loadFill(){lazy("fillbox","rbFillPlanHtml","fill");}function loadAuto(){lazy("autobox","rbAutoAssignHtml","auto");}' +
    'function rbRefresh(b){if(b){b.textContent="⏳ กำลังรีเฟรช…";}if(window.google&&google.script&&google.script.run){google.script.run.withSuccessHandler(function(){location.reload();}).withFailureHandler(function(){location.reload();}).rbClearCache(ISO);}else{location.reload();}}' +
    'function loadAdv(){lazy("advbox","rbAdvanceHtml","adv");}function advGo(v,cci){var b=document.getElementById("advbox");if(!b||!(window.google&&google.script))return;b.innerHTML="<div class=\\"panel muted\\" style=\\"padding:24px;text-align:center\\">⏳ กำลังจัดเวร "+v+"…</div>";google.script.run.withSuccessHandler(function(h){b.innerHTML=h;makeSortable();}).withFailureHandler(function(e){b.innerHTML="<div class=\\"panel\\">"+e.message+"</div>";}).rbAdvanceHtml(v,cci||"");}' +
    'function advCurDate(){var di=document.querySelector("#view-adv input[type=date]");return di?di.value:ISO;}' +
    'function advCommonGo(){var code=(document.getElementById("cciCode").value||"").trim().toUpperCase();var n=+(document.getElementById("cciN").value||0);var flts=(document.getElementById("cciFlts").value||"").split(",").map(function(s){return s.trim();}).filter(Boolean);if(!code||!n){alert("กรอก สาย/ทีม + จำนวนเคาน์เตอร์");return;}advGo(advCurDate(),JSON.stringify([{code:code,team:code,nCounter:n,flights:flts,gate:false,full:false}]));}' +
    'function advCommonClear(){advGo(advCurDate(),"[]");}' +
    'function advSave(){var v=document.getElementById("view-adv");if(!v)return;var tb=v.querySelector("table.tbl");var di=v.querySelector("input[type=date]");var date=di?di.value:ISO;if(!tb){alert("เลือกวันที่ที่มีไฟลท์ก่อน");return;}var rows=[];[].forEach.call(tb.tBodies[0].rows,function(tr){if(tr.cells.length<13)return;var c=[];for(var i=0;i<7;i++){var ns=[];[].forEach.call(tr.cells[6+i].querySelectorAll(".namepick"),function(x){if(x.value.trim())ns.push(x.value.trim());});c.push(ns.join(", "));}function f(n){return tr.cells[n].innerText.trim().split("\\n")[0];}rows.push([f(0),f(1),f(3),f(4),f(5),c[0],c[1],c[2],c[3],c[4],c[5],c[6]]);});if(!rows.length){alert("ไม่มีไฟลท์ให้บันทึก");return;}if(!(window.google&&google.script)){alert("เปิดผ่าน /exec เพื่อบันทึก");return;}var m=document.getElementById("advsavemsg");if(m)m.innerHTML="⏳ กำลังบันทึก…";google.script.run.withSuccessHandler(function(url){if(m)m.innerHTML="✅ บันทึกแล้ว: <a href=\\""+url+"\\" target=\\"_blank\\">เปิดชีต</a>";}).withFailureHandler(function(e){if(m)m.innerHTML="";alert("บันทึกไม่ได้: "+e.message);}).advSaveProposal(date,JSON.stringify(rows));}' +
    'function advExport(){var di=document.querySelector("#view-adv input[type=date]");var date=di?di.value:ISO;if(!(window.google&&google.script)){alert("เปิดผ่าน /exec เพื่อสร้างไฟล์");return;}var m=document.getElementById("advexportmsg");if(m)m.innerHTML="⏳ กำลังสร้างไฟล์แจ้งทีม…";google.script.run.withSuccessHandler(function(url){if(m)m.innerHTML="📤 <a href=\\""+url+"\\" target=\\"_blank\\">เปิดไฟล์แจ้ง Assignment</a>";}).withFailureHandler(function(e){if(m)m.innerHTML="";alert("สร้างไฟล์ไม่ได้: "+e.message);}).advExportAssignment(date);}' +
    'function loadAdvW(){lazy("advwbox","rbAdvanceWeekHtml","advw");}' +
    'function advwStart(){var di=document.querySelector("#view-advw input[type=date]");return di?di.value:ISO;}' +
    'function advwDays(){var s=document.querySelector("#view-advw select");return s?+s.value:7;}' +
    'function advwGo(v,n){var b=document.getElementById("advwbox");if(!b||!(window.google&&google.script))return;b.innerHTML="<div class=\\"panel muted\\" style=\\"padding:24px;text-align:center\\">⏳ กำลังวางแผน…</div>";google.script.run.withSuccessHandler(function(h){b.innerHTML=h;makeSortable();}).withFailureHandler(function(e){b.innerHTML="<div class=\\"panel\\">"+e.message+"</div>";}).rbAdvanceWeekHtml(v,n||7);}' +
    'function advwDay(iso){location.href="?date="+encodeURIComponent(iso);}' +
    'function advwExport(){var s=advwStart(),n=advwDays();if(!(window.google&&google.script)){alert("เปิดผ่าน /exec เพื่อสร้างไฟล์");return;}var m=document.getElementById("advwexpmsg");if(m)m.innerHTML="⏳ กำลังสร้างรายงาน…";google.script.run.withSuccessHandler(function(url){if(m)m.innerHTML="📤 <a href=\\""+url+"\\" target=\\"_blank\\">เปิดรายงานครบ/ขาด</a>";}).withFailureHandler(function(e){if(m)m.innerHTML="";alert("สร้างรายงานไม่ได้: "+e.message);}).advExportWeek(s,n);}' +
    'function hm2m(s){var m=String(s).match(/(\\d{1,2}):(\\d{2})/);return m?(+m[1]*60+ +m[2]):null;}' +
    'function gapOverlap(raw,f,t){if(!raw)return false;return raw.split(",").some(function(seg){var p=seg.split("~");if(p.length<2)return false;var a=+p[0],b=+p[1];if(isNaN(a)||isNaN(b))return false;function ov(x,y){return x<t&&y>f;}a=((a%1440)+1440)%1440;b=((b%1440)+1440)%1440;if(b===0)b=1440;return a<=b?ov(a,b):(ov(a,1440)||ov(0,b));});}' +
    'function applyFilter(viewId){var v=document.getElementById(viewId);if(!v)return;var sb=v.querySelector(".search"),q=sb?sb.value.toLowerCase():"";var ts=v.querySelector(".teamsel"),team=ts?ts.value:"";var gf=v.querySelector(".gapfrom"),gt=v.querySelector(".gapto");var gfrom=gf&&gf.value?hm2m(gf.value):null,gto=gt&&gt.value?hm2m(gt.value):null;var gOn=(gfrom!=null||gto!=null),gLo=gfrom!=null?gfrom:0,gHi=gto!=null?gto:1440,visN=0;var okEl=v.querySelector(".acshowok"),showOk=okEl&&okEl.checked;[].forEach.call(v.querySelectorAll("tbody tr, .fltcard"),function(r){var dt=r.getAttribute("data-team")||"";var okT=!team||dt===team||dt.split(",").indexOf(team)>=0;var okQ=!q||r.textContent.toLowerCase().indexOf(q)>=0;var okG=!gOn||gapOverlap(r.getAttribute("data-gaps")||"",gLo,gHi);var st=r.getAttribute("data-status"),isOk=(st==="ok"||st==="nowin");var okS=!isOk||showOk||!!team;var show=okT&&okQ&&okG&&okS;if(show&&r.getAttribute("data-gaps")!=null&&r.cells.length>1)visN++;r.style.display=!show?"none":(isOk?"table-row":"");});var gc=v.querySelector(".gapcount");if(gc)gc.textContent=gOn?("· พบ "+visN+" คนว่างช่วงนี้"):"";if(document.getElementById("gtWrap"))gtSync();}' +
    'function clearGap(viewId){var v=document.getElementById(viewId);if(!v)return;var gf=v.querySelector(".gapfrom"),gt=v.querySelector(".gapto");if(gf)gf.value="";if(gt)gt.value="";applyFilter(viewId);}' +
    'function buildExpTeams(){[].forEach.call(document.querySelectorAll("select.expteam"),function(sel){if(sel.options.length>1)return;var v=sel.closest("div[id^=view-]");if(!v)return;var set={};[].forEach.call(v.querySelectorAll(".supchip[data-pteam]"),function(c){var t=c.getAttribute("data-pteam");if(t)set[t]=1;});Object.keys(set).sort().forEach(function(t){var o=document.createElement("option");o.text=t;o.value=t;sel.add(o);});});}' +
    'function fillExport(){expRun("fill","apExportFill");}function autoExport(){expRun("auto","apExportAuto");}' +
    'function expRun(view,fn){var v=document.getElementById("view-"+view);if(!v)return;var sel=v.querySelector(".expteam"),team=sel?sel.value:"";var m=v.querySelector(".expmsg");if(!(window.google&&google.script&&google.script.run)){alert("เปิดผ่าน /exec เพื่อสร้างไฟล์");return;}if(m)m.innerHTML="⏳ กำลังสร้างไฟล์ชีต…";var ex=view==="fill"?JSON.stringify(window.__fillEx||{}):"";google.script.run.withSuccessHandler(function(url){if(m)m.innerHTML="📤 <a href=\\""+url+"\\" target=\\"_blank\\">เปิดไฟล์แจ้ง Assignment"+(team?" ("+team+")":"")+"</a>";}).withFailureHandler(function(e){if(m)m.innerHTML="";alert("สร้างไฟล์ไม่ได้: "+e.message);})[fn](ISO,team,ex);}' +
    'function fillAddExtra(){var f=document.getElementById("exflt"),p=document.getElementById("exph"),n=document.getElementById("exn");if(!f||!f.value){alert("เลือกไฟลท์ก่อน");return;}var num=Math.max(1,parseInt(n&&n.value||"1",10)||1);window.__fillEx=window.__fillEx||{};var e=window.__fillEx[f.value]=window.__fillEx[f.value]||{};e[p.value]=(parseInt(e[p.value]||0,10)||0)+num;fillRerun();}' +
    'function fillDropExtra(fl,ph){if(!window.__fillEx||!window.__fillEx[fl])return;delete window.__fillEx[fl][ph];var any=false;for(var k in window.__fillEx[fl])if(window.__fillEx[fl][k])any=true;if(!any)delete window.__fillEx[fl];fillRerun();}' +
    'function fillClearExtra(){window.__fillEx={};fillRerun();}' +
    'function fillRerun(){if(!(window.google&&google.script&&google.script.run)){alert("เปิดผ่าน /exec");return;}var v=document.getElementById("view-fill"),fcBy={};if(v)[].forEach.call(v.querySelectorAll(".fcpick"),function(s){fcBy[s.getAttribute("data-code")]=s.value;});document.getElementById("fillbox").innerHTML="<div class=\\"panel muted\\" style=\\"padding:20px;text-align:center\\">⏳ กำลังจัดคนเพิ่ม…</div>";google.script.run.withSuccessHandler(function(h){document.getElementById("fillbox").innerHTML=h;makeSortable();buildTeamSels();buildExpTeams();}).withFailureHandler(function(e){document.getElementById("fillbox").innerHTML="<div class=\\"panel\\">"+e.message+"</div>";}).rbFillPlanHtml(ISO,JSON.stringify(fcBy),JSON.stringify(window.__fillEx||{}));}' +
    'function fcPick(view){var v=document.getElementById("view-"+view);if(!v||!(window.google&&google.script&&google.script.run))return;var fcBy={};[].forEach.call(v.querySelectorAll(".fcpick"),function(s){fcBy[s.getAttribute("data-code")]=s.value;});var box=view+"box",fn=view==="auto"?"rbAutoAssignHtml":"rbFillPlanHtml";var ex=view==="fill"?JSON.stringify(window.__fillEx||{}):"";document.getElementById(box).innerHTML="<div class=\\"panel muted\\" style=\\"padding:20px;text-align:center\\">⏳ จัดใหม่ตาม Flight Controller…</div>";google.script.run.withSuccessHandler(function(h){document.getElementById(box).innerHTML=h;makeSortable();buildTeamSels();buildExpTeams();}).withFailureHandler(function(e){document.getElementById(box).innerHTML="<div class=\\"panel\\">"+e.message+"</div>";})[fn](ISO,JSON.stringify(fcBy),ex);}' +
    'function buildTeamSels(){[].forEach.call(document.querySelectorAll("select.teamsel"),function(sel){if(sel.options.length>1)return;var v=sel.closest("div[id^=view-]");if(!v)return;var set={};[].forEach.call(v.querySelectorAll("tbody tr[data-team], .fltcard[data-team]"),function(r){(r.getAttribute("data-team")||"").split(",").forEach(function(t){t=t.trim();if(t)set[t]=1;});});Object.keys(set).sort().forEach(function(t){var o=document.createElement("option");o.text=t;o.value=t;sel.add(o);});});}' +
    'function supGrpVis(w){[].forEach.call(w.querySelectorAll(".supgrp"),function(g){var any=[].some.call(g.querySelectorAll(".supchip"),function(c){return c.style.display!=="none";});g.style.display=any?"":"none";});}' +
    'function applySupFilter(){var on={},anyOff=false;[].forEach.call(document.querySelectorAll("#view-sup .supteam:not(.supall)"),function(b){if(b.classList.contains("on"))on[b.getAttribute("data-t")]=1;else anyOff=true;});' +
    '[].forEach.call(document.querySelectorAll("#view-sup .supwrap"),function(w){var chips=[].slice.call(w.querySelectorAll(".supchip"));' +
    'if(!anyOff){chips.forEach(function(c){c.style.display="";c.classList.remove("sup--sub");});supGrpVis(w);return;}' +
    'var need=+(w.getAttribute("data-need")||1);var sel=[],uns=[];chips.forEach(function(c){(on[c.getAttribute("data-cteam")]?sel:uns).push(c);});' +
    'sel.forEach(function(c){c.style.display="";c.classList.remove("sup--sub");});var fill=Math.max(0,need-sel.length);' +
    'uns.forEach(function(c,i){if(i<fill){c.style.display="";c.classList.add("sup--sub");c.title="ทดแทน (ทีมไม่ได้เลือก)";}else{c.style.display="none";c.classList.remove("sup--sub");}});supGrpVis(w);});}' +
    'function toggleSupTeam(b){b.classList.toggle("on");applySupFilter();}' +
    'function allSupTeams(b){var on=[].some.call(document.querySelectorAll("#view-sup .supteam:not(.supall)"),function(x){return !x.classList.contains("on");});[].forEach.call(document.querySelectorAll("#view-sup .supteam:not(.supall)"),function(x){if(on)x.classList.add("on");else x.classList.remove("on");});applySupFilter();}' +
    'function makeSortable(){[].forEach.call(document.querySelectorAll("table.tbl"),function(tb){if(tb.getAttribute("data-srt"))return;tb.setAttribute("data-srt","1");var hs=tb.tHead?tb.tHead.rows[tb.tHead.rows.length-1].cells:[];[].forEach.call(hs,function(th,ci){th.style.cursor="pointer";th.title="คลิกเพื่อเรียง";th.addEventListener("click",function(){sortTbl(tb,ci,th);});});});}' +
    'function sortTbl(tb,ci,th){var tbody=tb.tBodies[0];if(!tbody)return;var rows=[].slice.call(tbody.rows).filter(function(r){return r.cells.length>ci&&!(r.cells[0].hasAttribute("colspan")||r.cells[0].colSpan>1);});var dir=th.getAttribute("data-sd")==="asc"?"desc":"asc";[].forEach.call(tb.tHead.querySelectorAll("th"),function(x){x.removeAttribute("data-sd");var s=x.querySelector(".sar");if(s)s.remove();});th.setAttribute("data-sd",dir);var ar=document.createElement("span");ar.className="sar";ar.textContent=dir==="asc"?" ▲":" ▼";th.appendChild(ar);rows.sort(function(a,b){var x=a.cells[ci].textContent.trim(),y=b.cells[ci].textContent.trim();var nx=parseFloat(x.replace(/[^0-9.\\-]/g,"")),ny=parseFloat(y.replace(/[^0-9.\\-]/g,""));var num=x!==""&&y!==""&&!isNaN(nx)&&!isNaN(ny)&&/[0-9]/.test(x)&&/[0-9]/.test(y)&&!/[A-Za-zก-๙]{2,}/.test(x.replace(/คน|h/g,""));var c=num?(nx-ny):x.localeCompare(y,"th");return dir==="asc"?c:-c;});rows.forEach(function(r){tbody.appendChild(r);});}' +
    'function showPsn(el){var d=el.dataset;var flts=(d.flts||"").split("‖").filter(Boolean);var work=(+d.n>=5)?" <span class=\\"badd\\">(งานเยอะ)</span>":((+d.n===0)?" <span class=\\"okk\\">(ว่าง)</span>":"");' +
    'var h="<div class=\\"psn__hd\\"><b>"+d.nm+"</b> <span class=\\"muted\\">"+d.pos+" · "+d.pteam+"</span><span class=\\"psn__x\\" onclick=\\"hidePsn()\\">✕</span></div>";' +
    'h+="<div class=\\"psn__r\\">🕘 กะ (เข้า-ออก): <b>"+d.shift+"</b></div><div class=\\"psn__r\\">⏱️ OT: "+d.ot+"</div>";' +
    'h+="<div class=\\"psn__r\\">✈️ งานเดิม: <b>"+d.n+"</b> ไฟลท์ · รวม "+d.hrs+"h"+work+"</div>";' +
    'h+="<div class=\\"psn__flts\\">"+(flts.length?flts.map(function(f){return "<span class=\\"chip\\">"+f+"</span>";}).join(" "):"<span class=\\"muted\\">— ไม่มีไฟลท์เดิม (ว่าง)</span>")+"</div>";' +
    'var p=document.getElementById("psnpop");p.innerHTML=h;p.style.display="block";var r=el.getBoundingClientRect();' +
    'p.style.left=Math.max(8,Math.min(r.left,window.innerWidth-370))+"px";p.style.top=(r.bottom+window.scrollY+6)+"px";}' +
    'function hidePsn(){var p=document.getElementById("psnpop");if(p)p.style.display="none";}' +
    'document.addEventListener("click",function(e){var p=document.getElementById("psnpop");if(p&&p.style.display==="block"&&!p.contains(e.target)&&!(e.target.classList&&e.target.closest(".supchip")))hidePsn();});' +
    'window.addEventListener("load",function(){makeSortable();buildTeamSels();});' +
    'window.addEventListener("load",function(){if(!window.Chart)return;if(window.ChartDataLabels)Chart.register(window.ChartDataLabels);' +
    'Chart.defaults.color="'+CI.sub+'";Chart.defaults.font.family="Kanit,sans-serif";Chart.defaults.font.weight="600";' +
    'new Chart(c1,{type:"bar",data:{labels:CD.tn,datasets:[{label:"Working",data:CD.tw,backgroundColor:CD.c.teal,borderRadius:5},{label:"Total",data:CD.tt,backgroundColor:"#c9d6e8",borderRadius:5}]},options:{plugins:{legend:{labels:{boxWidth:12}},datalabels:{anchor:"end",align:"end",font:{size:9,weight:"700"},color:"#15233f"}},scales:{x:{grid:{display:false}},y:{beginAtZero:true,grid:{color:"#eef2f8"},suggestedMax:Math.max.apply(null,CD.tt)+3}}}});' +
    'new Chart(c2,{type:"doughnut",data:{labels:["Working","OFF","Sick","Leave"],datasets:[{data:[CD.work,CD.off,CD.sick,CD.leave],backgroundColor:[CD.c.teal,CD.c.grey,CD.c.red,CD.c.yellow],borderColor:"#fff",borderWidth:2}]},options:{plugins:{legend:{position:"bottom",labels:{boxWidth:12}},datalabels:{color:"#fff",font:{weight:"700"}}}}});' +
    'var OTL=["ก่อนกะ","หลังกะ","OT OFF"],OTC=[CD.c.yellow,CD.c.royal,CD.c.red];' +
    'if(CD.otHolH>0){OTL.push("นักขัต ×1");OTC.push("#f97316");}' +
    'new Chart(c3,{type:"bar",data:{labels:OTL,datasets:[{data:CD.otHolH>0?[CD.otPreN,CD.otPostN,CD.otOffN,CD.otHolN]:[CD.otPreN,CD.otPostN,CD.otOffN],backgroundColor:OTC,borderRadius:6}]},options:{plugins:{legend:{display:false},datalabels:{anchor:"end",align:"end",color:"#15233f",font:{weight:"700"},formatter:function(v){return v+" คน";}}},scales:{x:{grid:{display:false}},y:{beginAtZero:true,grid:{color:"#eef2f8"}}}}});' +
    'new Chart(c4,{type:"bar",data:{labels:OTL,datasets:[{data:CD.otHolH>0?[CD.otPreH,CD.otPostH,CD.otOffH,CD.otHolH]:[CD.otPreH,CD.otPostH,CD.otOffH],backgroundColor:OTC,borderRadius:6}]},options:{plugins:{legend:{display:false},datalabels:{anchor:"end",align:"end",color:"#15233f",font:{weight:"700"},formatter:function(v){return v+"h";}}},scales:{x:{grid:{display:false}},y:{beginAtZero:true,grid:{color:"#eef2f8"}}}}});});' +
    '</script>' + otDashScript_() + '</body></html>';   // สคริปต์ OT (วาดตารางรายเดือน/สัปดาห์) — แท็บกราฟสรุปฝัง iframe lazy
}

var rbVIEW_CSS_ = `
/* ── AOTGA Manpower — Timetable (Phase 2) restyle, scoped to #view-tt ── */
.tt-cnt { font-size: 11px; font-weight: 600; color: var(--ink-2); background: var(--bg-2); border-radius: 20px; padding: 3px 11px; }
#view-tt .tbl { font-size: 13px; }
#view-tt .tbl th, #view-tt .tbl td { text-align: left; }                         /* ตารางรายคน = ชิดซ้ายอ่านง่าย */
#view-tt .tbl th:nth-child(7), #view-tt .tbl td:nth-child(7) { text-align: right; } /* # count */
#view-tt .tbl thead th { color: #93a1b8; background: #f7f9fd; }
#view-tt .tbl td { padding: 10px 12px; border-bottom: 1px solid #eef2f8; color: #5a6b86; }
#view-tt .tbl td:nth-child(1) { font-weight: 700; color: var(--royal); }          /* ทีม */
#view-tt .tbl td:nth-child(3) { font-weight: 600; color: #15233f; }               /* ชื่อ */
#view-tt .tbl tbody tr:hover td { background: #f5f8fd; }
#view-tt .tbl tbody tr.row-off:hover td,
#view-tt .tbl tbody tr.row-sl:hover td,
#view-tt .tbl tbody tr.row-vac:hover td { filter: brightness(.98); }
/* OT type badge → solid AOT pill (ก่อน/หลัง/OFF) */
#view-tt .tbl td:nth-child(6) .tag { background: #236192; color: #fff; border: 0; font-weight: 700; padding: 2px 9px; border-radius: 8px; letter-spacing: .2px; }
#view-tt .chip { border-radius: 8px; padding: 4px 9px; }
#view-tt .chip--sup { background: #fff3e0; color: #b45309; border-color: #f0a64a; }

/* ── AOTGA Manpower — Flights & SLA card grid (Phase 3), scoped to #view-flt ── */
.fltgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 12px; margin-top: 12px; }
.fltcard { display: flex; background: var(--card); border: 1px solid var(--line); border-radius: 15px; overflow: hidden;
  box-shadow: 0 1px 2px rgba(20,40,80,.05); transition: box-shadow .14s, transform .14s; }
.fltcard:hover { box-shadow: 0 8px 20px rgba(21,35,63,.12); transform: translateY(-2px); }
.fltcard--bad { border-color: #f0cec9; }
.fltcard__air { width: 84px; flex: 0 0 auto; background: linear-gradient(118deg,#16315f,#1D428A 55%,#236192);
  color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 10px 4px; text-align: center; }
.fltcard__code { font-size: 21px; font-weight: 800; letter-spacing: 1px; }
.fltcard__name { font-size: 8px; color: rgba(255,255,255,.78); margin-top: 3px; font-weight: 500; line-height: 1.25; }
.fltcard__body { flex: 1; padding: 12px 15px 13px; min-width: 0; }
.fltcard__top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 11px; }
.fltcard__flt { font-size: 18px; font-weight: 800; color: #15233f; letter-spacing: .5px; }
.fltcard__time { font-size: 11px; color: #93a1b8; margin-top: 2px; }
.fc-ac { color: var(--royal); font-weight: 600; }
.fc-ctr { color: #6b7c98; font-weight: 600; }
.fc-ctr--cap { color: #c07d17; font-weight: 700; }
.fc-common { color: #7a5b13; background: #fff3d6; font-weight: 700; border-radius: 6px; padding: 0 5px; }
.fc-pill { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 20px; white-space: nowrap; }
.fc-pill--ok { background: #e4f4ec; color: #1a8f63; }
.fc-pill--bad { background: #fbe6e3; color: #c0392b; }
.fc-pill--warn { background: #fbf0dc; color: #b07d17; }
.fltcard__tiles { display: grid; grid-template-columns: repeat(4,1fr); gap: 7px; }
.fc-tile { text-align: center; background: #e9f0f9; border-radius: 9px; padding: 7px 3px; }
.fc-tile--bad { background: #fbe6e3; }
.fc-tile__l { font-size: 9px; font-weight: 700; color: #93a1b8; text-transform: uppercase; letter-spacing: .3px; }
.fc-tile--bad .fc-tile__l { color: #c96a5e; }
.fc-tile__v { font-size: 15px; font-weight: 800; color: #15233f; margin-top: 2px; }
.fc-tile--bad .fc-tile__v { color: #c0392b; }
.fc-tile__r { font-size: 11px; font-weight: 600; color: #93a1b8; }
@media (max-width: 560px){ .fltgrid { grid-template-columns: 1fr; } }

/* ── AOTGA Manpower — shared polish for all views (Phase 5) ── */
.tablecard, .panel { border-radius: 14px; }
.tablecard__hd h3, .panel__hd h3 { color: #1D428A; letter-spacing: .1px; }
.tbl tbody tr:hover td { background: rgba(78,195,224,.09); }
.tbl tbody tr.row-off:hover td, .tbl tbody tr.row-sl:hover td, .tbl tbody tr.row-vac:hover td { filter: brightness(.98); }
.tbl thead th { background: #f4f7fc; color: #93a1b8; }
.sectionlabel { color: #6b7c98; }
.sectionlabel::after { background: #dbe4f0; }
/* count/summary pill in any card header */
.tt-cnt { font-size: 11px; font-weight: 700; color: #1D428A; background: #e7effa; border-radius: 20px; padding: 3px 11px; }
/* filter controls → clean AOT pills */
.search input, .teamsel, .gapfrom, .gapto, select.expteam, select.fcpick, select.namepick, .selectpill {
  border: 1px solid #e4ebf4 !important; border-radius: 10px !important; background: #fff !important; font-family: inherit; }
.search input:focus, .teamsel:focus, select:focus { outline: 2px solid rgba(29,66,138,.35); outline-offset: 1px; }
.ttbar { background: #f7f9fd; border: 1px solid #eef2f8; border-radius: 12px; padding: 9px 11px; }
/* support / assign team chips accent when selected */
.supteam.on, .chip.on { background: #1D428A !important; color: #fff !important; border-color: #1D428A !important; }
.btn { border-radius: 11px; }
`;
function rbDesignCss_() { return rbDESIGN_CSS_ + rbVIEW_CSS_; }
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

/* ── AOTGA Manpower — App shell + left nav rail (Phase 4) ── */
.app-shell { display: flex; height: 100vh; overflow: hidden; }
.app-rail { width: 214px; flex: 0 0 auto; background: linear-gradient(180deg,#16315f,#1D428A); color: #fff;
  display: flex; flex-direction: column; padding: 16px 12px; gap: 4px; }
.rail-brand { display: flex; align-items: center; gap: 10px; padding: 4px 6px 14px; margin-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,.14); }
.rail-logo { width: 38px; height: 38px; border-radius: 10px; background: #fff; padding: 3px; object-fit: contain; }
.rail-mark { width: 38px; height: 38px; border-radius: 10px; background: rgba(255,255,255,.12); display: grid; place-items: center; font-size: 18px; }
.rail-brandtxt b { font-size: 17px; font-weight: 800; letter-spacing: .5px; display: block; }
.rail-brandtxt b span { color: #4EC3E0; }
.rail-brandtxt small { font-size: 10px; color: #cfe1f5; font-weight: 300; }
.rail-nav { display: flex; flex-direction: column; gap: 3px; overflow-y: auto; flex: 1; margin: 4px 0; }
.rail-nav::-webkit-scrollbar { width: 5px; } .rail-nav::-webkit-scrollbar-thumb { background: rgba(255,255,255,.18); border-radius: 4px; }
.rail-item { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; border: 0; cursor: pointer;
  background: transparent; color: #d8e8f8; font-family: inherit; font-size: 13px; font-weight: 600; padding: 9px 11px; border-radius: 10px; transition: background .13s, color .13s; }
.rail-item:hover { background: rgba(255,255,255,.08); color: #fff; }
.rail-item.active { background: rgba(255,255,255,.16); color: #fff; box-shadow: inset 3px 0 0 #4EC3E0; }
.rail-ic { width: 20px; text-align: center; flex: 0 0 auto; font-size: 14px; }
.rail-txt { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rail-badge { font-size: 10.5px; font-weight: 800; background: #D92526; color: #fff; border-radius: 20px; padding: 1px 7px; flex: 0 0 auto; }
.rail-foot { border-top: 1px solid rgba(255,255,255,.14); padding-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.rail-refresh { border: 1px solid rgba(255,255,255,.2); background: rgba(255,255,255,.06); color: #eaf2fc; border-radius: 9px;
  padding: 7px 10px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; }
.rail-refresh:hover { background: rgba(255,255,255,.14); }
.rail-live { display: inline-flex; align-items: center; gap: 7px; font-size: 11.5px; color: #d8e8f8; padding: 0 4px; }
.pl-dot { width: 8px; height: 8px; border-radius: 50%; background: #58e6a0; animation: pl 2s infinite; flex: 0 0 auto; }
@keyframes pl { 0%{box-shadow:0 0 0 0 rgba(88,230,160,.5)} 70%{box-shadow:0 0 0 7px rgba(88,230,160,0)} 100%{box-shadow:0 0 0 0 rgba(88,230,160,0)} }
.app-main { flex: 1; min-width: 0; height: 100vh; overflow: auto; background:
  radial-gradient(1000px 480px at 88% -12%, rgba(78,195,224,.16), transparent 60%),
  radial-gradient(820px 420px at -6% 0%, rgba(29,66,138,.09), transparent 55%), #eef3fa; }
.app-pad { padding: 20px 24px 44px; max-width: 1400px; margin: 0 auto; }
.topbar { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; margin-bottom: 14px; }
.topbar-h h2 { font-size: 20px; font-weight: 800; color: #15233f; letter-spacing: .2px; margin: 0; }
.topbar-sub { font-size: 12.5px; color: #5a6b86; margin-top: 2px; }
.topbar-actions { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
.topbar-actions .datepill { background: #fff; border: 1px solid #e4ebf4; border-radius: 11px; padding: 7px 13px; }
.topbar-actions .datepill .d { font-size: 14px; font-weight: 800; color: #1D428A; }
@media (max-width: 900px) { .app-rail { width: 60px; padding: 16px 8px; } .rail-txt, .rail-brandtxt, .rail-live, .rail-refresh { display: none !important; } .rail-badge { position: absolute; margin-left: 22px; margin-top: -14px; } .rail-item { justify-content: center; position: relative; } }
@media (max-width: 560px) { .app-pad { padding: 14px 12px 36px; } .topbar { flex-direction: column; align-items: flex-start; } }
@media print { .app-shell { display: block; height: auto; overflow: visible; } .app-rail { display: none; } .app-main { height: auto; overflow: visible; background: #fff; } }

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

/* ── AOTGA Manpower — Dashboard hero (attendance donut + KPI tiles) ── */
.hero { display: flex; align-items: center; gap: 26px; flex-wrap: wrap;
  background: linear-gradient(118deg,#16315f,#1D428A 55%,#236192); border-radius: 16px;
  padding: 20px 24px; color: #fff; margin-bottom: 16px; box-shadow: 0 10px 26px rgba(21,35,63,.22); }
.hero__ring { width: 128px; height: 128px; border-radius: 50%; display: grid; place-items: center; flex: 0 0 auto; }
.hero__ring-in { width: 92px; height: 92px; border-radius: 50%; background: #1a3a6e; display: flex;
  flex-direction: column; align-items: center; justify-content: center; }
.hero__pct { font-size: 30px; font-weight: 800; line-height: 1; }
.hero__pctl { font-size: 10px; color: #cfe1f5; margin-top: 2px; }
.hero__main { min-width: 160px; }
.hero__lbl { font-size: 12px; color: #cfe1f5; font-weight: 300; margin-bottom: 6px; }
.hero__big { font-size: 38px; font-weight: 800; line-height: 1; }
.hero__tot { font-size: 17px; font-weight: 500; color: #cfe1f5; }
.hero__chips { display: flex; gap: 16px; margin-top: 14px; flex-wrap: wrap; }
.hchip { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: #e6f0fb; font-weight: 500; }
.hchip i { width: 9px; height: 9px; border-radius: 3px; display: inline-block; }
.hchip b { font-weight: 800; }
.hero__kpis { display: grid; grid-template-columns: repeat(4, minmax(96px,1fr)); gap: 12px; margin-left: auto; }
.hkpi { background: rgba(255,255,255,.10); border: 1px solid rgba(255,255,255,.16); border-radius: 12px; padding: 12px 14px; }
.hkpi__n { font-size: 26px; font-weight: 800; line-height: 1; }
.hkpi__u { font-size: 14px; font-weight: 600; color: #cfe1f5; margin-left: 1px; }
.hkpi__l { font-size: 12px; color: #eaf2fc; font-weight: 600; margin-top: 5px; }
.hkpi__s { font-size: 10.5px; color: #b9cde6; margin-top: 1px; }

/* urgent flights strip */
.urgent { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px; margin-bottom: 16px; }
.urgent__hd { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.urgent__hd h3 { font-size: 15px; font-weight: 700; color: var(--ink); margin: 0; }
.urgent__all { border: 1px solid var(--line); background: var(--surface); color: var(--royal, #1D428A);
  border-radius: 10px; padding: 6px 12px; font-size: 12.5px; font-weight: 700; cursor: pointer; font-family: inherit; }
.urgent__all:hover { background: #eef3fa; }
.urgent__list { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px,1fr)); gap: 10px; }
.ufl { display: flex; align-items: center; justify-content: space-between; gap: 10px;
  border: 1px solid #f2d3cf; background: #fdf4f2; border-radius: 11px; padding: 10px 13px; }
.ufl__flt { font-weight: 800; color: var(--ink); font-size: 14px; }
.ufl__std { font-size: 11px; color: var(--ink-3); margin-top: 1px; }
.ufl__x { font-size: 11.5px; font-weight: 700; color: #c0392b; text-align: right; }
@media (max-width: 900px){ .hero__kpis { grid-template-columns: repeat(2,1fr); margin-left: 0; width: 100%; } }

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
.teamsel { font-family: inherit; font-size: 13px; font-weight: 600; color: var(--ink); padding: 7px 11px; border: 1px solid var(--line); border-radius: 9px; background: var(--card); cursor: pointer; margin-left: 8px; }
.tablecard__hd { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; padding: 16px 20px 13px; }
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
.chipgroup { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-start; }
.tbl td .chipgroup { min-width: 320px; }
.chip { display: inline-block; line-height: 1.35; font-family: inherit; cursor: pointer; font-size: 11px; font-weight: 600; padding: 4px 9px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); color: var(--ink-2); transition: all .13s; white-space: normal; }
.chip:hover { border-color: var(--accent); }
.chip--duty { background: var(--bg-2); color: var(--ink-3); border-style: dashed; }
.chip--sup { background: #fff3e0; color: #b45309; border-color: #f0a64a; }
.planchip .editnm { display: inline-block; max-width: 96px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; min-width: 22px; padding: 0 2px; border-bottom: 1px dashed var(--accent); outline: none; cursor: text; font-weight: 700; color: var(--ink-2); }
.planchip .editnm:focus { max-width: none; overflow: visible; background: #fff7d6; border-bottom-color: #d9a400; border-radius: 3px; }
.planchip.edited { background: #fff7d6; border-color: #d9a400; }
.planchip__i { cursor: pointer; color: var(--ink-3); font-weight: 600; }
.planchip__i:hover { color: var(--accent); }
.pickwrap { display: flex; flex-direction: column; gap: 2px; margin-top: 2px; }
.namepick { font-family: inherit; font-size: 9.5px; font-weight: 600; padding: 2px 3px; border-radius: 5px; border: 1px solid var(--line); background: var(--bg-2); color: var(--ink-2); width: 96px; max-width: 96px; cursor: pointer; }
.namepick:focus { outline: none; border-color: var(--accent); background: #fff; }
#view-adv .tbl th, #view-adv .tbl td { padding: 5px 5px; font-size: 10.5px; }
#view-adv .tbl thead th { position: sticky; top: 0; z-index: 2; font-size: 9.5px; }
#view-sup .namepick { width: 210px; max-width: 210px; font-size: 11px; padding: 3px 6px; }
#view-sup .pickwrap { gap: 3px; }
.namepick.edited { background: #fff7d6; border-color: #d9a400; }
.supbar { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin: 10px 0 4px; font-size: 13px; }
.supteam { font-family: inherit; font-size: 12px; font-weight: 700; padding: 5px 11px; border-radius: 999px; border: 1px solid var(--line); background: var(--card); color: var(--ink-3); cursor: pointer; }
.supteam.on { background: var(--brand); color: #fff; border-color: var(--brand); }
.supteam.supall { background: var(--bg-2); color: var(--ink); }
.supgrp { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: 0 10px 6px 0; padding: 3px 4px 3px 0; }
.supgrp__t { font-size: 11px; font-weight: 800; color: var(--brand); background: var(--bg-2); border-radius: 7px; padding: 3px 8px; margin-right: 4px; white-space: nowrap; }
.supwrap { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 6px 10px; max-width: 760px; }
.supchip { font-size: 10.5px; padding: 3px 7px; white-space: nowrap; cursor: pointer; }
.supchip:hover { border-color: var(--accent); background: #eef4fb; }
.supchip.sup--busy { border-color: #e0a96d; }
.supchip.sup--free { border-color: #56b682; }
.supchip.sup--sub { background: #fdf2e3; border: 1px dashed #e0a96d; color: #9a5b1a; }
.supchip.sup--sub::before { content: "↪ "; font-weight: 700; }
.psnpop { position: absolute; z-index: 9999; width: 350px; max-width: 92vw; background: #fff; border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 12px 34px rgba(20,40,80,.22); padding: 13px 15px; font-size: 13px; }
.psn__hd { display: flex; align-items: center; gap: 6px; font-size: 14px; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--line-2); }
.psn__x { margin-left: auto; cursor: pointer; color: var(--ink-3); font-weight: 700; padding: 0 4px; }
.psn__r { margin: 4px 0; }
.psn__flts { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.psn__flts .chip { font-size: 10.5px; padding: 3px 7px; }
.tbl tbody tr.row-off td { background: #eceff1 !important; color: #7c878f; }
.tbl tbody tr.row-sl  td { background: #f8d7da !important; color: #b3261e; font-weight: 600; }
.tbl tbody tr.row-vac td { background: #fff3cd !important; color: #7a5b00; }

/* AOTGA Manpower Phase 2/3 component CSS moved to rbVIEW_CSS_ (also embedded in lazy views) */
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
.foot { margin-top: 26px; text-align: center; color: var(--ink-3); font-size: 11.5px; display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 12px; flex-wrap: wrap; }
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
tr.rowextra td{background:#eef7ff}
.muted{color:var(--ink-3)}
/* ============ UI REFRESH · modern + corporate (PAS) ====================== */
:root{
  --bg:#f4f7fc; --bg-2:#eaf1f9; --line:#e6edf7; --line-2:#eef3fa;
  --shadow-sm:0 1px 2px rgba(18,38,76,.04),0 6px 16px rgba(18,38,76,.05);
  --shadow:0 2px 8px rgba(18,38,76,.05),0 18px 40px rgba(18,38,76,.08);
}
body{ -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility; }
/* cards */
.tablecard,.panel,.kpi,.ttcard{ border-radius:18px; }
.tablecard{ transition:box-shadow .18s ease; }
.tablecard:hover{ box-shadow:var(--shadow); }
.tablecard__hd{ border-bottom:1px solid var(--line-2); padding-bottom:12px; }
.tablecard__hd h3{ font-size:15px; letter-spacing:.1px; }
/* flight count summary */
.fltkpis{ display:flex; gap:10px; padding:14px; }
.fltkpi{ background:#eef3fb; border:1px solid var(--line-2); border-radius:12px; padding:14px 28px; text-align:center; min-width:160px; }
.fltkpi__n{ font-size:34px; font-weight:800; line-height:1; color:#0d2137; }
.fltkpi__l{ font-size:12.5px; color:#5b6b82; margin-top:6px; font-weight:600; }
/* tables */
.tbl th{ font-size:11px; background:#eef3fb; }
.tbl tbody tr{ transition:background .12s ease; }
.tbl tbody tr:hover td{ background:color-mix(in srgb,var(--accent) 9%, white); }
/* tabs (pill + active glow) */
.tabs{ gap:7px; }
.tab{ border-radius:11px; padding:10px 16px; font-size:13.5px; box-shadow:var(--shadow-sm); }
.tab:hover{ transform:translateY(-1px); }
.tab.active{ box-shadow:0 7px 18px rgba(29,66,138,.28); }
/* inputs/buttons */
.search input{ border-radius:11px; transition:border-color .15s, box-shadow .15s; }
.btn--accent{ box-shadow:0 6px 16px rgba(29,66,138,.20); }
/* --- responsive: tablet/มือถือ --- */
@media (max-width:860px){
  .wrap{ padding:12px 12px 40px; }
  .appbar{ flex-wrap:wrap; gap:10px; padding:14px 16px; }
  .tabs{ flex-wrap:nowrap; overflow-x:auto; -webkit-overflow-scrolling:touch; padding-bottom:5px; scrollbar-width:thin; }
  .tab{ flex:0 0 auto; padding:9px 13px; font-size:13px; }
  .tablecard__hd{ padding:13px 14px 11px; }
  .tbl{ font-size:12px; }
  .tbl th,.tbl td{ padding:8px 9px; }
  .planchip .editnm{ max-width:78px; }
  .tablecard__hd h3{ font-size:14px; }
}
@media (max-width:520px){
  .kpis{ grid-template-columns:1fr 1fr; }
  .brand h1{ font-size:17px; }
  .brand p{ font-size:11px; }
  .tab{ padding:8px 11px; font-size:12.5px; }
  .planchip .editnm{ max-width:66px; }
}
/* ===== UI REFRESH · phase 2 (header + segmented tabs + rhythm) =========== */
:root{ --header-grad:linear-gradient(120deg,#10254a 0%,#1D428A 54%,#236192 100%); }
.appbar{ box-shadow:0 12px 34px rgba(16,37,74,.20); }
.appbar::after{ content:""; position:absolute; left:0; right:0; bottom:0; height:3px; background:linear-gradient(90deg,var(--sky),var(--teal)); }
.brand__mark{ border-radius:13px; }
/* โลโก้ AOTGA (วางบนชิปขาวเพื่อให้ตัวอักษรน้ำเงินอ่านออกบนหัวเว็บเข้ม) */
.brand__logo{ height:42px; width:auto; max-width:230px; background:#fff; padding:5px 11px; border-radius:12px; box-shadow:0 5px 14px rgba(0,0,0,.18); object-fit:contain; }
.foot__logo{ height:46px; width:auto; display:block; margin:0; }
/* หน้าต่างคู่มือ (ℹ️ ช่วยเหลือ) */
.helpov{ position:fixed; inset:0; z-index:9999; background:rgba(16,37,74,.45); backdrop-filter:blur(2px); display:flex; align-items:flex-start; justify-content:center; padding:5vh 16px; }
.helpbox{ background:var(--card); border:1px solid var(--line); border-radius:18px; box-shadow:0 24px 60px rgba(16,37,74,.35); width:100%; max-width:720px; max-height:88vh; display:flex; flex-direction:column; overflow:hidden; }
.helpbox__hd{ display:flex; align-items:center; justify-content:space-between; padding:15px 20px; background:var(--header-grad); color:#fff; }
.helpbox__hd h3{ margin:0; font-size:16px; }
.helpx{ background:rgba(255,255,255,.18); color:#fff; border:0; width:30px; height:30px; border-radius:9px; cursor:pointer; font-size:15px; }
.helpx:hover{ background:rgba(255,255,255,.32); }
.helpbox__bd{ padding:18px 22px; overflow-y:auto; font-size:13.5px; line-height:1.6; color:var(--ink-2); }
.helpbox__bd h4{ margin:18px 0 7px; font-size:14px; color:var(--brand); border-top:1px solid var(--line); padding-top:14px; }
.helpbox__bd h4:first-of-type{ border-top:0; padding-top:0; }
.helpul{ margin:4px 0 4px 2px; padding-left:18px; }
.helpul li{ margin:3px 0; }
.helpbox__bd code{ background:var(--bg-2); border:1px solid var(--line); border-radius:6px; padding:1px 6px; font-size:12px; }
.helptb{ width:100%; border-collapse:collapse; margin:6px 0; font-size:12.5px; }
.helptb th,.helptb td{ border:1px solid var(--line); padding:4px 8px; text-align:center; }
.helptb th{ background:#eef3fb; }
.helptb td:first-child{ font-weight:600; }
@media (max-width:520px){ .brand__logo{ height:34px; max-width:170px; } }
/* เมนูแท็บแบบ segmented control */
.tabs{ background:var(--card); border:1px solid var(--line); padding:6px; border-radius:16px; box-shadow:var(--shadow-sm); }
.tab{ background:transparent; border:0; box-shadow:none; border-radius:11px; }
.tab:hover{ background:var(--bg-2); transform:none; color:var(--brand); }
.tab.active{ background:var(--brand); color:#fff; box-shadow:0 4px 12px rgba(29,66,138,.30); }
/* ระยะห่าง/จังหวะ */
.tablecard{ margin-bottom:16px; }
@media (max-width:860px){ .tabs{ border-radius:13px; padding:5px; } }
@media print{
  .weeknav,.tabs,.btn,.ttbar,.foot,.app-rail,.psnpop{display:none!important}
  /* พิมพ์เฉพาะแท็บที่เปิดอยู่ — แท็บที่ไม่ active ยังเป็น display:none (inline) จาก showView → ไม่ต้องบังคับโชว์ */
  .app-shell{display:block!important;height:auto!important;overflow:visible!important}
  .app-main{height:auto!important;overflow:visible!important;background:#fff!important}
  .app-pad{padding:0!important}
  .gt,.gt-scroll,.tablecard,.panel{overflow:visible!important}
  .gt-row,.panel,.tablecard,tr{break-inside:avoid}
}
@page{size:A4 landscape;margin:8mm}
`;
