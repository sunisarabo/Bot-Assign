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
    if (MASTER_FILE_ID_RB) { try { master = readMasterHeadcount(MASTER_FILE_ID_RB); } catch (e4) {} }
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
  try { rbCachePutBig_('resll_' + iso, JSON.stringify(out), RB_RESLL_TTL); } catch (e2) {}
  if (got) { try { lock.releaseLock(); } catch (e3) {} }
  return out;
}
var RB_RESLL_TTL = 900;   // อายุ cache ข้อมูลรายวัน (วินาที) — 15 นาที · trigger อุ่น cache ทุก 5 นาทีจะคอยเติมให้สด

/** อุ่น cache ของ "วันนี้" ไว้ล่วงหน้า — ผู้ใช้เปิดหน้าเว็บจะได้ข้อมูลทันที ไม่ต้องรออ่าน 20 ชีต
 *  (เทียบเท่า "background process" ในระบบใหญ่ · GAS ใช้ time-driven trigger แทน worker) */
function rbWarmCache() {
  try {
    var tz = Session.getScriptTimeZone() || 'Asia/Bangkok';
    var now = new Date();
    var iso = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    var out = rbLoadResLLraw_(now);                       // อ่านสด (ข้าม cache) แล้วเขียนทับให้สด
    rbCachePutBig_('resll_' + iso, JSON.stringify(out), RB_RESLL_TTL);
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
function rbLoadResLLraw_(date) {
  var roster = rbOpenTodayRoster_(date);
  var res = readRosterFromSpreadsheet(roster.ss, date);
  if (roster.tempId) { try { DriveApp.getFileById(roster.tempId).setTrashed(true); } catch (e) {} }
  var ll = null;
  if (CONFIG_RB.LL_FILE_ID) { try { ll = readLLForDate(CONFIG_RB.LL_FILE_ID, date); } catch (e2) {} }
  return { res: res, ll: ll };
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
    var c = CacheService.getScriptCache(), nn = c.get('resll_' + iso + '_n'), keys = ['resll_' + iso + '_n'];
    if (nn) for (var i = 0; i < +nn; i++) keys.push('resll_' + iso + '_' + i);
    c.removeAll(keys);
  } catch (e) {}
  return true;
}
function rbDateFromIso_(iso) { var a = String(iso).split('-'); return new Date(+a[0], +a[1] - 1, +a[2]); }

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
    return rbTblCard_('🕓 Timetable · ตารางงานรายคน (เวลาเข้า-ออกกะ · OT · STA/STD)',
      '<tr><th>ทีม</th><th>รหัส</th><th>ชื่อ</th><th>ตำแหน่ง</th><th>กะ (เข้า-ออก)</th><th>OT</th><th>#</th><th>เที่ยวบิน</th></tr>',
      rbTtRows_(d.res, d.ll),
      rbCtrls_('view-tt', true));
  } catch (e) { return '<div class="panel">โหลด Timetable ไม่ได้: ' + rbEsc_(e.message) + '</div>'; }
}
/** Lazy tab: Flights & SLA HTML. */
function rbFlightsHtml(iso) {
  try {
    var d = rbLoadResLL_(rbDateFromIso_(iso));
    return rbTblCard_('✈️ ไฟลท์บินประจำวัน + เช็ค SLA สายการบิน',
      '<tr><th>Flight</th><th>สายการบิน</th><th>ทีม</th><th>STA</th><th>STD</th><th>จัด/รวม</th><th>SUP</th><th>FC</th><th>Check-in</th><th>Arrival</th><th>Gate<br>Controller</th><th>Gate<br>Agent</th><th>Post<br>Dep.</th><th>สถานะ</th></tr>',
      rbFltRows_(d.res, d.ll), rbCtrls_('view-flt', true));
  } catch (e) { return '<div class="panel">โหลด Flights ไม่ได้: ' + rbEsc_((e && (e.message || e.stack || e.toString())) || 'unknown') + '</div>'; }
}

/** Lazy tab: ตรวจความเหมาะสมการ Assign (ครอบคลุมไฟลท์ / OT / ช่วงว่าง). */
function rbAssignHtml(iso) {
  try {
    var d = rbLoadResLL_(rbDateFromIso_(iso));
    var an = acAnalyze_(d.res, d.ll), s = an.summary;
    var hd = '<div class="sectionlabel">ตรวจ <b>' + s.checked + '</b>/' + s.working +
      ' คนที่มาทำงาน · <b class="badd">🔴 ไฟลท์นอกเวลา/ขาด OT ' + s.bad + '</b> · 🟡 ควรตรวจ ' + s.warn +
      ' · OT อาจเกิน ' + s.otMuch + ' · มีช่วงว่าง ' + s.gap +
      ' · <span class="muted">ไม่มีไฟลท์ ' + s.noFlt + ' (bench/standby)</span>' +
      (s.noWin ? ' · (ไม่มีเวลากะระบุ ' + s.noWin + ' — ข้าม)' : '') + '</div>';
    var rows = an.rows.map(function (r) {
      var emo = r.status === 'bad' ? '🔴' : '🟡';
      return '<tr class="' + (r.status === 'bad' ? 'rowbad' : '') + '" data-team="' + rbEsc_(r.team) + '" data-gaps="' + rbEsc_(r.gapsRaw || '') + '"><td>' + emo + '</td><td class="b">' +
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
function rbSupportHtml(iso) {
  try {
    var d = rbLoadResLL_(rbDateFromIso_(iso));
    var rows = slaSupportRows_(d.res, d.ll);
    var nF = {}, supTeams = {};
    rows.forEach(function (r) { nF[r.flight] = 1; r.cands.forEach(function (c) { supTeams[c.team] = 1; }); });
    var hd = '<div class="sectionlabel">ไฟลท์ที่คนไม่ครบตาม SLA: <b class="badd">' + Object.keys(nF).length +
      ' ไฟลท์</b> · ตำแหน่งที่ขาด ' + rows.length + ' รายการ — แนะนำคนที่ <b>ว่างช่วงนั้น + รู้ระบบเช็คอิน</b></div>';
    // แถบเลือกหลายทีม: เลือกได้ว่าจะดึงคนจากทีมไหนมาช่วย (คลิกสลับเปิด/ปิด)
    var teamBar = Object.keys(supTeams).sort().map(function (t) {
      return '<button class="supteam on" data-t="' + rbEsc_(t) + '" onclick="toggleSupTeam(this)">' + rbEsc_(t) + '</button>';
    }).join('');
    if (teamBar) teamBar = '<div class="supbar"><b>เลือกทีมที่จะดึงมาช่วย:</b> ' + teamBar +
      ' <button class="supteam supall" onclick="allSupTeams(this)">ทั้งหมด</button>' +
      '<span class="muted" style="font-size:12px">— ถ้าทีมที่เลือกไม่พอ ระบบเติม <span class="sup--sub" style="padding:1px 6px;border-radius:6px">↪ ทดแทน</span> จากทีมอื่นให้ครบจำนวนที่ขาด</span></div>';
    var body = rows.map(function (r) {
      var who;
      if (r.cands.length) {
        var grps = slaGroupCands_(r.cands);
        function sel(defName) {
          var h = '<select class="namepick"><option value=""' + (defName ? '' : ' selected') + '>— เลือกคน —</option>';
          grps.forEach(function (g) {
            h += '<optgroup label="' + rbEsc_(g.team) + ' (' + g.people.length + ')">';
            g.people.forEach(function (p) {
              h += '<option value="' + rbAttr_(p.name) + '"' + (p.name === defName ? ' selected' : '') + '>' +
                rbEsc_(p.name + ' · ' + (p.pos || '') + ' · ' + (p.shift || '') + ' · ' + (p.n || 0) + ' ไฟลท์'
                  + (p.hlevel && p.hlevel !== 'ok' ? '  ⚠️ ' + (p.htxt || 'เกินชั่วโมง') : '')) + '</option>';
            });
            h += '</optgroup>';
          });
          return h + '</select>';
        }
        // 1 ช่อง = 1 คน · ค่าเริ่มต้นกระจายหลายทีม (แนะทีมอื่นด้วย ไม่ใช่ทีมลอยซ้ำ) แล้วค่อยเติมจากที่ดีสุด
        var slots = [], usedT = {}, picked = [];
        r.cands.forEach(function (c) { if (picked.length < r.shortN && !usedT[c.team]) { usedT[c.team] = 1; picked.push(c.name); } });
        for (var ci = 0; picked.length < r.shortN && ci < r.cands.length; ci++) if (picked.indexOf(r.cands[ci].name) < 0) picked.push(r.cands[ci].name);
        for (var i = 0; i < r.shortN; i++) slots.push(sel(picked[i] || ''));
        who = '<div class="pickwrap">' + slots.join('') + '</div>';
      } else {
        who = '<span class="badd">' + (r.block ? '🚫 ' + rbEsc_(r.block) : (r.needSys ? 'ไม่มีคนว่างที่รู้ระบบ ' + rbEsc_(r.needSys) : 'ไม่มีคนว่าง')) + '</span>';
      }
      return '<tr class="' + (r.cands.length ? '' : 'rowbad') + '" data-team="' + rbEsc_(r.team) + '"><td class="b">' + rbEsc_(r.flight) +
        '</td><td>' + rbEsc_(r.airline) + '</td><td>' + rbEsc_(r.system || '-') + '</td><td>' + rbEsc_(r.team) + '</td><td class="tnum">' + rbEsc_(r.STD) +
        '</td><td class="badd">' + rbEsc_(r.phase) + ' ขาด ' + r.shortN + (r.needSys ? ' <span class="muted">(' + rbEsc_(r.needSys) + ')</span>' : '') +
        '</td><td class="tnum">' + rbEsc_(r.win) + '</td><td>' + who + '</td></tr>';
    }).join('');
    if (!body) body = '<tr><td colspan="8" class="okk" style="text-align:center;padding:20px">✅ ทุกไฟลท์ส่งพนักงานครบตาม SLA</td></tr>';
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
      '<div style="margin-top:6px"><button class="btn btn--accent" onclick="supImport()">🔎 แปลง/พรีวิว</button> <button class="btn" onclick="supImportSheet()">📤 สร้างชีต</button> <span id="supimpmsg" class="muted"></span></div>' +
      '<div id="supimpout" style="margin-top:8px"></div></div></details>';
    return hd + checkPanel + importPanel + sosBlock + rbTblCard_('🆘 ไฟลท์คนไม่ครบ + เลือกคนมาช่วย (แสดงกะ · จำนวนไฟลท์)',
      '<tr><th>Flight</th><th>สายการบิน</th><th>ระบบเช็คอิน</th><th>ทีม</th><th>STD</th><th>ตำแหน่งที่ขาด</th><th>ช่วงเวลา</th><th>เลือกคนมาช่วย (ทีมเจ้าของก่อน · กะ · จำนวนไฟลท์)</th></tr>',
      body, rbCtrls_('view-sup', true));
  } catch (e) { return '<div class="panel">โหลด Support ไม่ได้: ' + rbEsc_(e.message) + '</div>'; }
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
    '<button class="btn btn--accent" onclick="window.print()">⬇ Export PDF</button></div></div></div></div></div>';
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
    '<button class="tab" id="tab-dc" onclick="showView(\'dc\');loadDc()">🩺 ตรวจข้อมูล</button>' +
    '<button class="tab" onclick="rbRefresh(this)" title="ล้างแคช ดึงข้อมูลล่าสุดจากชีต" style="margin-left:auto">🔄 รีเฟรช</button></div>';
}

/** Lazy tab: 🩺 ตรวจข้อมูล — ฟ้องจุดผิดในชีตรายวัน (ให้แก้ที่ต้นทาง ไม่ต้องไล่แก้สรุปทีหลัง) */
function rbDataCheckHtml(iso) {
  try {
    var d = rbLoadResLL_(rbDateFromIso_(iso));
    var res = d.res, ll = d.ll;
    var cats = { droptab: [], staledate: [], offflt: [], noshift: [], flttime: [], dupteam: [], dupname: [], supnoteam: [] };
    (res.droppedTabs || []).forEach(function (nm) {
      cats.droptab.push({ team: nm, who: 'อ่านไม่ได้ทั้งแท็บ', detail: 'แท็บนี้มีข้อมูลแต่ระบบอ่านไม่ออก (เช่น ไม่มีคอลัมน์ ID/หัวตารางไม่ตรงแบบมาตรฐาน) — ทั้งทีมหายจากยอด/ไฟลท์' });
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
  var work = b.working + b.ot_off, pct = b.staff>0 ? Math.round(work/b.staff*100) : 0;
  return '<tr><td class="b">' + rbEsc_(label) + '</td><td class="tnum">' + b.staff + '</td><td class="tnum"><b>' + work +
    '</b></td><td class="tnum">' + b.off + '</td><td class="tnum">' + b.sick + '</td><td class="tnum">' + b.leave + '</td><td class="tnum">' + rbOtTxt_(b.ot_off, b.otOffHrs) +
    '</td><td class="tnum">' + rbOtTxt_(b.otPre, b.otPreHrs) + '</td><td class="tnum">' + rbOtTxt_(b.otPost, b.otPostHrs) +
    '</td><td style="min-width:90px">' + rbBarMini_(pct) + '</td></tr>';
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
    var hs = (typeof slaHoursStat_==='function') ? slaHoursStat_(r.shiftHrs, r.ot, r.bucket) : null;   // สถานะชั่วโมงตามระเบียบ (กะ 7-12ช · ot_off นับแค่ OT)
    var ot = r.ot ? ((r.bucket==='ot_off'?'<span class="tag">OFF</span>':(r.otType==='PRE'?'<span class="tag">ก่อน</span>':'<span class="tag">หลัง</span>'))+' '+(r.otTime||'')+' <span class="muted">('+r.ot+'h)</span>') : '<span class="muted">—</span>';
    if (hs) ot += ' <span class="muted">· รวม '+hs.total+'ช</span>' + (hs.level!=='ok' ? ' <span class="'+(hs.level==='short'?'tag':'badd')+'">⚠️ '+rbEsc_(hs.txt)+'</span>' : '');
    var supTag = r.support ? ' <span class="tag" title="มาช่วยจากทีม '+rbEsc_(r.supportTeam||'')+'">🤝 ซัพจาก '+rbEsc_(r.supportTeam||'?')+'</span>' : '';
    return '<tr data-team="'+rbEsc_(r.team)+'" data-start="'+st+'"><td class="b">'+rbEsc_(r.team)+'</td><td class="tnum">'+rbEsc_(r.support?'ซัพ':(r.id||''))+
      '</td><td>'+rbEsc_(r.name)+supTag+'</td><td>'+rbEsc_(r.pos||'')+'</td><td>'+sh+'</td><td>'+ot+'</td><td class="tnum">'+rbFltCount_(r.assignments)+
      '</td><td>'+rbFlightChips_(r.assignments, r.team, owner)+'</td></tr>';
  }).join('');
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

  var teamHead = '<tr><th>ทีม</th><th>Total</th><th>Working</th><th>OFF</th><th>Sick</th><th>Vac</th><th>OT-Off</th><th>OT ก่อน</th><th>OT หลัง</th><th>%Working</th></tr>';
  var posHead = '<tr><th>ตำแหน่ง</th><th>Total</th><th>Work</th><th>OT-Off</th><th>Off</th><th>Sick</th><th>Leave</th><th>OT ก่อน</th><th>OT หลัง</th></tr>';
  var masterLine = master ? ('<div class="sectionlabel">👥 พนักงานทั้งหมด (Active): PSA <b>'+master.PSA.total+'</b> + LL <b>'+master.LL.total+'</b> = <b>'+(master.PSA.total+master.LL.total)+'</b> คน</div>') : '';
  var llCards = '';
  if (L) {
    var secRows = Object.keys(ll.sections).map(function(s){ return rbAggRowHtml_(s, ll.sections[s]); }).join('');
    llCards = rbTblCard_('🟡 LL by Section', '<tr><th>ส่วนงาน</th><th>Total</th><th>Working</th><th>OFF</th><th>Sick</th><th>Vac</th><th>OT-Off</th><th>OT ก่อน</th><th>OT หลัง</th><th>%Working</th></tr>', secRows) +
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
  var fillInner = staticMode ? rbFillPlanHtml(iso)
    : '<div id="fillbox"><div class="panel muted" style="text-align:center;padding:34px">⏳ กำลังเติมคนเสริมไฟลท์ที่ขาด…</div></div>';
  var autoInner = staticMode ? rbAutoAssignHtml(iso)
    : '<div id="autobox"><div class="panel muted" style="text-align:center;padding:34px">⏳ กำลังจัดเวรใหม่ทั้งหมดตาม SLA…</div></div>';
  var advInner = '<div id="advbox"><div class="panel muted" style="text-align:center;padding:34px">⏳ กดแท็บเพื่อจัดเวรล่วงหน้า (อ่านลิงก์ ROSTER/FLIGHT/รายชื่อจริง)…</div></div>';

  return '<!doctype html><html lang="th" data-theme="corporate"><head><meta charset="utf-8">' +
    '<link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">' +
    '<style>' + rbDesignCss_() + otDashCss_() + '</style></head><body><div class="wrap">' +
    rbAppbar_(date) + rbWeekNav_(date, iso, base, tz) + rbTabs_(shortCount, acCount) +
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
    '<div style="margin-top:16px">' + rbTblCard_('👥 PSA by Position', posHead, rbPosRows_(res.positions, ['PSS','SNR','PSA','Globlex','AdminD','Porter','Crewsign'])) + '</div>' +
    (L ? '<div style="margin-top:16px">'+llCards+'</div>' : '') +
    '</div>' +
    '<div id="view-tt" style="display:none">' + ttInner + '</div>' +
    '<div id="view-flt" style="display:none">' + fltInner + '</div>' +
    '<div id="view-sup" style="display:none">' + supInner + '</div>' +
    '<div id="view-ac" style="display:none">' + acInner + '</div>' +
    '<div id="view-fill" style="display:none">' + fillInner + '</div>' +
    '<div id="view-auto" style="display:none">' + autoInner + '</div>' +
    '<div id="view-adv" style="display:none">' + advInner + '</div>' +
    '<div id="view-ot" style="display:none">' + otInner + '</div>' +
    '<div id="view-wh" style="display:none"><div id="whbox"><div class="panel muted" style="text-align:center;padding:34px">⏳ กำลังโหลด…</div></div></div>' +
    '<div id="view-dc" style="display:none"><div id="dcbox"><div class="panel muted" style="text-align:center;padding:34px">⏳ กำลังตรวจข้อมูล…</div></div></div>' +
    '<div class="foot">' + (logo ? '<img class="foot__logo" src="' + logo + '" alt="AOTGA">' : '') + '<span>แผนกการโดยสาร ท่าอากาศยานภูเก็ต · บริษัท บริการภาคพื้น ท่าอากาศยานไทย จำกัด (AOTGA)</span></div>' +
    '</div>' +
    '<div id="psnpop" class="psnpop" style="display:none" onclick="event.stopPropagation()"></div>' +
    rbHelpModal_() +
    '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>' +
    '<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0/dist/chartjs-plugin-datalabels.min.js"></script>' +
    '<script>var CD=' + JSON.stringify(cd) + ';var ISO=' + JSON.stringify(iso) + ';var STATIC=' + (staticMode ? 'true' : 'false') + ';' +
    'function showView(v){["dash","tt","flt","sup","ac","fill","auto","adv","ot","wh","dc"].forEach(function(x){var vv=document.getElementById("view-"+x),tb=document.getElementById("tab-"+x);if(vv)vv.style.display=v===x?"":"none";if(tb)tb.className="tab"+(v===x?" active":"");});}' +
    'function loadWh(){lazy("whbox","rbWeekHoursHtml","wh");}' +
    'function loadDc(){lazy("dcbox","rbDataCheckHtml","dc");}' +
    'function pwmsHelp(s){var o=document.getElementById("helpov");if(o){o.style.display=s?"flex":"none";document.body.style.overflow=s?"hidden":"";}}' +
    'document.addEventListener("keydown",function(e){if(e.key==="Escape")pwmsHelp(0);});' +
    'var LD={};function lazy(box,fn,id){if(STATIC||LD[id])return;LD[id]=1;if(!(window.google&&google.script&&google.script.run)){document.getElementById(box).innerHTML="<div class=\\"panel muted\\" style=\\"padding:24px;text-align:center\\">เปิดผ่าน Web App URL (/exec) เพื่อดูส่วนนี้</div>";return;}' +
    'google.script.run.withSuccessHandler(function(h){document.getElementById(box).innerHTML=h;makeSortable();buildTeamSels();buildExpTeams();}).withFailureHandler(function(e){LD[id]=0;document.getElementById(box).innerHTML="<div class=\\"panel\\">โหลดไม่ได้: "+e.message+"</div>";})[fn](ISO);}' +
    'function loadTT(){lazy("ttbox","rbTimetableHtml","tt");}function loadFlt(){lazy("fltbox","rbFlightsHtml","flt");}function loadOT(){}function loadAC(){lazy("acbox","rbAssignHtml","ac");}function loadSup(){lazy("supbox","rbSupportHtml","sup");}' +
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
    'function hm2m(s){var m=String(s).match(/(\\d{1,2}):(\\d{2})/);return m?(+m[1]*60+ +m[2]):null;}' +
    'function gapOverlap(raw,f,t){if(!raw)return false;return raw.split(",").some(function(seg){var p=seg.split("~");if(p.length<2)return false;var a=+p[0],b=+p[1];if(isNaN(a)||isNaN(b))return false;function ov(x,y){return x<t&&y>f;}a=((a%1440)+1440)%1440;b=((b%1440)+1440)%1440;if(b===0)b=1440;return a<=b?ov(a,b):(ov(a,1440)||ov(0,b));});}' +
    'function applyFilter(viewId){var v=document.getElementById(viewId);if(!v)return;var sb=v.querySelector(".search"),q=sb?sb.value.toLowerCase():"";var ts=v.querySelector(".teamsel"),team=ts?ts.value:"";var gf=v.querySelector(".gapfrom"),gt=v.querySelector(".gapto");var gfrom=gf&&gf.value?hm2m(gf.value):null,gto=gt&&gt.value?hm2m(gt.value):null;var gOn=(gfrom!=null||gto!=null),gLo=gfrom!=null?gfrom:0,gHi=gto!=null?gto:1440,visN=0;[].forEach.call(v.querySelectorAll("tbody tr"),function(r){var dt=r.getAttribute("data-team")||"";var okT=!team||dt===team||dt.split(",").indexOf(team)>=0;var okQ=!q||r.textContent.toLowerCase().indexOf(q)>=0;var okG=!gOn||gapOverlap(r.getAttribute("data-gaps")||"",gLo,gHi);var show=okT&&okQ&&okG;if(show&&r.getAttribute("data-gaps")!=null&&r.cells.length>1)visN++;r.style.display=show?"":"none";});var gc=v.querySelector(".gapcount");if(gc)gc.textContent=gOn?("· พบ "+visN+" คนว่างช่วงนี้"):"";}' +
    'function clearGap(viewId){var v=document.getElementById(viewId);if(!v)return;var gf=v.querySelector(".gapfrom"),gt=v.querySelector(".gapto");if(gf)gf.value="";if(gt)gt.value="";applyFilter(viewId);}' +
    'function buildExpTeams(){[].forEach.call(document.querySelectorAll("select.expteam"),function(sel){if(sel.options.length>1)return;var v=sel.closest("div[id^=view-]");if(!v)return;var set={};[].forEach.call(v.querySelectorAll(".supchip[data-pteam]"),function(c){var t=c.getAttribute("data-pteam");if(t)set[t]=1;});Object.keys(set).sort().forEach(function(t){var o=document.createElement("option");o.text=t;o.value=t;sel.add(o);});});}' +
    'function fillExport(){expRun("fill","apExportFill");}function autoExport(){expRun("auto","apExportAuto");}' +
    'function expRun(view,fn){var v=document.getElementById("view-"+view);if(!v)return;var sel=v.querySelector(".expteam"),team=sel?sel.value:"";var m=v.querySelector(".expmsg");if(!(window.google&&google.script&&google.script.run)){alert("เปิดผ่าน /exec เพื่อสร้างไฟล์");return;}if(m)m.innerHTML="⏳ กำลังสร้างไฟล์ชีต…";var ex=view==="fill"?JSON.stringify(window.__fillEx||{}):"";google.script.run.withSuccessHandler(function(url){if(m)m.innerHTML="📤 <a href=\\""+url+"\\" target=\\"_blank\\">เปิดไฟล์แจ้ง Assignment"+(team?" ("+team+")":"")+"</a>";}).withFailureHandler(function(e){if(m)m.innerHTML="";alert("สร้างไฟล์ไม่ได้: "+e.message);})[fn](ISO,team,ex);}' +
    'function fillAddExtra(){var f=document.getElementById("exflt"),p=document.getElementById("exph"),n=document.getElementById("exn");if(!f||!f.value){alert("เลือกไฟลท์ก่อน");return;}var num=Math.max(1,parseInt(n&&n.value||"1",10)||1);window.__fillEx=window.__fillEx||{};var e=window.__fillEx[f.value]=window.__fillEx[f.value]||{};e[p.value]=(parseInt(e[p.value]||0,10)||0)+num;fillRerun();}' +
    'function fillDropExtra(fl,ph){if(!window.__fillEx||!window.__fillEx[fl])return;delete window.__fillEx[fl][ph];var any=false;for(var k in window.__fillEx[fl])if(window.__fillEx[fl][k])any=true;if(!any)delete window.__fillEx[fl];fillRerun();}' +
    'function fillClearExtra(){window.__fillEx={};fillRerun();}' +
    'function fillRerun(){if(!(window.google&&google.script&&google.script.run)){alert("เปิดผ่าน /exec");return;}var v=document.getElementById("view-fill"),fcBy={};if(v)[].forEach.call(v.querySelectorAll(".fcpick"),function(s){fcBy[s.getAttribute("data-code")]=s.value;});document.getElementById("fillbox").innerHTML="<div class=\\"panel muted\\" style=\\"padding:20px;text-align:center\\">⏳ กำลังจัดคนเพิ่ม…</div>";google.script.run.withSuccessHandler(function(h){document.getElementById("fillbox").innerHTML=h;makeSortable();buildTeamSels();buildExpTeams();}).withFailureHandler(function(e){document.getElementById("fillbox").innerHTML="<div class=\\"panel\\">"+e.message+"</div>";}).rbFillPlanHtml(ISO,JSON.stringify(fcBy),JSON.stringify(window.__fillEx||{}));}' +
    'function fcPick(view){var v=document.getElementById("view-"+view);if(!v||!(window.google&&google.script&&google.script.run))return;var fcBy={};[].forEach.call(v.querySelectorAll(".fcpick"),function(s){fcBy[s.getAttribute("data-code")]=s.value;});var box=view+"box",fn=view==="auto"?"rbAutoAssignHtml":"rbFillPlanHtml";var ex=view==="fill"?JSON.stringify(window.__fillEx||{}):"";document.getElementById(box).innerHTML="<div class=\\"panel muted\\" style=\\"padding:20px;text-align:center\\">⏳ จัดใหม่ตาม Flight Controller…</div>";google.script.run.withSuccessHandler(function(h){document.getElementById(box).innerHTML=h;makeSortable();buildTeamSels();buildExpTeams();}).withFailureHandler(function(e){document.getElementById(box).innerHTML="<div class=\\"panel\\">"+e.message+"</div>";})[fn](ISO,JSON.stringify(fcBy),ex);}' +
    'function buildTeamSels(){[].forEach.call(document.querySelectorAll("select.teamsel"),function(sel){if(sel.options.length>1)return;var v=sel.closest("div[id^=view-]");if(!v)return;var set={};[].forEach.call(v.querySelectorAll("tbody tr[data-team]"),function(r){(r.getAttribute("data-team")||"").split(",").forEach(function(t){t=t.trim();if(t)set[t]=1;});});Object.keys(set).sort().forEach(function(t){var o=document.createElement("option");o.text=t;o.value=t;sel.add(o);});});}' +
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
@media print{.weeknav,.tabs,.btn,.ttbar{display:none}#view-tt,#view-flt,#view-dash{display:block!important}}
`;
