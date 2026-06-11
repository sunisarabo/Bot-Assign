/** OT Dashboard (รายทีม) — คำนวณสดจาก Assignment (เวรรายวัน) → สรุปต่อทีม × สัปดาห์/เดือน + baked fallback
 *  เดิมดึงจาก OT Yearly · ชีต5 (ยังเก็บ otReadSheet5_/otParseSheet5_ ไว้เป็น fallback)
 *  ใหม่: วนอ่านไฟล์เวรรายวันผ่าน rbOpenTodayRoster_ + readRosterFromSpreadsheet → OT/ทีม/วัน = otHours + otHolHrs
 *        เก็บผลต่อวันถาวรในชีตซ่อน OT_DASH_CACHE (1 แถว/วัน) แล้วทยอยคำนวณวันที่ยังไม่มี cache ทีละ budget */
var OT_YEARLY_ID = '1zESOKHDpNqbkXxd3YV0EqVHv6JDeyPjKKpjwJsOMVQ0';
var OT_CACHE_SHEET = 'OT_DASH_CACHE';
var OT_DASH_BUILD = '2026-06-11c';  // build marker — เช็คได้ว่าเวอร์ชันไหนขึ้นระบบจริง (otDashBuild())
var OT_MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function otDashBuild() { return OT_DASH_BUILD; }

/** แปลงค่าเวลา/ระยะเวลาในชีต → ชั่วโมง (ทศนิยม) */
function otHrs_(v) {
  if (v == null || v === '') return 0;
  if (Object.prototype.toString.call(v) === '[object Date]') return Math.round((v.getHours() + v.getMinutes() / 60) * 100) / 100;
  if (typeof v === 'number') return Math.round(v * 24 * 100) / 100;       // duration เก็บเป็นเศษวัน → ×24
  var s = String(v).trim(), m = s.match(/^(\d+):(\d{2})(?::\d{2})?$/);
  if (m) return Math.round((+m[1] + (+m[2]) / 60) * 100) / 100;
  var f = parseFloat(s.replace(/[^0-9.]/g, '')); return isNaN(f) ? 0 : f;
}
function otMonth_(h) { var m = String(h).match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i); return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() : ''; }

/** parse ชีต5: ส่วน "Team/Week" เป็นบล็อกต่อเดือนเรียงแนวนอน (team | 4 สัปดาห์ | รวม) */
function otParseSheet5_(data) {
  var hr = -1;
  for (var i = 0; i < Math.min(6, data.length); i++) { if (data[i].indexOf('Team/Week') >= 0) { hr = i; break; } }
  if (hr < 0) throw new Error('ไม่พบหัวตาราง Team/Week ใน ชีต5');
  var blocks = [];
  for (var c = 0; c < data[hr].length; c++) {
    if (String(data[hr][c]).trim() === 'Team/Week') {
      var wk = []; for (var k = 1; k <= 4; k++) wk.push(String(data[hr][c + k] == null ? '' : data[hr][c + k]).trim());
      blocks.push({ col: c, weeks: wk, month: otMonth_(wk[0]) });
    }
  }
  if (!blocks.length) throw new Error('ไม่พบบล็อกเดือนใน ชีต5');
  var teams = {}, order = [];
  for (var r = hr + 1; r < data.length; r++) {
    var first = String(data[r][blocks[0].col] == null ? '' : data[r][blocks[0].col]).trim();
    if (first === 'รวม' || first === 'Code / Week' || first === 'Code/Week' || !first) break;
    blocks.forEach(function (b) {
      var team = String(data[r][b.col] == null ? '' : data[r][b.col]).trim(); if (!team) return;
      if (!teams[team]) { teams[team] = { team: team, months: {}, total: 0 }; order.push(team); }
      var weeks = []; for (var k = 1; k <= 4; k++) weeks.push(otHrs_(data[r][b.col + k]));
      var tot = otHrs_(data[r][b.col + 5]);
      teams[team].months[b.month] = { weeks: weeks, total: tot };
      teams[team].total = Math.round((teams[team].total + tot) * 10) / 10;
    });
  }
  return { months: blocks.map(function (b) { return b.month; }), teams: order.map(function (t) { return teams[t]; }) };
}

function otReadSheet5_() {
  var id = (function () { try { var p = PropertiesService.getScriptProperties().getProperty('OT_YEARLY_ID'); return p || OT_YEARLY_ID; } catch (e) { return OT_YEARLY_ID; } })();
  var sh = SpreadsheetApp.openById(id).getSheetByName('ชีต5');
  if (!sh) throw new Error('ไม่พบแท็บ "ชีต5" ในไฟล์ OT Yearly');
  return otParseSheet5_(sh.getDataRange().getValues());
}

// ─── คำนวณ OT จาก Assignment (เวรรายวัน) ────────────────────────────────────
function otYearlyId_() {
  try { var p = PropertiesService.getScriptProperties().getProperty('OT_YEARLY_ID'); return p || OT_YEARLY_ID; }
  catch (e) { return OT_YEARLY_ID; }
}
function otDateKey_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone() || 'Asia/Bangkok', 'yyyy-MM-dd');
}
/** จุดเริ่มช่วงคำนวณ — override ได้ด้วย Script Property OT_DASH_START (YYYY-MM-DD) ค่าเริ่มต้น = 1 ม.ค. ปีนี้ */
function otRangeStart_(now) {
  try {
    var p = PropertiesService.getScriptProperties().getProperty('OT_DASH_START');
    var m = p && String(p).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  } catch (e) {}
  return new Date(now.getFullYear(), 0, 1);
}
/** จำนวนวัน (อดีต) สูงสุดที่จะคำนวณใหม่ต่อการเรียก live 1 ครั้ง — override ด้วย OT_DASH_BUDGET
 *  ค่าน้อยเพื่อให้หน้าเว็บตอบไว (ที่เหลือเติมเบื้องหลังด้วย otWarmCache/trigger) */
function otBudget_() {
  try { var p = parseInt(PropertiesService.getScriptProperties().getProperty('OT_DASH_BUDGET'), 10); if (p > 0) return p; }
  catch (e) {}
  return 12;
}
/** ตัด REV ออกจากชื่อแท็บทีม (ชื่อแท็บใน Assignment = ชื่อกลุ่มทีมอยู่แล้ว เช่น CHINA, QR/MH/OM/DE, PORTER) */
function otTeamName_(nm) {
  return String(nm).replace(/REV\.?\s*\d+\s*/ig, '').replace(/\s+/g, ' ').trim();
}

/** error ชั่วคราว (service timeout/quota/rate) → ควรลองใหม่ ไม่ใช่ cache เป็นว่าง */
function otTransient_(e) {
  return /timed?\s*out|timeout|too many|rate limit|quota|temporarily|try again|service error|internal error/i
    .test(String(e && (e.message || e)));
}
/** อ่านเวรของวันเดียว → {teamName: otHours} ; OT/ทีม = otHours + otHolHrs (รวม OT นักขัต X1)
 *  คืน {} = ไม่มีไฟล์/โครงสร้างผิด (cache กันลองซ้ำ) ; คืน null = error ชั่วคราว (อย่า cache, ลองใหม่รอบหน้า) */
function otComputeDay_(date) {
  var roster;
  try { roster = rbOpenTodayRoster_(date); }
  catch (e) { return otTransient_(e) ? null : {}; }          // ไม่พบไฟล์ → {} ; timeout → null
  if (!roster || !roster.ss) return {};
  var res = null, err = null;
  try { res = readRosterFromSpreadsheet(roster.ss, date); } catch (e2) { err = e2; }
  if (roster.tempId) { try { DriveApp.getFileById(roster.tempId).setTrashed(true); } catch (e3) {} }
  if (err) return otTransient_(err) ? null : {};
  if (!res || !res.teams) return {};
  var out = {};
  Object.keys(res.teams).forEach(function (t) {
    var b = res.teams[t];
    var hrs = Math.round(((b.otHours || 0) + (b.otHolHrs || 0)) * 10) / 10;
    if (hrs > 0) { var nm = otTeamName_(t); out[nm] = Math.round(((out[nm] || 0) + hrs) * 10) / 10; }
  });
  return out;
}

/** cache เก็บใน Script Properties (key = otc_YYYY-MM-DD, value = JSON {team:hrs})
 *  เร็ว ไม่ต้องเปิด spreadsheet ใดๆ — เลิกพึ่งไฟล์ OT Yearly ที่หนัก/timeout */
var OT_CACHE_PREFIX = 'otc_';
function otCacheLoad_() {
  var all = {};
  try { all = PropertiesService.getScriptProperties().getProperties() || {}; } catch (e) {}
  var map = {};
  Object.keys(all).forEach(function (k) {
    if (k.indexOf(OT_CACHE_PREFIX) !== 0) return;
    var key = k.slice(OT_CACHE_PREFIX.length);
    try { map[key] = JSON.parse(all[k]) || {}; } catch (e2) { map[key] = {}; }
  });
  return map;
}

/** วนช่วงวัน start→end : ใช้ cache ถ้ามี, ไม่งั้นคำนวณ (จำกัด budget + deadline) ; วันนี้คำนวณสดเสมอ
 *  - เขียน cache ลง Properties ทีละ 8 วัน → ถ้า service timeout กลางคัน ผลที่ทำแล้วไม่หาย (resumable จริง)
 *  - otComputeDay_ คืน null = error ชั่วคราว → นับเป็น pending ไม่ cache ว่าง
 *  คืน { days:[{date,teams}], pending } */
function otComputeRange_(start, end, budget, deadline) {
  var props = PropertiesService.getScriptProperties();
  var map = otCacheLoad_();
  var todayKey = otDateKey_(new Date());
  var batch = {}, batchN = 0, days = [], pending = 0, computed = 0;
  function flush() { if (batchN) { try { props.setProperties(batch, false); } catch (e) {} batch = {}; batchN = 0; } }
  var d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  var endT = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  while (d.getTime() <= endT) {
    var key = otDateKey_(d), isToday = (key === todayKey), teams = null;
    if (map.hasOwnProperty(key) && !isToday) {
      teams = map[key];
    } else if (isToday || (computed < budget && Date.now() < deadline)) {
      if (!isToday) computed++;
      teams = otComputeDay_(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
      if (teams === null) {                                   // error ชั่วคราว → ลองใหม่รอบหน้า
        pending++;
      } else {
        map[key] = teams; batch[OT_CACHE_PREFIX + key] = JSON.stringify(teams);
        if (++batchN >= 8) flush();                            // flush ระหว่างทาง
      }
    } else {
      pending++;
    }
    if (teams && Object.keys(teams).length) days.push({ date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), teams: teams });
    d.setDate(d.getDate() + 1);
  }
  flush();
  return { days: days, pending: pending };
}

/** รวมผลรายวัน → โครงสร้างเดียวกับ ชีต5 เดิม: { months:['Jan'..], teams:[{team,total,months:{m:{weeks:[4],total}}}] }
 *  สัปดาห์: 1-7, 8-14, 15-21, 22-สิ้นเดือน (index 0-3) */
function otAggregate_(days) {
  var teamMap = {}, order = [], monthsSet = [];
  days.forEach(function (rec) {
    var dt = rec.date, mAbbr = OT_MONTH_ABBR[dt.getMonth()], wkIdx = Math.min(3, Math.floor((dt.getDate() - 1) / 7));
    if (monthsSet.indexOf(mAbbr) < 0) monthsSet.push(mAbbr);
    Object.keys(rec.teams).forEach(function (team) {
      var hrs = rec.teams[team]; if (!(hrs > 0)) return;
      if (!teamMap[team]) { teamMap[team] = { team: team, total: 0, months: {} }; order.push(team); }
      var T = teamMap[team];
      if (!T.months[mAbbr]) T.months[mAbbr] = { weeks: [0, 0, 0, 0], total: 0 };
      T.months[mAbbr].weeks[wkIdx] = Math.round((T.months[mAbbr].weeks[wkIdx] + hrs) * 10) / 10;
      T.months[mAbbr].total = Math.round((T.months[mAbbr].total + hrs) * 10) / 10;
      T.total = Math.round((T.total + hrs) * 10) / 10;
    });
  });
  monthsSet.sort(function (a, b) { return OT_MONTH_ABBR.indexOf(a) - OT_MONTH_ABBR.indexOf(b); });
  var teams = order.map(function (t) { return teamMap[t]; }).sort(function (a, b) { return b.total - a.total; });
  return { months: monthsSet, teams: teams };
}

/** เรียกจาก client (google.script.run) — คืน OT รายทีมสด คำนวณจาก Assignment (ทยอยเติม cache) */
function otLiveData() {
  try {
    var now = new Date();
    var r = otComputeRange_(otRangeStart_(now), now, otBudget_(), Date.now() + 150000);
    var agg = otAggregate_(r.days);
    return { ok: true, months: agg.months, teams: agg.teams, pending: r.pending, source: 'assignment' };
  } catch (e) { return { ok: false, err: String(e && e.message || e) }; }
}

/** อุ่น cache ทีละชุด (≤24 วัน/รอบ, ตัดที่ 4 นาที กัน service timeout) แล้วตั้ง trigger ทำต่อเองทุก 10 นาที
 *  จนกว่า pending=0 จึงลบ trigger ทิ้ง — เรียกครั้งเดียวจาก editor พอ (resumable เต็มรูปแบบ) */
function otWarmCache() {
  var now = new Date();
  var r = otComputeRange_(otRangeStart_(now), now, 24, Date.now() + 240000);
  Logger.log('otWarmCache: คำนวณรอบนี้เสร็จ, เหลือค้าง pending=%s วัน', r.pending);
  if (r.pending > 0) otEnsureWarmTrigger_(); else { otRemoveWarmTriggers_(); Logger.log('otWarmCache: cache ครบแล้ว ✅ ลบ trigger ทิ้ง'); }
  return r.pending;
}
function otEnsureWarmTrigger_() {
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'otWarmCache'; });
  if (!has) ScriptApp.newTrigger('otWarmCache').timeBased().everyMinutes(10).create();
}
function otRemoveWarmTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'otWarmCache') ScriptApp.deleteTrigger(t);
  });
}
/** สั่งหยุดการอุ่น cache อัตโนมัติ (ลบ trigger) */
function otStopWarmCache() { otRemoveWarmTriggers_(); Logger.log('หยุด trigger otWarmCache แล้ว'); }
/** ล้าง cache OT ทั้งหมด (otc_*) — ใช้เมื่อต้องการคำนวณใหม่ทั้งหมด */
function otClearCache() {
  var props = PropertiesService.getScriptProperties(), all = props.getProperties() || {}, n = 0;
  Object.keys(all).forEach(function (k) { if (k.indexOf(OT_CACHE_PREFIX) === 0) { props.deleteProperty(k); n++; } });
  Logger.log('otClearCache: ลบ cache %s วัน', n);
  return n;
}

function otDashData_() { return {"months":["(สะสม)"],"teams":[{"team":"CHINA","total":3876.0,"months":{"(สะสม)":{"weeks":[],"total":3876.0}}},{"team":"QR/MH/OM/DE","total":3873.5,"months":{"(สะสม)":{"weeks":[],"total":3873.5}}},{"team":"SQ/CX/LY","total":1914.5,"months":{"(สะสม)":{"weeks":[],"total":1914.5}}},{"team":"JQ/IT/IX/AI/N0","total":1434.5,"months":{"(สะสม)":{"weeks":[],"total":1434.5}}},{"team":"EY/AY/DV","total":1367.5,"months":{"(สะสม)":{"weeks":[],"total":1367.5}}},{"team":"WY/G9/9C/DK","total":964.0,"months":{"(สะสม)":{"weeks":[],"total":964.0}}},{"team":"TK/VJ/SG/HY/OD","total":641.0,"months":{"(สะสม)":{"weeks":[],"total":641.0}}},{"team":"SV/WK/KA","total":462.5,"months":{"(สะสม)":{"weeks":[],"total":462.5}}},{"team":"PORTER","total":146.5,"months":{"(สะสม)":{"weeks":[],"total":146.5}}}]}; }
function otDashCss_() { return OT_DASH_CSS_; }
function otDashHtml_() { return OT_DASH_HTML_; }
function otDashScript_() {
  return '<scr' + 'ipt>(function(){var BAKED=' + JSON.stringify(otDashData_()) + ';' + OT_DASH_JS_ + '})();</scr' + 'ipt>';
}
var OT_DASH_HTML_ = `<div class="ot-head"><div><div class="ot-title">OT <span>Dashboard</span> · รายทีม</div><div class="ot-sub">แผนก การโดยสาร · คำนวณจาก Assignment (เวรรายวัน)</div></div><div class="ot-badge">ระบบติดตาม OT</div></div><div class="ot-subtabs"><div class="ot-subtab tab active" data-t="monthly" onclick="otSwitchTab('monthly')">📆 รายเดือน</div><div class="ot-subtab tab" data-t="weekly" onclick="otSwitchTab('weekly')">📅 รายสัปดาห์</div></div><div id="ot-tab-monthly" class="tab-panel active"></div><div id="ot-tab-weekly" class="tab-panel"></div>`;
var OT_DASH_CSS_ = `#view-ot{--surface:#fff;--surface2:#eef3f9;--border:#dbe3ee;--accent:#f97316;--accent2:#3b82f6;--accent3:#0891b2;--danger:#ef4444;--warn:#d97706;--ok:#16a34a;--text:#1f2d3d;--muted:#73839a;color:var(--text)}
#view-ot .ot-head{display:flex;align-items:center;justify-content:space-between;background:linear-gradient(135deg,#eef3fb,#f6f0ff);border:1px solid var(--border);border-radius:12px;padding:16px 20px;margin-bottom:14px}
#view-ot .ot-title{font-size:20px;font-weight:800;letter-spacing:-.3px}
#view-ot .ot-title span{color:var(--accent)}
#view-ot .ot-sub{font-size:12px;color:var(--muted);margin-top:2px}
#view-ot .ot-badge{background:var(--accent);color:#fff;border-radius:20px;padding:5px 14px;font-size:12px;font-weight:700;letter-spacing:.5px}
#view-ot .ot-subtabs{display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:18px}
#view-ot .tab{padding:9px 22px;cursor:pointer;border-radius:8px 8px 0 0;font-weight:600;font-size:14px;border:1px solid transparent;border-bottom:none;color:var(--muted)}
#view-ot .tab.active{background:var(--surface);border-color:var(--border);color:var(--text)}
#view-ot .tab:hover:not(.active){color:var(--text);background:var(--surface2)}
#view-ot .tab-panel{display:none}
#view-ot .tab-panel.active{display:block}
#view-ot .info-panel{background:linear-gradient(135deg,rgba(249,115,22,.08),rgba(59,130,246,.06));border:1px solid rgba(249,115,22,.25);border-radius:10px;padding:12px 18px;margin-bottom:18px;display:flex;gap:24px;flex-wrap:wrap}
#view-ot .info-item{font-size:12px;color:var(--muted)}
#view-ot .info-item strong{color:var(--accent);font-size:14px}
#view-ot .stat-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:26px}
#view-ot .stat-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px 18px;position:relative;overflow:hidden;box-shadow:0 1px 4px rgba(20,40,80,.05)}
#view-ot .stat-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:var(--accent-color,var(--accent))}
#view-ot .stat-label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;margin-bottom:7px}
#view-ot .stat-val{font-size:26px;font-weight:800;color:var(--accent-color,var(--text))}
#view-ot .stat-sub{font-size:11px;color:var(--muted);margin-top:4px}
#view-ot .section{margin-bottom:28px}
#view-ot .section-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
#view-ot .section-title{font-size:15px;font-weight:700;display:flex;align-items:center;gap:8px}
#view-ot .dot{width:8px;height:8px;border-radius:50%;background:var(--accent);display:inline-block}
#view-ot .bar-chart{display:flex;flex-direction:column;gap:7px}
#view-ot .bar-row{display:flex;align-items:center;gap:10px}
#view-ot .bar-label{width:150px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0}
#view-ot .bar-track{flex:1;background:var(--surface2);border-radius:4px;height:22px;position:relative;overflow:hidden}
#view-ot .bar-fill{height:100%;border-radius:4px;background:var(--fill-color,var(--accent));transition:width .6s cubic-bezier(.25,.8,.25,1);display:flex;align-items:center;justify-content:flex-end;padding-right:8px;font-size:11px;font-weight:700;color:#fff;white-space:nowrap;min-width:40px}
#view-ot .bar-extra{width:78px;text-align:right;font-size:11px;color:var(--muted);flex-shrink:0}
#view-ot .filter-row{display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap;align-items:center}
#view-ot .search-box{background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:8px 14px;font-size:14px;outline:none;flex:1;min-width:200px}
#view-ot .search-box:focus{border-color:var(--accent)}
#view-ot .filter-select{background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:8px 12px;font-size:14px;outline:none;cursor:pointer;min-width:170px}
#view-ot .result-count{font-size:12px;color:var(--muted)}
#view-ot .emp-table-wrap{overflow-x:auto;background:var(--surface);border:1px solid var(--border);border-radius:12px}
#view-ot table{width:100%;border-collapse:collapse;font-size:13px}
#view-ot thead tr{background:var(--surface2)}
#view-ot th{padding:10px 14px;text-align:left;font-size:11px;letter-spacing:.4px;color:var(--muted);text-transform:uppercase;white-space:nowrap;cursor:pointer;user-select:none}
#view-ot th:hover{color:var(--text)}
#view-ot th.sorted{color:var(--accent)}
#view-ot th .sort-icon{margin-left:4px;opacity:.5}
#view-ot th.sorted .sort-icon{opacity:1}
#view-ot tbody tr{border-top:1px solid var(--border);cursor:pointer;transition:background .15s}
#view-ot tbody tr:hover{background:var(--surface2)}
#view-ot tbody tr.expanded{background:var(--surface2)}
#view-ot td{padding:9px 14px}
#view-ot .ot-code{color:var(--muted);font-size:11px;font-family:ui-monospace,monospace}
#view-ot .mono{font-family:ui-monospace,monospace;font-size:13px}
#view-ot .badge-repeat{display:inline-block;background:var(--danger);color:#fff;border-radius:20px;padding:2px 10px;font-weight:700;font-size:12px}
#view-ot .badge-repeat.mid{background:var(--warn)}
#view-ot .badge-repeat.low{background:var(--ok)}
#view-ot .badge-hours{display:inline-block;background:rgba(59,130,246,.13);color:var(--accent2);border-radius:6px;padding:2px 8px;font-weight:700;font-size:12px}
#view-ot .team-tag{display:inline-block;border-radius:4px;padding:1px 7px;font-size:11px}
#view-ot .expand-row{display:none}
#view-ot .expand-row.visible{display:table-row}
#view-ot .expand-row td{padding:0}
#view-ot .expand-inner{background:#f3f8ff;border-left:3px solid var(--accent);padding:12px 18px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
#view-ot .detail-chip{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:5px 12px;font-size:12px}
#view-ot .detail-chip span{color:var(--accent);font-weight:700}
#view-ot .detail-chip .ot-over{color:var(--danger);font-size:10px;font-weight:600}
#view-ot .detail-label{font-size:11px;color:var(--muted);margin-right:8px}
#view-ot .chevron{display:inline-block;transition:transform .2s;color:var(--muted);font-size:16px}
#view-ot .chevron.open{transform:rotate(90deg);color:var(--accent)}
#view-ot .empty-state{text-align:center;padding:34px;color:var(--muted)}
@media(max-width:600px){#view-ot .stat-row{grid-template-columns:1fr 1fr}#view-ot .bar-label{width:96px}}
#view-ot .ot-live{background:rgba(22,163,74,.12);color:#16a34a;border-radius:6px;padding:2px 10px;font-weight:700;font-size:12px}
#view-ot .ot-baked{background:rgba(115,131,154,.12);color:#73839a;border-radius:6px;padding:2px 10px;font-weight:700;font-size:12px}`;
var OT_DASH_JS_ = `function fmt(v){return Number(v).toLocaleString('th-TH',{maximumFractionDigits:1});}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
var COLORS=['#f97316','#3b82f6','#0891b2','#a855f7','#16a34a','#ec4899','#f59e0b','#14b8a6','#ef4444','#6366f1','#84cc16','#06b6d4','#e879f9','#fb7185','#fbbf24','#4ade80','#818cf8','#7c3aed','#2dd4bf','#f43f5e'];
var MTH={Jan:'ม.ค.',Feb:'ก.พ.',Mar:'มี.ค.',Apr:'เม.ย.',May:'พ.ค.',Jun:'มิ.ย.',Jul:'ก.ค.',Aug:'ส.ค.',Sep:'ก.ย.',Oct:'ต.ค.',Nov:'พ.ย.',Dec:'ธ.ค.'};
var DATA=BAKED, LIVE=false, selMonth='';
function thM(m){return MTH[m]||m;}
function tcol(team){var i=DATA.teams.map(function(t){return t.team;}).indexOf(team);return COLORS[(i<0?0:i)%COLORS.length];}
function card(c,l,v,s){return '<div class="stat-card" style="--accent-color:'+c+'"><div class="stat-label">'+l+'</div><div class="stat-val">'+v+'</div><div class="stat-sub">'+esc(s)+'</div></div>';}
function section(title,body){return '<div class="section"><div class="section-header"><div class="section-title"><span class="dot"></span> '+title+'</div></div>'+body+'</div>';}
function srcBadge(){if(LIVE){var p=window.__otPending||0;return p>0?'<span class="ot-live">🟢 สดจาก Assignment · กำลังประมวลผลอีก '+p+' วัน…</span>':'<span class="ot-live">🟢 สดจาก Assignment</span>';}return '<span class="ot-baked">● ข้อมูลสำรอง (ยังไม่เชื่อมสด)</span>';}
function infoP(type){var crit=type==='weekly'?'รายสัปดาห์ (1-7, 8-14, 15-21, 22-สิ้นเดือน)':'รายเดือน (รวมทั้งเดือน)';return '<div class="info-panel"><div class="info-item">มุมมอง: <strong>'+crit+'</strong></div><div class="info-item">แหล่งข้อมูล: <strong>Assignment · เวรรายวัน</strong></div><div class="info-item">'+srcBadge()+'</div></div>';}
function bars(items){var mx=Math.max.apply(null,items.map(function(t){return t.v;}).concat([1]));return '<div class="bar-chart">'+items.slice().sort(function(a,b){return b.v-a.v;}).map(function(t){var pct=(t.v/mx*100).toFixed(1),col=tcol(t.team);return '<div class="bar-row"><div class="bar-label" title="'+esc(t.team)+'">'+esc(t.team)+'</div><div class="bar-track"><div class="bar-fill" style="width:'+pct+'%;--fill-color:'+col+'">'+fmt(t.v)+' ชม.</div></div></div>';}).join('')+'</div>';}
function buildMonthly(){
  var teams=DATA.teams,months=DATA.months;
  var grand=teams.reduce(function(a,t){return a+t.total;},0);
  var top=teams.slice().sort(function(a,b){return b.total-a.total;})[0]||{team:'-',total:0};
  var cards='<div class="stat-row">'+card('#f97316','OT รวมทั้งหมด',fmt(grand),'ชม. (ทุกทีม ทุกเดือน)')+card('#3b82f6','จำนวนทีม',teams.length,'ทีมที่มี OT')+card('#a855f7','จำนวนเดือน',months.length,months.map(thM).join(' '))+card('#ef4444','ทีมสูงสุด',fmt(top.total),top.team)+'</div>';
  var bar=bars(teams.map(function(t){return {team:t.team,v:t.total};}));
  var thm=months.map(function(m){return '<th>'+thM(m)+'</th>';}).join('');
  var trs=teams.slice().sort(function(a,b){return b.total-a.total;}).map(function(t){var tds=months.map(function(m){var mm=t.months[m];return '<td class="mono">'+(mm&&mm.total?fmt(mm.total):'·')+'</td>';}).join('');return '<tr><td class="b" style="border-left:3px solid '+tcol(t.team)+'">'+esc(t.team)+'</td>'+tds+'<td class="mono b">'+fmt(t.total)+'</td></tr>';}).join('');
  var table='<div class="emp-table-wrap"><table><thead><tr><th>ทีม</th>'+thm+'<th>รวม</th></tr></thead><tbody>'+(trs||'<tr><td colspan="9" class="empty-state">ไม่มีข้อมูล</td></tr>')+'</tbody></table></div>';
  document.getElementById('ot-tab-monthly').innerHTML=infoP('monthly')+cards+section('OT รวมรายทีม (ทั้งช่วง)',bar)+section('ตาราง OT · ทีม × เดือน (ชม.)',table);
}
function buildWeekly(){
  var teams=DATA.teams,months=DATA.months;
  if(!selMonth||months.indexOf(selMonth)<0)selMonth=months[months.length-1]||'';
  var sel='<select class="filter-select" onchange="otSelMonth(this.value)">'+months.map(function(m){return '<option value="'+m+'"'+(m===selMonth?' selected':'')+'>'+thM(m)+'</option>';}).join('')+'</select>';
  var wk=teams.map(function(t){var mm=t.months[selMonth];return {team:t.team,weeks:mm?mm.weeks:[0,0,0,0],total:mm?mm.total:0};}).filter(function(x){return x.total>0;}).sort(function(a,b){return b.total-a.total;});
  var trs=wk.map(function(t){var tds=(t.weeks||[]).map(function(w){return '<td class="mono">'+(w?fmt(w):'·')+'</td>';}).join('');return '<tr><td class="b" style="border-left:3px solid '+tcol(t.team)+'">'+esc(t.team)+'</td>'+tds+'<td class="mono b">'+fmt(t.total)+'</td></tr>';}).join('');
  var table='<div class="emp-table-wrap"><table><thead><tr><th>ทีม</th><th>1-7</th><th>8-14</th><th>15-21</th><th>22-สิ้นเดือน</th><th>รวม</th></tr></thead><tbody>'+(trs||'<tr><td colspan="6" class="empty-state">ไม่มีข้อมูลเดือนนี้</td></tr>')+'</tbody></table></div>';
  var bar=bars(wk.map(function(t){return {team:t.team,v:t.total};}));
  document.getElementById('ot-tab-weekly').innerHTML=infoP('weekly')+'<div class="filter-row"><span style="font-size:13px;color:var(--muted)">เลือกเดือน:</span>'+sel+'</div>'+section('OT รายทีม · เดือน '+thM(selMonth),bar)+section('ตาราง OT · ทีม × สัปดาห์ ('+thM(selMonth)+')',table);
}
function render(){buildMonthly();buildWeekly();}
window.otSelMonth=function(m){selMonth=m;buildWeekly();};
window.otSwitchTab=function(tab){var root=document.getElementById('view-ot');if(!root)return;[].forEach.call(root.querySelectorAll('.ot-subtab'),function(t){t.classList.toggle('active',t.getAttribute('data-t')===tab);});[].forEach.call(root.querySelectorAll('.tab-panel'),function(p){p.classList.remove('active');});var el=document.getElementById('ot-tab-'+tab);if(el)el.classList.add('active');};
function otFetch(){if(!(window.google&&google.script&&google.script.run))return;google.script.run.withSuccessHandler(function(d){if(d&&d.ok){if(d.teams&&d.teams.length)DATA=d;LIVE=true;window.__otPending=d.pending||0;render();if(d.pending>0&&(window.__otTries=(window.__otTries||0)+1)<80)setTimeout(otFetch,400);}}).withFailureHandler(function(){}).otLiveData();}
function otInit(){if(!document.getElementById('ot-tab-weekly')||window.__otBuilt)return;window.__otBuilt=1;render();otFetch();}
if(document.readyState!=='loading')otInit();else window.addEventListener('load',otInit);
`;
