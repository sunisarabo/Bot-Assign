/**
 * AdvancePlan.gs — จัดเวร/Assignment "ล่วงหน้า" จากข้อมูลจริง (ลิงก์ 3 ชีต)
 * =============================================================================
 * แหล่งข้อมูล (ลิงก์สด ผ่าน SpreadsheetApp.openById — ตั้ง ID ได้ใน Script Properties):
 *   · ROSTER  : ปฏิทินกะล่วงหน้า (รหัส | ชื่อ | วันที่→[รหัสกะ, ชนิดวัน])
 *   · FLIGHT  : ตารางบินล่วงหน้า (วันที่ | สายการบิน | เลขไฟลท์ | routing | STA | STD ...)
 *   · EMPLOYEE: รายชื่อพนักงานจริง ชีต "Total" (รหัส | ทีม | ตำแหน่ง | Name | Surname | สถานะ)
 *
 * แนวทาง (ตามที่ตกลง): ใช้กะที่มีอยู่แล้วใน ROSTER เป็นพูลคนว่างของวันนั้น แล้ว
 *   "จัด assignment ตามจำนวนไฟลท์ + SLA" — เป็นข้อเสนอ (ไม่เขียนทับไฟล์จริง),
 *   เลือก/แก้ชื่อคนในแต่ละช่องได้ (เหมาะสมก่อน → หรือเลือกจากพนักงานทั้งหมด).
 *
 * รหัสกะ → เวลา: ตัวอักษรตัวแรก = ชั่วโมงเริ่ม (E=05, F=06, G=07, J=10 ...),
 *   ตัวเลขท้าย = จำนวนชั่วโมง (เช่น G12 = 07:00–19:00, M6 = 13:00–19:00).
 *   รหัสกะดึก/พิเศษ (อักษรซ้ำ NN0/GG2 ฯลฯ) ที่แปลงเวลาไม่ได้ → ไม่นำเข้าพูลจัดงาน.
 *
 * ใช้ greedy ตัวเดียวกับ AutoPlan (apPick_/apEligible_/apScore_).
 * Entry: advPlan_(date) · rbAdvanceHtml(iso) · advTest_() (debug live reads)
 */

var ADV_ROSTER_ID = '1varvj0xmFPbyB7zMYCisTDOwmYGcWAoKHPVkIuC_9I0';
var ADV_FLIGHT_ID = '1Y3ft-vkHQ5Rm2LVmq1Zz_2j8n5T8wLgCJtdBKhqfBAA';
var ADV_EMP_ID    = '1oqKI1lbXDow6JCHCOqRIhT7o7dI9U9zfpyV8CJGOUJ8';
function advCfg_(key, dflt) {
  try { var v = PropertiesService.getScriptProperties().getProperty(key); return v || dflt; } catch (e) { return dflt; }
}

var ADV_MAX_OPT = 40;   // จำกัดตัวเลือกในแต่ละ dropdown

/** รหัสกะ → [นาทีเริ่ม, นาทีเลิก] (อักษรแรก=ชม.เริ่ม, เลข=จำนวน ชม.) */
function advShiftTime_(code) {
  code = String(code || '').toUpperCase().trim();
  if (!code) return null;
  var m = code.match(/^([A-Z])(\d{1,2})$/);          // อักษรเดี่ยว + จำนวนชั่วโมง
  if (m) {
    var start = m[1].charCodeAt(0) - 64;             // A=1 → 01:00
    var len = +m[2];
    if (start >= 1 && start <= 23 && len >= 4 && len <= 14) {
      var s = start * 60, e = (start + len) * 60;
      return [s, e > 1440 ? 1440 : e];
    }
  }
  return null;                                        // OPS / อักษรซ้ำ / ดึก → แปลงเวลาไม่ได้
}

/** แปลงค่าเซลล์วันที่ (Date object / "D/M/YYYY" / "D เดือนไทย YYYY") → {y,m,d} */
var ADV_TH_MON = { 'ม.ค.':1,'ก.พ.':2,'มี.ค.':3,'เม.ย.':4,'พ.ค.':5,'มิ.ย.':6,'ก.ค.':7,'ส.ค.':8,'ก.ย.':9,'ต.ค.':10,'พ.ย.':11,'ธ.ค.':12 };
function advParseDate_(v) {
  if (v == null || v === '') return null;
  if (Object.prototype.toString.call(v) === '[object Date]')
    return { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate() };
  var s = String(v).trim();
  var m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);                 // D/M/YYYY
  if (m1) return { y: +m1[3], m: +m1[2], d: +m1[1] };
  var m2 = s.match(/^(\d{1,2})\s+([ก-๙.]+)\s+(\d{4})/);              // D เดือนไทย YYYY
  if (m2 && ADV_TH_MON[m2[2]]) { var y = +m2[3]; return { y: y > 2400 ? y - 543 : y, m: ADV_TH_MON[m2[2]], d: +m2[1] }; }
  return null;
}
function advSameDate_(v, tgt) {
  var p = advParseDate_(v);
  return p && p.y === tgt.y && p.m === tgt.m && p.d === tgt.d;
}
function advHHMM_(v) {
  var s = String(v == null ? '' : v).replace(/[^\d:]/g, '');
  if (!s) return '';
  var m = s.match(/^(\d{1,2}):?(\d{2})$/);
  return m ? (('0' + m[1]).slice(-2) + ':' + m[2]) : '';
}

/** อ่านรายชื่อพนักงานจริง (ชีต Total) → { id: {id,team,pos,name,active} } */
function advReadEmployees_() {
  var ss = SpreadsheetApp.openById(advCfg_('ADV_EMP_ID', ADV_EMP_ID));
  var sh = ss.getSheetByName('Total') || ss.getSheets()[0];
  var data = sh.getDataRange().getValues();
  var emp = {}, col = null;
  data.forEach(function (row) {
    var c = row.map(function (x) { return String(x == null ? '' : x).trim(); });
    var idIdx = c.indexOf('รหัสพนักงาน');
    if (idIdx >= 0) {                                                  // แถวหัวตาราง (มีหลายบล็อกตามทีม)
      col = { id: idIdx, team: c.indexOf('ทีม'), pos: c.indexOf('ตำแหน่ง'),
              name: c.indexOf('Name'), sur: c.indexOf('Surname'), status: c.indexOf('สถานะ') };
      return;
    }
    if (!col) return;
    var id = (c[col.id] || '').replace(/\D/g, '');
    if (id.length < 6) return;
    var status = col.status >= 0 ? c[col.status] : 'Active';
    var nm = ((col.name >= 0 ? c[col.name] : '') + ' ' + (col.sur >= 0 ? c[col.sur] : '')).trim();
    emp[id] = { id: id, team: col.team >= 0 ? c[col.team] : '', pos: col.pos >= 0 ? c[col.pos] : '',
                name: nm || id, active: !/resign|terminat|inactive|พ้น|ลาออก/i.test(status) };
  });
  return emp;
}

/** อ่านปฏิทินกะ ROSTER สำหรับวันที่ tgt → [{id,name,shift,dayType,off}] */
function advReadRoster_(tgt) {
  var ss = SpreadsheetApp.openById(advCfg_('ADV_ROSTER_ID', ADV_ROSTER_ID));
  var sh = ss.getSheets()[0];                                          // แท็บแรก = ปฏิทินกะ
  var data = sh.getDataRange().getValues();
  var hi = -1, dateCol = -1;
  for (var i = 0; i < data.length && i < 40; i++) {
    var r = data[i].map(function (x) { return String(x == null ? '' : x).trim(); });
    if (r.indexOf('รหัส') >= 0 && r.join('|').indexOf('ชื่อพนักงาน') >= 0) {
      hi = i;
      for (var col = 2; col < data[i].length; col++) { if (advSameDate_(data[i][col], tgt)) { dateCol = col; break; } }
      break;
    }
  }
  if (hi < 0 || dateCol < 0) return { rows: [], found: dateCol >= 0, hi: hi };
  var out = [];
  for (var r2 = hi + 1; r2 < data.length; r2++) {
    var row = data[r2];
    var id = String(row[0] || '').replace(/\D/g, '');
    if (id.length < 6) continue;
    var shift = String(row[dateCol] || '').trim();
    var dayType = String(row[dateCol + 1] || '').trim();
    var off = /(^|\b)0?3\b|วันหยุดพนักงาน/.test(dayType) || /^(OFF|X|VL|SL|VAC|ลา|พักร้อน)/i.test(shift) || !shift;
    out.push({ id: id, name: String(row[1] || '').trim(), shift: shift, dayType: dayType, off: off });
  }
  return { rows: out, found: true, hi: hi, dateCol: dateCol };
}

/** อ่านตารางบิน FLIGHT สำหรับวันที่ tgt → [{flight,airline,STA,STD,OP,CL}] */
function advReadFlights_(tgt) {
  var ss = SpreadsheetApp.openById(advCfg_('ADV_FLIGHT_ID', ADV_FLIGHT_ID));
  var sh = ss.getSheets()[0];
  var data = sh.getDataRange().getValues();
  var out = [], seen = {};
  data.forEach(function (row) {
    if (!advSameDate_(row[0], tgt)) return;
    var airline = String(row[1] || '').trim().toUpperCase();
    var fltno = String(row[2] || '').trim();
    if (!airline || !fltno || /cancel/i.test(String(row[20] || ''))) return;   // ข้ามไฟลท์ยกเลิก
    var flight = airline + fltno;
    if (seen[flight]) return; seen[flight] = 1;
    out.push({ flight: flight, airline: airline, STA: advHHMM_(row[4]), STD: advHHMM_(row[5]), OP: '', CL: '' });
  });
  return out;
}

var ADV_EN_MON = { JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12 };
/** ดึงเลขวันจากป้ายหัวคอลัมน์ (เช่น "1/MON/TIME" หรือ "SAT/30/TIME") */
function advHdrDay_(s) { var m = String(s || '').match(/\d{1,2}/); return m ? +m[0] : null; }
/** ดึงรหัสสายการบินจากชื่อบล็อก (เช่น "JUNE 2026 /EK UO FY 6B BY") */
function advBlockAirlines_(s) {
  s = String(s || '');
  var m = s.match(/\d{4}\s*\/?\s*(.+)$/);                      // เอาส่วนหลังปี
  var tail = (m ? m[1] : s).replace(/\/(NO|POS|ID|NAME)\s*$/i, '');
  return (tail.match(/[A-Z0-9]{2,3}/g) || []).filter(function (c) { return !/^\d+$/.test(c); });
}

/** อ่าน ROSTER แบบ "บล็อกหน้างาน" (No|Pos|ID|Name|Sur| ต่อวัน [TIME|CODE|HR|OT|OTHR|REMARK])
 *  คืนพนักงานหน้างานที่ขึ้นเวรวันที่ tgt → [{id,name,pos,team,airlines,range,off}] */
function advReadRosterFrontline_(tgt) {
  var ss = SpreadsheetApp.openById(advCfg_('ADV_ROSTER_ID', ADV_ROSTER_ID));
  var sheets = ss.getSheets();
  var out = [];
  sheets.forEach(function (sh) {
    var data = sh.getDataRange().getValues();
    advScanFrontlineRows_(data, tgt, out);
  });
  return out;
}
/** สแกน rows (1 ชีต) หาบล็อกหน้างาน + คนที่ขึ้นเวรวัน tgt — แยกไว้เพื่อทดสอบ offline ได้ */
function advScanFrontlineRows_(data, tgt, out) {
  var cur = null;                                              // {timeCol, airlines} ของบล็อกปัจจุบัน
  for (var i = 0; i < data.length; i++) {
    var row = data[i].map(function (x) { return String(x == null ? '' : x).trim(); });
    // แถวหัวบล็อก = มีคอลัมน์ลงท้าย "TIME" และถัดไปเป็น "CODE"
    var timeCols = [];
    for (var c = 0; c < row.length; c++) {
      if (/(^|\/)TIME$/i.test(row[c]) && /(^|\/)CODE$/i.test(row[c + 1] || '')) timeCols.push(c);
    }
    if (timeCols.length) {
      var title = '';
      for (var t = 0; t < Math.min(6, row.length); t++) if (/\d{4}/.test(row[t])) { title = row[t]; break; }
      var monMatch = title.match(/[A-Za-z]{3,}/);
      var blkMon = monMatch ? ADV_EN_MON[monMatch[0].slice(0, 3).toUpperCase()] : null;
      cur = null;
      if (blkMon == null || blkMon === tgt.m) {                // เดือนตรง (หรือไม่ระบุ)
        // เลขวันอาจอยู่ในเซลล์หัวเอง หรือแถวเหนือขึ้นไป (กรณี merge)
        for (var k = 0; k < timeCols.length; k++) {
          var col = timeCols[k];
          var day = advHdrDay_(row[col]);
          for (var up = 1; up <= 2 && day == null; up++) if (i - up >= 0) day = advHdrDay_(String(data[i - up][col] == null ? '' : data[i - up][col]));
          if (day === tgt.d) { cur = { timeCol: col, airlines: advBlockAirlines_(title) }; break; }
        }
      }
      continue;
    }
    if (!cur) continue;
    var id = (row[2] || '').replace(/\D/g, '');
    if (id.length < 6 || id.length > 8) continue;              // แถวคน: ID 6-8 หลักที่คอลัมน์ 3
    var pos = row[1] || '', name = ((row[3] || '') + ' ' + (row[4] || '')).trim();
    var rng = row[cur.timeCol] || '';
    var off = /^(OFF|X|VL|SL|VAC|ลา|พักร้อน)/i.test(rng) || !rng || /^\s*-\s*$/.test(rng);
    out.push({ id: id, name: name, pos: pos, team: cur.airlines.join('/'), airlines: cur.airlines, range: rng, off: off });
  }
}

/** ระบบเช็คอินที่พนักงานทำได้ = ระบบของสายการบินในทีมตัวเอง (เช่น "JQ/IT/IX/AI") */
function advSysForTeam_(teamStr) {
  var sys = {};
  String(teamStr || '').split(/[\/,\s]+/).forEach(function (code) {
    if (!code) return;
    var s = slaSystemOf_(code.toUpperCase());
    if (s) sys[slaSysNorm_(s)] = true;
  });
  return sys;
}

/** สร้างพูลคนว่างของวันนั้น (พนักงานหน้างานจาก ROSTER บล็อก + อ่านช่วงเวลาตรงๆ) */
function advBuildPool_(tgt) {
  var emp = advReadEmployees_();
  var ros = advReadRosterFrontline_(tgt);
  var pool = [], seen = {};
  ros.forEach(function (p) {
    if (p.off || seen[p.id]) return;
    var rr = rrRangeStr_(p.range);
    if (rr[0] == null || rr[1] == null) return;                        // ไม่มีช่วงเวลา → ไม่จัด
    var ds = rr[0], de = rr[1]; if (de <= ds) de += 1440;
    var e = emp[p.id] || {};
    if (e.active === false) return;                                    // ลาออก/พ้นสภาพ → ข้าม
    seen[p.id] = 1;
    var sys = {};
    p.airlines.forEach(function (a) { var s = slaSystemOf_(a); if (s) sys[slaSysNorm_(s)] = true; });
    pool.push({
      id: p.id, name: e.name || p.name, team: p.team || (e.team || ''), pos: p.pos || e.pos || '',
      posGroup: rrPosGroup_(p.pos || e.pos || '', ''),
      ds: ds, de: de, busy: [], plan: 0, nflt: 0, sys: sys,
      shiftDisp: rrFmtMin_(rr[0]) + '-' + rrFmtMin_(((de) % 1440 + 1440) % 1440),
      otDisp: '-', hrs: Math.round((de - ds) / 6) / 10, flts: [],
    });
  });
  return pool;
}

/** จัด assignment ล่วงหน้าสำหรับวันที่ tgt (greedy เดียวกับ AutoPlan) */
function advPlan_(tgt) {
  var pool = advBuildPool_(tgt);
  var flights = advReadFlights_(tgt).filter(function (f) { return acIsFlight_(f.flight); });
  flights.forEach(function (f) {
    f.airline = slaAirlineOf_(f.flight);                               // normalize (เช่น 8M→QZ alias ทำใน slaReq_)
    f.system = slaSystemOf_(f.airline);
    f.teams = {};
    f.req = slaReq_(f.airline);
  });
  flights.sort(function (a, b) { return String(a.STD || a.STA || 'zz').localeCompare(String(b.STD || b.STA || 'zz')); });

  var plan = [];
  flights.forEach(function (f) {
    var assign = { SUP: [], CI: [], ARR: [], GATE: [] }, shortx = {};
    var phaseReq = { SUP: f.req.SUP, CI: f.req.CI, ARR: f.req.ARR, GATE: f.req.GATE };
    var sumPh = f.req.SUP + f.req.CI + f.req.ARR + f.req.GATE;
    var extra = Math.max(0, (f.req.total || 0) - sumPh);
    if (f.req.CI > 0) phaseReq.CI += extra; else phaseReq.GATE += extra;   // PG (CI=0) → ส่วนเกินไปเกท
    AP_PHASES.forEach(function (ph) {
      if (!phaseReq[ph]) return;
      var win = slaPhaseWindow_(f, ph);
      for (var k = 0; k < phaseReq[ph]; k++) {
        var p = apPick_(pool, f, ph, win, true, '');
        if (p) assign[ph].push(apPersonView_(p));
        else { shortx[ph] = phaseReq[ph] - k; break; }
      }
    });
    plan.push({ flight: f.flight, airline: f.airline, system: f.system || '', sta: f.STA || '', std: f.STD || '',
      req: f.req, phaseReq: phaseReq, assign: assign, shortx: shortx });
  });

  var bench = pool.filter(function (p) { return p.plan === 0; })
    .map(function (p) { return { id: p.id, name: p.name, pos: slaPosShort_(p.posGroup), team: p.team, shift: p.shiftDisp }; });
  return { plan: plan, bench: bench, pool: pool, nPeople: pool.length,
    nAssigned: pool.filter(function (p) { return p.plan > 0; }).length, nFlights: plan.length };
}

/** รายชื่อพนักงาน Active ทั้งหมด (เรียง) — สำหรับ datalist เลือกข้ามได้ทุกคน */
function advActiveNames_() {
  var emp = advReadEmployees_(), names = {};
  Object.keys(emp).forEach(function (id) { var e = emp[id]; if (e.active !== false && e.name) names[e.name] = 1; });
  return Object.keys(names).sort();
}

/** input ชิพเลือกชื่อ: ค่าเริ่ม=คนที่จัด, autocomplete จากพนักงานทั้งหมด (datalist #alladv) */
function advNameInput_(p) {
  return '<input class="namepick" list="alladv" value="' + rbAttr_(p.name) +
    '" title="' + rbAttr_((p.pos || '') + ' · กะ ' + (p.shift || '') + ' · ' + (p.team || '')) +
    '" oninput="this.classList.add(\'edited\')">';
}

/** Lazy tab: 📅 จัดเวรล่วงหน้า — อ่าน ROSTER+FLIGHT+Total สด แล้วจัด assignment ตามไฟลท์ */
function rbAdvanceHtml(iso) {
  try {
    var date = (typeof rbDateFromIso_ === 'function') ? rbDateFromIso_(iso) : new Date(iso);
    var tgt = { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() };
    var dstr = tgt.d + '/' + tgt.m + '/' + tgt.y;
    var datebar = '<div class="sectionlabel" style="background:#eef6ff;border-left:4px solid #1f4e79;padding:8px 12px;border-radius:8px">' +
      '📅 <b>จัดเวรล่วงหน้า</b> (ลิงก์ ROSTER · FLIGHT · รายชื่อจริง) — เลือกวันที่: ' +
      '<input type="date" value="' + iso + '" onchange="advGo(this.value)" style="font-family:inherit;padding:3px 6px;border-radius:6px;border:1px solid #b9c6da">' +
      ' <span class="muted">· คลิกช่องชื่อเพื่อเลือก/แก้ (autocomplete จากพนักงานทั้งหมด) · ข้อเสนอ ไม่เขียนทับไฟล์จริง</span></div>';

    var plan = advPlan_(tgt);
    if (!plan.nFlights && !plan.nPeople) {
      return datebar + '<div class="panel" style="padding:24px;text-align:center">ยังไม่มีข้อมูลไฟลท์/กะสำหรับวันที่ ' + dstr +
        ' <div class="muted" style="margin-top:6px">— เลือกวันที่ที่มีในตารางบิน (ตอนนี้ไฟล์ตัวอย่างมีเฉพาะวันที่ 1 ของแต่ละเดือน ปี 2026)</div></div>';
    }
    var shortF = 0;
    plan.plan.forEach(function (p) { if (Object.keys(p.shortx).length) shortF++; });
    var hd = '<div class="sectionlabel">วันที่ ' + dstr + ' · ไฟลท์ <b>' + plan.nFlights + '</b> · คนขึ้นเวร <b>' + plan.nPeople +
      '</b> · จัดแล้ว <b>' + plan.nAssigned + '</b> · พัก ' + plan.bench.length + ' · ' +
      (shortF ? '<b class="badd">' + shortF + ' ไฟลท์ยังขาด</b>' : 'ครบทุกไฟลท์ ✅') + '</div>';

    function cell(arr, req, shortN) {
      if (!req) return '<span class="muted">— ไม่มี</span>';
      return '<div><b>' + arr.length + '/' + req + '</b> ' + (shortN ? '<span class="badd">⚠️-' + shortN + '</span>' : '<span class="okk">✓</span>') +
        '</div>' + (arr.length ? '<div class="pickwrap">' + arr.map(advNameInput_).join('') + '</div>' : '');
    }
    var body = plan.plan.map(function (p) {
      var ok = Object.keys(p.shortx).length === 0;
      return '<tr class="' + (ok ? '' : 'rowbad') + '" data-team="' + rbEsc_(p.airline) + '"><td class="b">' + rbEsc_(p.flight) +
        '</td><td>' + rbEsc_(p.airline) + '</td><td>' + rbEsc_(p.system || 'iPort') + '</td><td class="tnum">' + rbEsc_(p.sta) + '</td><td class="tnum">' + rbEsc_(p.std) +
        '</td><td>' + cell(p.assign.SUP, p.phaseReq.SUP, p.shortx.SUP) + '</td><td>' + cell(p.assign.CI, p.phaseReq.CI, p.shortx.CI) +
        '</td><td>' + cell(p.assign.GATE, p.phaseReq.GATE, p.shortx.GATE) + '</td><td>' + cell(p.assign.ARR, p.phaseReq.ARR, p.shortx.ARR) + '</td></tr>';
    }).join('');
    var tbl = rbTblCard_('📅 จัด Assignment ล่วงหน้าตาม SLA — ' + dstr,
      '<tr><th>Flight</th><th>สายการบิน</th><th>ระบบ</th><th>STA</th><th>STD</th><th>SUP</th><th>Check-in</th><th>Gate</th><th>Arrival</th></tr>',
      body, rbCtrls_('view-adv', true));

    var benchHtml = '';
    if (plan.bench.length) {
      benchHtml = '<div class="tablecard" style="margin-top:14px"><div class="tablecard__hd"><h3>😴 คนขึ้นเวรที่ยังไม่ถูกจัด — ' + plan.bench.length + ' คน</h3></div>' +
        '<div style="padding:10px 14px">' + plan.bench.map(function (b) {
          return '<span class="chip">' + rbEsc_(b.name) + ' <span class="muted">' + rbEsc_(b.pos) + ' · ' + rbEsc_(b.shift) + '</span></span>';
        }).join('') + '</div></div>';
    }
    var dl = '<datalist id="alladv">' + advActiveNames_().map(function (n) { return '<option value="' + rbAttr_(n) + '">'; }).join('') + '</datalist>';
    return datebar + hd + tbl + benchHtml + dl;
  } catch (e) { return '<div class="panel">โหลด "จัดเวรล่วงหน้า" ไม่ได้: ' + rbEsc_(e.message) + ' <div class="muted">— ตรวจสิทธิ์เข้าถึง 3 ชีต (ROSTER/FLIGHT/Total) และรหัสชีตใน Script Properties</div></div>'; }
}

/** ทดสอบการอ่านลิงก์สด (รันใน Apps Script editor เพื่อตรวจสิทธิ์/โครงสร้าง) */
function advTest_() {
  var d = new Date(); d.setMonth(d.getMonth()); var tgt = { y: 2026, m: 6, d: 1 };
  var emp = advReadEmployees_(), ros = advReadRosterFrontline_(tgt), flt = advReadFlights_(tgt), pool = advBuildPool_(tgt), plan = advPlan_(tgt);
  Logger.log('employees=%s frontlineRows=%s flights=%s pool=%s | plan: flights=%s assigned=%s bench=%s',
    Object.keys(emp).length, ros.length, flt.length, pool.length, plan.nFlights, plan.nAssigned, plan.bench.length);
  return { employees: Object.keys(emp).length, rosterRows: ros.length, flights: flt.length, pool: pool.length, nFlights: plan.nFlights, nAssigned: plan.nAssigned };
}

/** ผู้สมัครที่ "เหมาะสม" สำหรับช่องนี้ (ระบบ+ตำแหน่ง+ว่าง) จากพูล — สำหรับ dropdown เลือกชื่อ */
function advCandidates_(f, ph, pool) {
  var win = slaPhaseWindow_(f, ph), needSys = slaNeedSys_(f.airline, ph), nn = needSys ? slaSysNorm_(needSys) : '';
  return pool.filter(function (p) {
    if (nn && !p.sys[nn]) return false;
    if (ph === 'SUP' && p.posGroup !== 'PSS') return false;
    if (win && !(p.ds <= win[0] + 30 && p.de >= win[1] - 30)) return false;
    return true;
  }).sort(function (a, b) { return a.plan - b.plan || String(a.name).localeCompare(b.name); });
}
