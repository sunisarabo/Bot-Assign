/**
 * WorkHours.gs — ชั่วโมงทำงานรายสัปดาห์จาก ROSTER รายเดือน (ระเบียบ AOTGA)
 * กฎ: กะ 7-12 ชม./วัน · รวมเวลางาน ≤48 ชม./สัปดาห์ · วันทำงาน ≤7 วัน/สัปดาห์
 * อ่านชีต "Code กะงาน" (รหัสกะ+สถานะวัน ของทุกคน ทุกวันในเดือน)
 *
 * รองรับเดือนถัดๆไป: ตั้ง Script Property 'PWMS_ROSTER_IDS' = {"2026-06":"<id>","2026-07":"<id>"}
 * (ไม่ตั้ง → ใช้ PWMS_ROSTER_ID ค่าเริ่มต้น)
 */
var PWMS_ROSTER_ID = '1varvj0xmFPbyB7zMYCisTDOwmYGcWAoKHPVkIuC_9I0';   // ROSTER default (Google Sheet) — มิ.ย. 2026
// map เดือน→ไฟล์ ROSTER (ฝังในโค้ด · เพิ่มเดือนใหม่ที่นี่ได้เลย ไม่ต้องตั้ง Script Property) · Script Property 'PWMS_ROSTER_IDS' override ได้
var PWMS_ROSTER_MAP = {
  '2026-06': '1varvj0xmFPbyB7zMYCisTDOwmYGcWAoKHPVkIuC_9I0',   // 6. ROSTER JUNE 2026
  '2026-07': '1t6PSv0IdDRPvoTjAdYygtC4iC-OkHNkM0WkX9IKsTGs'    // 7. ROSTER JULY 2026
};
var WH_WEEK_MAXHR = 48, WH_WEEK_MAXDAY = 7;                            // เพดานรายสัปดาห์ (48 ชม. / 7 วัน)
var WH_WEEK_MAXOT = 36;                                                // เพดาน OT รายสัปดาห์ (ชม.) — ตามระเบียบแรงงาน

/** ไฟล์ roster ของเดือนที่มี iso นั้น: Script Property map → map ในโค้ด → default */
function whRosterIdFor_(iso) {
  var ym = String(iso).slice(0, 7);
  try { var m = JSON.parse(PropertiesService.getScriptProperties().getProperty('PWMS_ROSTER_IDS') || '{}'); if (m[ym]) return m[ym]; } catch (e) {}
  if (PWMS_ROSTER_MAP[ym]) return PWMS_ROSTER_MAP[ym];
  try { return PropertiesService.getScriptProperties().getProperty('PWMS_ROSTER_ID') || PWMS_ROSTER_ID; } catch (e2) { return PWMS_ROSTER_ID; }
}
/** รหัสกะ → ชั่วโมง (ตัวเลขท้ายรหัส เช่น H12=12, F9=9 · OPS=8 · OFF/ว่าง=0) */
function whShiftHours_(code) {
  var c = String(code == null ? '' : code).trim().toUpperCase();
  if (!c || c === 'OFF' || c === 'X' || c === '-') return 0;
  if (c === 'OPS') return 8;
  var m = c.match(/(\d{1,2})/);
  return m ? +m[1] : 0;
}
/** สถานะวัน = วันทำงานไหม (00-วันทำงาน) · 01/03 = วันหยุด */
function whIsWork_(stat) { var s = String(stat == null ? '' : stat); return s.indexOf('00') >= 0 || s.indexOf('วันทำงาน') >= 0; }
/** เลขสัปดาห์ ISO ("yyyy-Www") ของวัน iso */
function whIsoWeek_(iso) {
  var p = String(iso).split('-'); var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  var day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day + 3);
  var firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  var wk = 1 + Math.round(((d - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return d.getUTCFullYear() + '-W' + ('0' + wk).slice(-2);
}

/** อ่าน roster เดือนของ iso → { ym, byId:{ id:{name, days:[{iso,code,hours,work}]} } } · cache 6 ชม. */
function whLoadMonth_(iso) {
  var ym = String(iso).slice(0, 7), ck = 'whroster3_' + ym;   // bump คีย์ → ทิ้ง cache เก่าที่เก็บข้อมูลเดือนผิดไว้
  var hit = rbCacheGetBig_(ck); if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var id = whRosterIdFor_(iso); if (!id) return null;
  var ss; try { ss = SpreadsheetApp.openById(id); } catch (e2) { return null; }
  var sh = ss.getSheetByName('Code กะงาน') || ss.getSheetByName('Code กะ') || ss.getSheets()[0];
  var data = sh.getDataRange().getValues();
  var tz = Session.getScriptTimeZone() || 'Asia/Bangkok';
  var hdrRow = -1, dateCols = [];
  for (var r = 0; r < Math.min(6, data.length); r++) {
    var dc = [];
    for (var c = 2; c < data[r].length; c++) {
      var v = data[r][c];
      if (v && Object.prototype.toString.call(v) === '[object Date]') dc.push({ col: c, iso: Utilities.formatDate(v, tz, 'yyyy-MM-dd') });
    }
    if (dc.length) { hdrRow = r; dateCols = dc; break; }
  }
  if (hdrRow < 0) return null;
  var byId = {};
  for (var rr = hdrRow + 1; rr < data.length; rr++) {
    var row = data[rr];
    var idd = String(row[0] == null ? '' : row[0]).replace(/\.0+$/, '').replace(/\D/g, '');
    var nm = String(row[1] == null ? '' : row[1]).trim();
    if (idd.length < 6 || idd.length > 8 || !nm) continue;
    // จับคู่ (รหัสกะ, สถานะ) จาก "เซลล์สถานะ" (ขึ้นต้น NN-วัน... / มีคำว่า วันทำงาน|วันหยุด) แล้วรหัสกะ = เซลล์ก่อนหน้า
    // → ทนต่อคอลัมน์ ID/ชื่อ ที่แทรกซ้ำกลางแถว (ไฟล์ ROSTER บางเดือน) ที่ทำให้อ่านตามตำแหน่งเพี้ยน
    var pairs = [];
    for (var c = 2; c < row.length; c++) {
      var ss = String(row[c] == null ? '' : row[c]);
      if (/\d\d\s*-\s*วัน|วันทำงาน|วันหยุด/.test(ss)) pairs.push({ code: row[c - 1], stat: ss });
    }
    var days = [];
    if (pairs.length === dateCols.length) {                 // จำนวนสถานะตรงกับจำนวนวันในหัว → ใช้การจับคู่ (ทนคอลัมน์แทรก)
      dateCols.forEach(function (d, i) { var p = pairs[i]; days.push({ iso: d.iso, code: String(p.code == null ? '' : p.code).trim(), hours: whShiftHours_(p.code), work: whIsWork_(p.stat) }); });
    } else {                                                // ไม่ตรง → กลับไปอ่านตามตำแหน่งคอลัมน์เดิม
      dateCols.forEach(function (d) { var code = row[d.col], stat = row[d.col + 1]; days.push({ iso: d.iso, code: String(code == null ? '' : code).trim(), hours: whShiftHours_(code), work: whIsWork_(stat) }); });
    }
    byId[idd] = { name: nm, days: days };
  }
  var fileYm = (dateCols[0] && String(dateCols[0].iso).slice(0, 7)) || ym;   // เดือนจริงของไฟล์ที่โหลดมา (กันไฟล์คนละเดือน)
  var out = { ym: ym, fileYm: fileYm, byId: byId };
  try { rbCachePutBig_(ck, JSON.stringify(out), 21600); } catch (e3) {}
  return out;
}

/** สถานะรายสัปดาห์ของพนักงาน id · estPerDay = ชม.กะวันที่เลือก (ใช้ประมาณวันที่ ROSTER ไม่มีรหัส) */
function whWeekStat_(iso, id, estPerDay) {
  var R = whLoadMonth_(iso); if (!R) return null;
  var p = R.byId[String(id == null ? '' : id).replace(/\D/g, '')]; if (!p) return null;
  var wk = whIsoWeek_(iso), hours = 0, days = 0, nocode = 0, est = 0;
  p.days.forEach(function (d) {
    if (d.work && whIsoWeek_(d.iso) === wk) {
      days++;
      if (d.hours > 0) hours += d.hours;
      else { nocode++; if (estPerDay > 0) est += estPerDay; }   // วันทำงานที่ ROSTER ไม่มีรหัสกะ → ประมาณจากกะวันที่เลือก
    }
  });
  hours = Math.round(hours * 10) / 10; est = Math.round(est * 10) / 10;
  var total = Math.round((hours + est) * 10) / 10, incomplete = nocode > 0;
  var over48 = total > WH_WEEK_MAXHR, over6 = days > WH_WEEK_MAXDAY;
  return { hours: hours, est: est, total: total, days: days, nocode: nocode, incomplete: incomplete,
           over48: over48, over6: over6, level: (over48 || over6) ? 'over' : (incomplete ? 'incomplete' : 'ok') };
}

/** 7 วัน (จ.-อา.) ของสัปดาห์ ISO ที่ iso อยู่ */
function whWeekDates_(iso) {
  var p = String(iso).split('-'); var d = new Date(+p[0], +p[1] - 1, +p[2]);
  var day = (d.getDay() + 6) % 7;                                     // 0 = จันทร์
  var mon = new Date(d); mon.setDate(d.getDate() - day);
  var out = []; for (var i = 0; i < 7; i++) { var x = new Date(mon); x.setDate(mon.getDate() + i); out.push(x); }
  return out;
}
/** สถิติรายสัปดาห์รายคน จาก "ไฟล์ Assignment รายวัน" ของสัปดาห์นั้น → { nDays, byId:{ id:{hours,days,ot} } }
 *  ชม.กะ+วัน+OT ทั้งหมดมาจากไฟล์เวรจริง (ไม่ต้องพึ่งไฟล์ ROSTER รายเดือน) · cache 1 ชม. · ข้ามวันอนาคต/ไฟล์ที่เปิดไม่ได้ */
function whWeekStatsFromAssign_(iso) {
  var wk = whIsoWeek_(iso), ck = 'whwk2_' + wk;
  var hit = rbCacheGetBig_(ck); if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var map = {}, now = new Date(), nDays = 0;
  whWeekDates_(iso).forEach(function (dt) {
    if (dt.getTime() > now.getTime() + 43200000) return;              // วันอนาคต → ยังไม่มีไฟล์เวร
    var dd; try { dd = rbLoadResLL_(dt); } catch (e) { return; }
    nDays++;
    var seenDay = {};
    function add(rec) {
      var id = String(rec.id || '').replace(/\D/g, ''); if (id.length < 6 || seenDay[id]) return; seenDay[id] = 1;
      var m = map[id] || (map[id] = { hours: 0, days: 0, ot: 0 });
      if (rec.bucket === 'working' || rec.bucket === 'ot_off') { m.days++; m.hours += (+rec.shiftHrs || 0); }   // มาทำงานจริงวันนั้น
      var ot = +rec.ot || 0; if (ot > 0) m.ot += ot;
    }
    try { Object.keys(dd.res.teams).forEach(function (t) { dd.res.teams[t].records.forEach(add); }); } catch (e2) {}
    try { if (dd.ll && dd.ll.totals && dd.ll.totals.staff > 0) Object.keys(dd.ll.sections).forEach(function (s) { dd.ll.sections[s].records.forEach(add); }); } catch (e3) {}
  });
  Object.keys(map).forEach(function (id) { var m = map[id]; m.hours = Math.round(m.hours * 10) / 10; m.ot = Math.round(m.ot * 10) / 10; });
  var out = { nDays: nDays, byId: map };
  try { rbCachePutBig_(ck, JSON.stringify(out), 3600); } catch (e4) {}
  return out;
}
/** Lazy tab: ⏱️ ชั่วโมง/สัปดาห์ — รายคน (สัปดาห์ของวันที่เลือก) + เตือนเกิน 48ช/7วัน + OT เกิน 36ช */
function rbWeekHoursHtml(iso) {
  try {
    var wk = whIsoWeek_(iso);
    var d = rbLoadResLL_(rbDateFromIso_(iso));
    var W = whWeekStatsFromAssign_(iso), stats = W.byId || {};          // ชม.กะ+วัน+OT จากไฟล์เวรรายวันของสัปดาห์
    var rows = [], overN = 0, otOverN = 0, seen = {};
    function collect(team, r) {
      var idd = String(r.id || '').replace(/\D/g, ''); if (idd.length < 6 || seen[idd]) return; seen[idd] = 1;
      var s = stats[idd] || { hours: 0, days: 0, ot: 0 };
      var over48 = s.hours > WH_WEEK_MAXHR, over7 = s.days > WH_WEEK_MAXDAY, otOver = s.ot > WH_WEEK_MAXOT;
      if (over48 || over7) overN++; if (otOver) otOverN++;
      rows.push({ team: team, id: idd, name: r.name, pos: r.pos || '', hours: s.hours, days: s.days, ot: s.ot, over48: over48, over7: over7, otOver: otOver });
    }
    Object.keys(d.res.teams).forEach(function (t) { d.res.teams[t].records.forEach(function (r) { collect(t, r); }); });
    if (d.ll && d.ll.totals && d.ll.totals.staff > 0) Object.keys(d.ll.sections).forEach(function (s) { d.ll.sections[s].records.forEach(function (r) { collect('LL·' + s, r); }); });
    // เรียง: เกินเกณฑ์ (ชม.กะ/วัน/OT) ก่อน → ชม.กะ+OT มากก่อน
    rows.sort(function (a, b) { return ((b.over48 || b.over7 || b.otOver) ? 1 : 0) - ((a.over48 || a.over7 || a.otOver) ? 1 : 0) || (b.hours + b.ot) - (a.hours + a.ot); });
    var body = rows.map(function (x) {
      var warn = [];
      if (x.over48) warn.push('ชม.กะเกิน 48ช (' + x.hours + ')');
      if (x.over7) warn.push('เกิน 7 วัน (' + x.days + ')');
      if (x.otOver) warn.push('OT เกิน ' + WH_WEEK_MAXOT + 'ช (' + x.ot + ')');
      var cls = warn.length ? 'rowbad' : '', st;
      if (warn.length) st = '<span class="badd">⚠️ ' + rbEsc_(warn.join(' · ')) + '</span>';
      else st = '<span class="okk">✅ ' + x.hours + 'ช / ' + x.days + 'วัน' + (x.ot > 0 ? ' · OT ' + x.ot + 'ช' : '') + '</span>';
      var otdisp = x.ot > 0 ? ('<span class="' + (x.otOver ? 'badd' : '') + '">' + x.ot + '</span>') : '<span class="muted">–</span>';
      return '<tr class="' + cls + '" data-team="' + rbEsc_(x.team) + '"><td class="b">' + rbEsc_(x.team) + '</td><td class="tnum">' + rbEsc_(x.id) +
        '</td><td>' + rbEsc_(x.name) + '</td><td>' + rbEsc_(x.pos) + '</td><td class="tnum"><b>' + x.hours + '</b></td><td class="tnum">' + x.days + '</td><td class="tnum">' + otdisp + '</td><td>' + st + '</td></tr>';
    }).join('') || '<tr><td colspan="8" class="muted" style="text-align:center;padding:18px">— ไม่มีข้อมูล —</td></tr>';
    var partial = W.nDays < 7 ? (' <span class="muted">· นับถึงวันที่มีไฟล์ ' + W.nDays + '/7 วัน (สัปดาห์ยังไม่ครบ)</span>') : '';
    var hd = '<div class="sectionlabel" style="background:#fff7e6;border-left:4px solid #fec909;padding:8px 12px;border-radius:8px">' +
      '⏱️ <b>ชั่วโมงทำงานรายสัปดาห์</b> (' + rbEsc_(wk) + ') ตามระเบียบ — เพดาน <b>48 ชม. / 7 วัน · OT ' + WH_WEEK_MAXOT + ' ชม.</b> ต่อสัปดาห์ · ' +
      (overN ? '<span class="badd">⚠️ ชม.กะ/วันเกิน ' + overN + ' คน</span>' : '<span class="okk">✅ ชม.กะอยู่ในเกณฑ์</span>') +
      (otOverN ? ' · <span class="badd">⚠️ OT เกิน ' + otOverN + ' คน</span>' : '') +
      ' <span class="muted">· (นับจากไฟล์ Assignment รายวัน — ชม.กะ+วัน+OT จริง)</span>' + partial + '</div>';
    return hd + rbTblCard_('⏱️ ชั่วโมง/สัปดาห์ รายคน', '<tr><th>ทีม</th><th>รหัส</th><th>ชื่อ</th><th>ตำแหน่ง</th><th>ชม.กะ/สัปดาห์</th><th>วัน</th><th>OT/สัปดาห์</th><th>สถานะ</th></tr>', body, rbCtrls_('view-wh', true));
  } catch (e) { return '<div class="panel">โหลดชั่วโมง/สัปดาห์ไม่ได้: ' + rbEsc_(e.message) + '</div>'; }
}
