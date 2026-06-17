/**
 * WorkHours.gs — ชั่วโมงทำงานรายสัปดาห์จาก ROSTER รายเดือน (ระเบียบ AOTGA)
 * กฎ: กะ 7-12 ชม./วัน · รวมเวลางาน ≤48 ชม./สัปดาห์ · วันทำงาน ≤6 วัน/สัปดาห์
 * อ่านชีต "Code กะงาน" (รหัสกะ+สถานะวัน ของทุกคน ทุกวันในเดือน)
 *
 * รองรับเดือนถัดๆไป: ตั้ง Script Property 'PWMS_ROSTER_IDS' = {"2026-06":"<id>","2026-07":"<id>"}
 * (ไม่ตั้ง → ใช้ PWMS_ROSTER_ID ค่าเริ่มต้น)
 */
var PWMS_ROSTER_ID = '1varvj0xmFPbyB7zMYCisTDOwmYGcWAoKHPVkIuC_9I0';   // ROSTER เดือนปัจจุบัน (Google Sheet)
var WH_WEEK_MAXHR = 48, WH_WEEK_MAXDAY = 6;                            // เพดานรายสัปดาห์

/** ไฟล์ roster ของเดือนที่มี iso นั้น (จาก map เดือน→ไฟล์ ถ้ามี ไม่งั้นใช้ค่าเริ่มต้น) */
function whRosterIdFor_(iso) {
  var ym = String(iso).slice(0, 7);
  try { var m = JSON.parse(PropertiesService.getScriptProperties().getProperty('PWMS_ROSTER_IDS') || '{}'); if (m[ym]) return m[ym]; } catch (e) {}
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
  var ym = String(iso).slice(0, 7), ck = 'whroster_' + ym;
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
    var days = [];
    dateCols.forEach(function (d) {
      var code = row[d.col], stat = row[d.col + 1];
      days.push({ iso: d.iso, code: String(code == null ? '' : code).trim(), hours: whShiftHours_(code), work: whIsWork_(stat) });
    });
    byId[idd] = { name: nm, days: days };
  }
  var out = { ym: ym, byId: byId };
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

/** Lazy tab: ⏱️ ชั่วโมง/สัปดาห์ — รายคน (สัปดาห์ของวันที่เลือก) + เตือนเกิน 48ช/6วัน */
function rbWeekHoursHtml(iso) {
  try {
    var R = whLoadMonth_(iso);
    if (!R) return '<div class="panel">ยังเชื่อมไฟล์ ROSTER เดือนไม่ได้ — ตั้ง <code>PWMS_ROSTER_ID</code> (หรือ <code>PWMS_ROSTER_IDS</code>) ใน Script Properties</div>';
    var wk = whIsoWeek_(iso);
    var d = rbLoadResLL_(rbDateFromIso_(iso));
    var rows = [], overN = 0, incompN = 0, seen = {};
    Object.keys(d.res.teams).forEach(function (t) {
      d.res.teams[t].records.forEach(function (r) {
        var idd = String(r.id || '').replace(/\D/g, ''); if (!idd || seen[idd]) return; seen[idd] = 1;
        var w = whWeekStat_(iso, idd, r.shiftHrs || 0); if (!w) return;   // ใช้ชม.กะวันนี้ประมาณวันที่ ROSTER ไม่มีรหัส
        if (w.level === 'over') overN++; else if (w.incomplete) incompN++;
        rows.push({ team: t, id: idd, name: r.name, pos: r.pos || '', w: w });
      });
    });
    // เรียง: เกินเกณฑ์ → ไม่มีรหัสกะ (ให้เห็นง่าย) → ชั่วโมงมากก่อน
    rows.sort(function (a, b) { return (b.w.over48 || b.w.over6 ? 1 : 0) - (a.w.over48 || a.w.over6 ? 1 : 0) || (b.w.incomplete ? 1 : 0) - (a.w.incomplete ? 1 : 0) || b.w.hours - a.w.hours; });
    var body = rows.map(function (x) {
      var w = x.w, warn = [];
      if (w.over48) warn.push((w.incomplete ? 'อาจเกิน' : 'เกิน') + ' 48ช (' + (w.incomplete ? '≈' : '') + w.total + ')');
      if (w.over6) warn.push('เกิน 6 วัน (' + w.days + ')');
      var cls = warn.length ? 'rowbad' : '', st;
      if (warn.length) st = '<span class="badd">⚠️ ' + rbEsc_(warn.join(' · ')) + '</span>' +
        (w.incomplete ? ' <span class="tag">📝 ROSTER ไม่มีรหัส ' + w.nocode + ' วัน (ประมาณจากกะวันนี้)</span>' : '');
      else if (w.incomplete) st = '<span class="tag">📝 ≈ ' + w.total + 'ช — ประมาณจากกะวันนี้ · ROSTER ไม่มีรหัส ' + w.nocode + '/' + w.days + ' วัน (เติมให้ครบ)</span>';
      else st = '<span class="okk">✅ ' + w.hours + 'ช / ' + w.days + 'วัน</span>';
      var hdisp = w.incomplete ? ('<span class="muted">≈</span>' + w.total) : ('<b>' + w.hours + '</b>');
      return '<tr class="' + cls + '" data-team="' + rbEsc_(x.team) + '"><td class="b">' + rbEsc_(x.team) + '</td><td class="tnum">' + rbEsc_(x.id) +
        '</td><td>' + rbEsc_(x.name) + '</td><td>' + rbEsc_(x.pos) + '</td><td class="tnum">' + hdisp + '</td><td class="tnum">' + w.days + '</td><td>' + st + '</td></tr>';
    }).join('') || '<tr><td colspan="7" class="muted" style="text-align:center;padding:18px">— ไม่มีข้อมูล —</td></tr>';
    var hd = '<div class="sectionlabel" style="background:#fff7e6;border-left:4px solid #fec909;padding:8px 12px;border-radius:8px">' +
      '⏱️ <b>ชั่วโมงทำงานรายสัปดาห์</b> (' + rbEsc_(wk) + ') ตามระเบียบ — เพดาน <b>48 ชม. / 6 วัน</b> ต่อสัปดาห์ · ' +
      (overN ? '<span class="badd">⚠️ เกินเกณฑ์ ' + overN + ' คน</span>' : '<span class="okk">✅ ทุกคนอยู่ในเกณฑ์</span>') +
      (incompN ? ' · <span class="tag">📝 ไม่มีรหัสกะใน ROSTER ' + incompN + ' คน</span>' : '') +
      ' <span class="muted">· (นับกะที่เป็นวันทำงาน · ไม่รวม OT จริง)</span></div>';
    return hd + rbTblCard_('⏱️ ชั่วโมง/สัปดาห์ รายคน', '<tr><th>ทีม</th><th>รหัส</th><th>ชื่อ</th><th>ตำแหน่ง</th><th>ชม./สัปดาห์</th><th>วัน</th><th>สถานะ</th></tr>', body, rbCtrls_('view-wh', true));
  } catch (e) { return '<div class="panel">โหลดชั่วโมง/สัปดาห์ไม่ได้: ' + rbEsc_(e.message) + '</div>'; }
}
