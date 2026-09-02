/**
 * MasterReader.gs — total active-headcount per department from the MASTER file
 * =============================================================================
 * The Pax Manpower master ("Total" sheet) lists every employee with their team,
 * department and status. This gives the *establishment* headcount (all active
 * staff) for PSA (การโดยสาร) and LL (ติดตามสัมภาระ) — independent of who is on
 * duty today. The daily attendance still comes from the assignment files; this
 * only adds "จำนวนพนักงานทั้งหมด" per department.
 *
 * Master "Total" sheet columns (0-indexed), per the original SmartShift bot:
 *   1 ID | 2 Team | 4 NameTH | 6 Dept | 7 Position | 10 NameEN | 12 ResignDate | 13 Status
 */

// ใส่ ID ไฟล์ Pax Manpower ถ้าบัญชีที่รันมีสิทธิ์เข้า (เว้นว่าง = ข้าม ไม่แสดงจำนวนพนักงานรวม)
// ใช้แสดงจำนวนพนักงานรวม + ค้นทีมต้นสังกัดของคนซัพจากชื่อ (rbMasterNameTeam_)
var MASTER_FILE_ID_RB = '1oqKI1lbXDow6JCHCOqRIhT7o7dI9U9zfpyV8CJGOUJ8';
var DEPT_PSA_TH = 'การโดยสาร';
var DEPT_LL_TH  = 'ติดตามสัมภาระ';

function readMasterHeadcount(masterFileId) {
  try {
    var ss = SpreadsheetApp.openById(masterFileId || MASTER_FILE_ID_RB);
    var ws = ss.getSheetByName('Total');
    if (!ws) { Logger.log('⚠️ Master: ไม่พบชีต "Total" → ข้าม'); return null; }
    var data = ws.getDataRange().getValues();

    var hc = { PSA: { total: 0, byPos: {} }, LL: { total: 0, byPos: {} }, active: 0, ids: {} };
    var now = new Date();

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var idStr = String(row[1] == null ? '' : row[1]).replace(/\.0*$/, '').trim();
      var idNum = idStr.replace(/\D/g, '');
      if (!/^\d{6,8}$/.test(idNum)) continue;
      hc.ids[idNum] = 1;                                        // ทุก ID ที่มีในไฟล์รายชื่อ (รวม resigned/office/LL) → ใช้เช็ค "ในเวรแต่ไม่มีใน master"

      var status = String(row[13] || '').trim();
      if (status === 'Resigned') continue;
      if (status !== 'Active') {
        var rd = row[12];
        if (rd instanceof Date && rd < now) continue;        // already left
      }

      var dept = String(row[6] || '');
      var deptKey = dept.indexOf(DEPT_PSA_TH) >= 0 ? 'PSA' : (dept.indexOf(DEPT_LL_TH) >= 0 ? 'LL' : null);
      if (!deptKey) continue;

      var team = String(row[2] || '');
      var grp = (deptKey === 'LL') ? rrLLPosGroup_(row[7]) : rrPosGroup_(row[7], team);
      hc[deptKey].total++;
      hc[deptKey].byPos[grp] = (hc[deptKey].byPos[grp] || 0) + 1;
      hc.active++;
    }
    // ── ผูกกับชีต "BKK Batch 1" (พนักงาน BKK มาช่วย HKT · รหัสขึ้นต้น B · ไม่ได้อยู่ชีต Total) ──
    //   → ใส่รหัสเข้า hc.ids (กันเตือน "ในเวรแต่ไม่มีใน master") + นับเข้ายอด PSA ให้ตรง
    try { rbAddBkkBatch_(ss, hc); } catch (eBk) { Logger.log('BKK Batch: ' + eBk.message); }
    return hc;
  } catch (e) {
    Logger.log('⚠️ Master: เข้าไฟล์ไม่ได้ (' + e.message + ') → ข้าม (รายงานยังออกได้)');
    return null;
  }
}

/** หาชีต "BKK Batch 1" (ชื่อมีเว้นวรรค/ตัวเลขต่อท้ายได้) */
function rbFindBkkBatchSheet_(ss) {
  var found = null;
  ss.getSheets().forEach(function (s) {
    var n = s.getName();
    if (!found && /BKK/i.test(n) && /BATCH/i.test(n)) found = s;
  });
  return found;
}
/** แถวคน BKK Batch → { id(เลขล้วน), team, nameTh, pos } · หัวตาราง: รหัส(1) ทีม(2) คำนำหน้า(3) ชื่อ(4) สกุล(5) แผนก(6) ตำแหน่ง(7) */
function rbReadBkkBatch_(ss) {
  var out = [], ws = rbFindBkkBatchSheet_(ss);
  if (!ws) return out;
  var data = ws.getDataRange().getValues();
  var hi = 0;
  for (var h = 0; h < Math.min(6, data.length); h++) {
    var u = data[h].map(function (c) { return String(c == null ? '' : c); });
    if (u.some(function (c) { return /รหัส/.test(c); }) && u.some(function (c) { return /ชื่อ/.test(c); })) { hi = h; break; }
  }
  for (var i = hi + 1; i < data.length; i++) {
    var row = data[i];
    var idNum = String(row[1] == null ? '' : row[1]).replace(/\D/g, '');   // "B2607384" → "2607384"
    if (!/^\d{6,8}$/.test(idNum)) continue;
    out.push({ id: idNum, team: String(row[2] || '').trim(),
      nameTh: (String(row[4] || '').trim() + ' ' + String(row[5] || '').trim()).trim(),
      pos: String(row[7] || 'Passenger Services Agent').trim() });
  }
  return out;
}
/** ใส่คน BKK Batch เข้า headcount: hc.ids + นับ PSA (ทุกคนเป็น PSA การโดยสาร) */
function rbAddBkkBatch_(ss, hc) {
  rbReadBkkBatch_(ss).forEach(function (p) {
    if (hc.ids[p.id]) return;                                  // มีใน Total อยู่แล้ว → ไม่นับซ้ำ
    hc.ids[p.id] = 1;
    var grp = (typeof rrPosGroup_ === 'function') ? rrPosGroup_(p.pos, p.team) : 'Agent';
    hc.PSA.total++; hc.PSA.byPos[grp] = (hc.PSA.byPos[grp] || 0) + 1; hc.active++;
  });
}

/** เติมคน BKK ที่ยังไม่มีในชีต "BKK Batch 1" (รันครั้งเดียวใน Apps Script · idempotent ไม่เพิ่มซ้ำ)
 *  ใช้เพิ่มคนที่อยู่ในเวรแต่ยังไม่มีในไฟล์รายชื่อเลย (เช่น SOFROP, MUHAMMAD) → ยอดครบ ไม่เตือน */
function rbBkkBatchAddMissing() {
  var ADD = [                                                  // {id(ไม่มี B), team, prefix, first, last, pos}
    { id: '2520045', team: 'SQ',   prefix: '', first: 'SOFROP', last: '', pos: 'Passenger Services Agent' },
    { id: '2520062', team: 'WYWK', prefix: '', first: 'MUHAMMAD (MATTY)', last: '', pos: 'Passenger Services Agent' }
  ];
  var ss = SpreadsheetApp.openById(MASTER_FILE_ID_RB);
  var ws = rbFindBkkBatchSheet_(ss);
  if (!ws) throw new Error('ไม่พบชีต BKK Batch 1');
  var have = {};
  rbReadBkkBatch_(ss).forEach(function (p) { have[p.id] = 1; });
  var last = ws.getLastRow(), seq = 0, added = [];
  // หาเลขลำดับล่าสุด (คอลัมน์ A)
  var colA = ws.getRange(1, 1, last, 1).getValues();
  colA.forEach(function (r) { var n = parseInt(r[0], 10); if (!isNaN(n)) seq = Math.max(seq, n); });
  ADD.forEach(function (p) {
    if (have[p.id]) return;                                    // มีแล้ว → ข้าม
    seq++;
    ws.appendRow([seq, 'B' + p.id, p.team, p.prefix, p.first, p.last, 'การโดยสาร ภูเก็ต', p.pos, new Date()]);
    added.push(p.id + ' ' + p.first);
  });
  Logger.log('เพิ่มเข้า BKK Batch 1: ' + (added.length ? added.join(', ') : '(ไม่มีที่ต้องเพิ่ม — มีครบแล้ว)'));
  return 'เพิ่ม ' + added.length + ' คน: ' + added.join(', ');
}

function debugDumpMaster(masterFileId) {
  var hc = readMasterHeadcount(masterFileId);
  Logger.log('Active: %s  |  PSA %s  LL %s  รวม %s',
    hc.active, hc.PSA.total, hc.LL.total, hc.PSA.total + hc.LL.total);
  Logger.log('PSA byPos: %s', JSON.stringify(hc.PSA.byPos));
  Logger.log('LL  byPos: %s', JSON.stringify(hc.LL.byPos));
  return hc;
}

/** ดัชนี "ชื่อ (คำแรก ตัวพิมพ์ใหญ่ · ทั้งไทย/อังกฤษ) → { team: 1 }" จากไฟล์ master (Total)
 *  ใช้ค้นทีมต้นสังกัดของคนซัพที่ไม่มีรหัสทีมในชีตรายวัน (ตัด Resigned ออก) */
function rbMasterNameTeam_(masterFileId) {
  var out = {};
  var id = masterFileId || MASTER_FILE_ID_RB;
  if (!id) return out;
  var ss = SpreadsheetApp.openById(id);
  var ws = ss.getSheetByName('Total');
  if (!ws) return out;
  var data = ws.getDataRange().getValues();
  function key(nm) {
    var s = String(nm == null ? '' : nm).trim().toUpperCase().split(/[\s(]/)[0];
    return s.length >= 3 ? s : '';
  }
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (String(row[13] || '').trim() === 'Resigned') continue;   // ลาออกแล้ว ไม่นับ
    var team = String(row[2] || '').trim();                        // คอลัมน์ Team
    if (!team) continue;
    [row[10], row[4]].forEach(function (nm) {                      // NameEN(10) · NameTH(4)
      var k = key(nm); if (k) (out[k] = out[k] || {})[team] = 1;
    });
  }
  // เพิ่มคน BKK Batch (ชีตแยก) → ชื่อ→ทีม (ใช้โค้ดสายแรกเป็นทีม เช่น "EK/UO/6B" → EK)
  try {
    rbReadBkkBatch_(ss).forEach(function (p) {
      var team = String(p.team || '').split('/')[0].trim();
      var k = key(p.nameTh); if (k && team) (out[k] = out[k] || {})[team] = 1;
    });
  } catch (eB) {}
  return out;
}

/** สร้างชีต "Master_Mapping" ในไฟล์รายชื่อ (รันครั้งเดียวใน Apps Script) — พร้อมหัวตาราง + ตัวอย่าง
 *  แล้วเปิดชีตไปเติม: คอลัมน์ A = ชื่อ/คำค้น · B = ทีม (เช่น KUNNIDA | PVT) → ระบบค้นทีมชั้นที่ 3 ให้เอง */
function rbMasterMappingSetup() {
  if (!MASTER_FILE_ID_RB) throw new Error('ยังไม่ได้ตั้ง MASTER_FILE_ID_RB');
  var ss = SpreadsheetApp.openById(MASTER_FILE_ID_RB);
  var sh = ss.getSheetByName('Master_Mapping');
  var created = false;
  if (!sh) {
    sh = ss.insertSheet('Master_Mapping'); created = true;
    sh.getRange(1, 1, 1, 2).setValues([['ชื่อ/คำค้น', 'ทีม/หมวด']])
      .setFontWeight('bold').setBackground('#1f4e79').setFontColor('#fff');
    sh.getRange(2, 1, 2, 2).setValues([['KUNNIDA', '(ใส่ทีมจริงตรงนี้)'], ['ตัวอย่าง: ชื่อพนักงาน', 'รหัสทีม เช่น PVT']]);
    sh.getRange(2, 2).setFontColor('#c0392b');
    sh.setColumnWidth(1, 240); sh.setColumnWidth(2, 160); sh.setFrozenRows(1);
  }
  Logger.log((created ? 'สร้างแท็บ Master_Mapping แล้ว' : 'มีแท็บ Master_Mapping อยู่แล้ว') + ' → ' + ss.getUrl() + '#gid=' + sh.getSheetId());
  return ss.getUrl() + '#gid=' + sh.getSheetId();
}
/** ตารางแมปแก้เอง (ชั้นค้นที่ 3) — แท็บ "Master_Mapping" ในไฟล์รายชื่อ
 *  คอลัมน์ A = คำค้น/ชื่อ (เช่น KUNNIDA) · B = ทีม/หมวด (เช่น PVT) → { UPPERKEY: 'ทีม' }
 *  ให้ผู้ใช้เติมเคสที่ระบบค้นอัตโนมัติไม่เจอได้เอง (ฟรี ไม่ต้องใช้ AI) */
function rbMasterMapping_(masterFileId) {
  var out = {};
  var id = masterFileId || MASTER_FILE_ID_RB;
  if (!id) return out;
  try {
    var ss = SpreadsheetApp.openById(id);
    var ws = ss.getSheetByName('Master_Mapping');
    if (!ws) return out;
    var last = ws.getLastRow(); if (last < 1) return out;
    var rows = ws.getRange(1, 1, last, 2).getValues();
    rows.forEach(function (r) {
      var k = String(r[0] == null ? '' : r[0]).trim().toUpperCase();
      var v = String(r[1] == null ? '' : r[1]).trim();
      if (!k || !v) return;
      if (/^(คำค้น|KEY|KEYWORD|ชื่อ|NAME)$/i.test(k)) return;      // ข้ามหัวตาราง
      out[k] = v;
    });
  } catch (e) {}
  return out;
}
