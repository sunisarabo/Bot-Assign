/**
 * JobByShift.gs — ดึงข้อมูลจาก assignment แล้ว "จับ job/ไฟลท์ตามช่วงเวลากะงาน"
 * =============================================================================
 * ต่อยอดจากของเดิมใน PAS (ไม่คำนวณเวลาซ้ำ):
 *   • rbLoadResLLraw_(date) — โหลด roster ทั้งวัน (res.teams[].records[], ll)
 *   • acFlightWin_(a)       — หน้าต่างเวลาของ job แต่ละงาน (แยกเฟส/ข้ามคืน/ตามสาย)
 *   • acDuty_(r)            — ช่วงกะ (ss–se) + ช่วง OT (otSegs, แยก PRE/POST)
 *
 * ผลลัพธ์: ต่อคน แต่ละ job จะถูกจัด zone
 *   'shift'  = อยู่ในเวลากะปกติ
 *   'ot'     = อยู่ในช่วง OT ที่กรอกไว้ (pre/post) — งานที่อยู่ในโอที
 *   'out'    = ตกนอกกะ และไม่มี OT รองรับ → ต้องใช้ OT แต่ยังไม่ได้กรอก (จุดที่ต้องแก้)
 *   'no-time'= งานไม่มีเวลา (เช่น standby/เอกสารไม่ผูกเวลา)
 *
 * เริ่มใช้:  pasJobsByShiftTest()            → log สรุปของวันนี้
 *          pasJobsByShiftTestDate(2026,9,9) → ระบุวันเอง
 *          pasJobsByShiftJson('2026-09-09') → คืน JSON (ใช้ป้อนหน้าเว็บ PAS)
 */

/** แปลง "HH:MM" → นาที (คืน null ถ้าไม่ใช่เวลา) */
function pasMin_(s) {
  var m = String(s || '').match(/(\d{1,2}):(\d{2})/);
  return m ? (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) : null;
}

/** ช่วง [lo,hi] คาบเกี่ยวกับ [a,b] กี่นาที (0 = ไม่คาบ) */
function pasOverlap_(lo, hi, a, b) {
  if (lo == null || hi == null || a == null || b == null) return 0;
  return Math.max(0, Math.min(hi, b) - Math.max(lo, a));
}

/** จัด zone ของ job [lo,hi] เทียบกับ duty ของคน (d = acDuty_)
 *  คืน { zone, ot }  ·  ot = 'PRE'|'POST'|null */
function pasZoneOf_(d, lo, hi) {
  if (lo == null || hi == null) return { zone: 'no-time', ot: null };
  var dur = Math.max(1, hi - lo);
  var inShift = (d.ss != null && d.se != null) ? pasOverlap_(lo, hi, d.ss, d.se) : 0;
  var inOt = 0, otType = null;
  (d.otSegs || []).forEach(function (seg) {
    var ov = pasOverlap_(lo, hi, seg[0], seg[1]);
    if (ov > inOt) { inOt = ov; otType = (d.se != null && seg[0] >= d.se - 1) ? 'POST' : 'PRE'; }
  });
  // จัดตามที่คาบเกี่ยว "มากที่สุด" (เกิน 50% ของงาน = ถือว่าอยู่ zone นั้น)
  if (inShift >= inOt && inShift >= dur * 0.5) return { zone: 'shift', ot: null };
  if (inOt > 0 && inOt >= dur * 0.5) return { zone: 'ot', ot: otType };
  if (inShift > 0 || inOt > 0) {                       // คาบบางส่วน → ดูว่าฝั่งไหนเยอะกว่า
    return inShift >= inOt ? { zone: 'shift', ot: null } : { zone: 'ot', ot: otType };
  }
  return { zone: 'out', ot: null };                     // นอกกะ + ไม่มี OT รองรับ
}

/** ดึง assignment ทั้งวัน → จับ job ตามช่วงกะ (โครงสร้างข้อมูลหลัก) */
function pasJobsByShift_(date) {
  var x = rbLoadResLL_(date);                // cached loader (res.teams[].records[], ll)
  var res = x.res, ll = x.ll;
  var tz = Session.getScriptTimeZone() || 'Asia/Bangkok';
  var teams = [];

  function jobRow(r) {
    var d = acDuty_(r);
    var jobs = [];
    (r.assignments || []).forEach(function (a) {
      if (!a.flight && !a.task) return;
      var win = null;
      try { win = acFlightWin_(a); } catch (e) { win = null; }
      var lo = win ? win[0] : null, hi = win ? win[1] : null;
      var z = pasZoneOf_(d, lo, hi);
      jobs.push({
        flight: a.flight || '', task: a.task || '',
        from: lo != null ? rrFmtMin_(lo) : '', to: hi != null ? rrFmtMin_(hi) : '',
        zone: z.zone, ot: z.ot || '', support: !!a.supportOut, activity: !!a.activity
      });
    });
    jobs.sort(function (p, q) { return (pasMin_(p.from) == null ? 99999 : pasMin_(p.from)) - (pasMin_(q.from) == null ? 99999 : pasMin_(q.from)); });
    return {
      id: r.id || '', name: r.name || '', pos: r.pos || '', shift: r.shift || '',
      shiftStr: (r.bucket === 'ot_off') ? 'OT OFF' : (r.shiftTime || r.shift || ''),
      bucket: r.bucket || '',
      dutyFrom: d.ds != null ? rrFmtMin_(d.ds) : '', dutyTo: d.de != null ? rrFmtMin_(d.de) : '',
      jobs: jobs,
      nShift: jobs.filter(function (j) { return j.zone === 'shift'; }).length,
      nOt: jobs.filter(function (j) { return j.zone === 'ot'; }).length,
      nOut: jobs.filter(function (j) { return j.zone === 'out'; }).length
    };
  }

  function addTeam(tname, records) {
    var rows = [];
    (records || []).forEach(function (r) {
      if (r.bucket === 'off' || r.bucket === 'sick' || r.bucket === 'vac') return;   // ไม่มาทำงาน
      var row = jobRow(r);
      if (row.jobs.length) rows.push(row);
    });
    if (rows.length) teams.push({ team: tname, rows: rows });
  }

  Object.keys(res.teams || {}).forEach(function (t) { addTeam(t, res.teams[t].records); });
  if (ll && ll.sections) Object.keys(ll.sections).forEach(function (s) { addTeam('LL·' + s, ll.sections[s].records); });

  return { iso: Utilities.formatDate(date, tz, 'yyyy-MM-dd'), teams: teams };
}

/** คืน JSON string (ใช้ป้อนหน้าเว็บ PAS) */
function pasJobsByShiftJson(iso) {
  var date = iso ? rbDateFromIso_(iso) : new Date();
  return JSON.stringify(pasJobsByShift_(date));
}

/** ทดสอบ: log สรุปของวันนี้ */
function pasJobsByShiftTest() { pasJobsByShiftDump_(new Date()); }

/** ทดสอบ: ระบุวันเอง */
function pasJobsByShiftTestDate(y, m, d) { pasJobsByShiftDump_(new Date(y, m - 1, d)); }

/** log สรุปแบบอ่านง่าย + รายการงานที่ "ตกนอกกะ" (ต้องใช้ OT) */
function pasJobsByShiftDump_(date) {
  var data = pasJobsByShift_(date);
  var gShift = 0, gOt = 0, gOut = 0, outList = [];
  data.teams.forEach(function (t) {
    t.rows.forEach(function (r) {
      gShift += r.nShift; gOt += r.nOt; gOut += r.nOut;
      r.jobs.forEach(function (j) {
        if (j.zone === 'out') outList.push(t.team + ' | ' + r.name + ' (' + r.shiftStr + ') → ' + j.flight + ' ' + j.task + ' [' + j.from + '-' + j.to + ']');
      });
    });
  });
  Logger.log('📋 Job-by-shift ' + data.iso + ' · ทีม ' + data.teams.length +
    '  | ในกะ ' + gShift + ' · ใน OT ' + gOt + ' · ⚠️ นอกกะ(ต้องใช้ OT) ' + gOut);
  if (outList.length) {
    Logger.log('— งานที่ตกนอกกะ (ยังไม่มี OT รองรับ) —');
    outList.slice(0, 60).forEach(function (s) { Logger.log('   ' + s); });
    if (outList.length > 60) Logger.log('   ...อีก ' + (outList.length - 60) + ' รายการ');
  }
}
