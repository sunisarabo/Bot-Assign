/**
 * ManningRules.gs — กฎกำลังพลมาตรฐานต่อไฟลท์ (STANDARD MANNING) แบบ "แก้ในชีตได้"
 * =============================================================================
 * เดิมกฎว่า "ไฟลท์สายไหนใช้คนกี่คน / เฟสไหน" ฝังใน SLA_RQ (SLA.gs) แก้ต้องแตะโค้ด
 * โมดูลนี้ย้ายกฎออกมาเป็น "ตารางในชีต" ให้ ops แก้เองได้ แล้วต่อกลับเข้า slaReq_
 *
 *   คอลัมน์:  AIRLINE | ชื่อสายการบิน | SUP | CI | ARR | GATE | TOTAL
 *   - slaReq_ จะเลือกค่าจากชีตก่อน (ถ้ามี) → ไม่งั้น fallback SLA_RQ (ค่า default เดิม)
 *   - เก็บใน spreadsheet แยก (id ใน Script Property 'MANNING_SHEET_ID')
 *   - cache 6 ชม. (CacheService) + memo ต่อ execution กัน openById ซ้ำ
 *
 * Entry:
 *   apSetupManning()  → สร้าง/รีเฟรชชีตกฎจากค่า default (เก็บ edit เดิมไว้) คืน URL
 *   manClearCache()   → ล้าง cache หลังแก้ตัวเลขในชีต (ให้ระบบอ่านค่าใหม่)
 *   manOverride_()    → { code: [SUP,CI,ARR,GATE,TOTAL] } (ภายใน — slaReq_ เรียกใช้)
 */

var MAN_SHEET_TAB = 'STANDARD MANNING';
var MAN_PROP_ID   = 'MANNING_SHEET_ID';
var MAN_CACHE_KEY = 'man_override_v1';
var MAN_CACHE_TTL = 21600;          // 6 ชม. (สูงสุดของ CacheService)
var MAN_MEMO = null;                // memo ต่อ execution (reset ทุกครั้งที่รันสคริปต์ใหม่)

function manSheetId_() {
  try { return String(PropertiesService.getScriptProperties().getProperty(MAN_PROP_ID) || '').trim(); }
  catch (e) { return ''; }
}

/** อ่านตารางกฎจากชีต → { CODE: [SUP,CI,ARR,GATE,TOTAL] } · ไม่มีชีต/อ่านไม่ได้ = {} (ใช้ default) */
function manOverride_() {
  if (MAN_MEMO) return MAN_MEMO;
  var map = {};
  try { var cc = CacheService.getScriptCache().get(MAN_CACHE_KEY); if (cc) { MAN_MEMO = JSON.parse(cc); return MAN_MEMO; } } catch (e0) {}
  var id = manSheetId_();
  if (!id) { MAN_MEMO = map; return map; }
  try {
    var ss = SpreadsheetApp.openById(id), sh = ss.getSheetByName(MAN_SHEET_TAB);
    if (!sh) { MAN_MEMO = map; return map; }
    var vals = sh.getDataRange().getValues();
    var hi = -1, col = {};
    for (var r = 0; r < Math.min(8, vals.length); r++) {
      var up = vals[r].map(function (x) { return String(x == null ? '' : x).trim().toUpperCase(); });
      if (up.indexOf('AIRLINE') >= 0 && up.indexOf('CI') >= 0) {
        hi = r; ['AIRLINE', 'SUP', 'CI', 'ARR', 'GATE', 'TOTAL'].forEach(function (k) { col[k] = up.indexOf(k); });
        break;
      }
    }
    if (hi < 0) { MAN_MEMO = map; return map; }
    for (var i = hi + 1; i < vals.length; i++) {
      var row = vals[i];
      var code = String(row[col.AIRLINE] == null ? '' : row[col.AIRLINE]).trim().toUpperCase();
      if (!/^[0-9A-Z]{2,3}$/.test(code)) continue;                        // ข้ามแถวว่าง/หมายเหตุ
      var num = function (k) {
        if (col[k] == null || col[k] < 0) return 0;
        var v = parseInt(String(row[col[k]]).replace(/[^0-9-]/g, ''), 10);
        return isNaN(v) ? 0 : v;
      };
      var sup = col.SUP >= 0 ? (num('SUP') || 1) : 1, ci = num('CI'), arr = num('ARR'), gate = num('GATE');
      var tot = col.TOTAL >= 0 ? num('TOTAL') : 0; if (!tot) tot = sup + ci + arr + gate;
      map[code] = [sup, ci, arr, gate, tot];
    }
  } catch (e) { MAN_MEMO = {}; return MAN_MEMO; }                          // อ่านพลาด → ใช้ default เงียบ ๆ
  try { CacheService.getScriptCache().put(MAN_CACHE_KEY, JSON.stringify(map), MAN_CACHE_TTL); } catch (e2) {}
  MAN_MEMO = map;
  return map;
}

/** ล้าง cache หลังแก้ตัวเลขในชีต — เรียกจากปุ่มในเว็บ หรือรันมือ */
function manClearCache() {
  MAN_MEMO = null;
  try { CacheService.getScriptCache().remove(MAN_CACHE_KEY); } catch (e) {}
  return 'ล้าง cache กฎ manning แล้ว — ระบบจะอ่านค่าใหม่จากชีตในการคำนวณครั้งต่อไป';
}

/** สร้าง/รีเฟรชชีตกฎ manning จากค่า default (SLA_RQ) — เก็บ edit เดิมไว้ · คืน URL ให้เปิดแก้ */
function apSetupManning() {
  var id = manSheetId_(), ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = rbCreateSheet_('PAS — STANDARD MANNING (กฎกำลังพลต่อไฟลท์)');
    try { PropertiesService.getScriptProperties().setProperty(MAN_PROP_ID, ss.getId()); } catch (e1) {}
  }
  var ovr = manOverride_();                                                // อ่าน edit เดิมก่อน (ถ้ามี) เพื่อไม่ทับค่าที่ ops ปรับไว้
  var sh = ss.getSheetByName(MAN_SHEET_TAB) || ss.insertSheet(MAN_SHEET_TAB);
  sh.clear();
  var rows = [
    ['กฎกำลังพลมาตรฐานต่อไฟลท์ — แก้ตัวเลขคอลัมน์ SUP/CI/ARR/GATE/TOTAL ได้ แล้วกดปุ่ม "ล้าง cache กฎ" ในเว็บ', '', '', '', '', '', ''],
    ['SUP=หัวหน้า/คุมงาน · CI=เช็คอิน · ARR=ขาเข้า · GATE=เกท/บอร์ดดิ้ง · TOTAL=รวมทั้งไฟลท์ (เว้นว่าง=รวมอัตโนมัติ)', '', '', '', '', '', ''],
    ['AIRLINE', 'ชื่อสายการบิน', 'SUP', 'CI', 'ARR', 'GATE', 'TOTAL']
  ];
  var codes = Object.keys(SLA_RQ).sort();
  codes.forEach(function (c) {
    var b = ovr[c] || SLA_RQ[c];
    rows.push([c, (typeof slaAirName_ === 'function' ? slaAirName_(c) : c), b[0], b[1], b[2], b[3], b[4]]);
  });
  sh.getRange(1, 1, rows.length, 7).setValues(rows).setVerticalAlignment('middle');
  sh.getRange(1, 1, 1, 7).merge().setFontWeight('bold').setBackground('#1f4e79').setFontColor('#fff').setHorizontalAlignment('left');
  sh.getRange(2, 1, 1, 7).merge().setFontStyle('italic').setFontColor('#5b7189').setHorizontalAlignment('left');
  sh.getRange(3, 1, 1, 7).setFontWeight('bold').setBackground('#dce9f7').setFontColor('#1f4e79').setHorizontalAlignment('center');
  sh.getRange(4, 3, codes.length, 5).setHorizontalAlignment('center');
  [70, 230, 55, 55, 55, 65, 70].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(3); sh.setFrozenColumns(1);
  manClearCache();
  return ss.getUrl();
}
