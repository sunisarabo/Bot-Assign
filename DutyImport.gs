/**
 * DutyImport.gs — แปลงข้อความขอซัพพอร์ตจาก Duty (ไลน์) → โครงสร้าง + สร้างชีต
 * Duty จัดซัพผ่านไลน์ ไม่ได้กรอกกลับลงชีต Assignment → ระบบมองไม่เห็น
 * เครื่องมือนี้: วางข้อความไลน์ → แตกเป็น (ไฟลท์ · ตำแหน่ง · ชื่อ · ทีม · เวลา) → ตรวจกับ roster → สร้างชีต
 */

var DI_TEAMS = /^(ZF|PVT|PVTLP|LP|WY|WYWK|WK|TK|AI|OZ|KE|SU|SV|PG|EK|EY|AK|QR|CX|SQ|LY|JQ|TR|CHN|SNR|KA)$/i;
var DI_STOP = /^(ARR|GATE|TF|TRANSFER|RELEASE|FLIGHT|AGENT|SUPPORT|INT|DOM|STBY|CTR|CLOSE|NTL|RESKED|RE|SKED|OB|ON|RQ|CONTROLLER|SMA|STA|STD|AT|ONLY|IKT|OVB|KHV|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|BRIEF|OPEN)$/i;
var DI_FLT = /\b((?:[A-Z]{2}|[0-9][A-Z]|[A-Z][0-9])\d{2,4})/;
var DI_ROLE = /(ARR\s*\+\s*GATE|ARR\s*\+\s*G\b|ARR\s*ONLY|ARR\s*\+\s*TF|ARR\s*\+\s*TRANSFER|CHK-?IN\s*\+\s*GATE|CHK-?IN|GATE\s*CONTROLLER|GATE\s*INT|GATE\s*\d*\s*DOM|GATE\s*DOM|RELEASE\s*FLIGHT|ARR\/TRANSFER|GATE|ARR|TRANSFER)/i;

/** แตกข้อความไลน์ Duty → [{flight, role, name, team, time}] */
function dutyParse_(text) {
  var out = [], curF = '', curR = '', curT = '';
  String(text || '').split(/\n/).forEach(function (raw) {
    var s = raw.trim(); if (!s) return;
    var fm = s.match(DI_FLT);
    var isNum = /^\s*\d+\s*[\.\)]/.test(s) || /^\s*\d+\s+[A-Za-z]/.test(s);
    // 1) หัวไฟลท์
    if (fm && !isNum && (/STA|STD/.test(s) || new RegExp('^' + fm[1] + '\\s*(/|$|\\s|IKT|OVB)', 'i').test(s))) {
      curF = fm[1].toUpperCase(); curR = '';
      var t = s.match(/STA[:\s]*(\d{1,2}[:.]?\d{2})/i), d = s.match(/STD[:\s]*(\d{1,2}[:.]?\d{2})/i);
      curT = (t ? t[1].replace('.', ':') : '') + (d ? '-' + d[1].replace('.', ':') : ''); return;
    }
    // 2) หัวตำแหน่ง (role) ที่ไม่มีชื่อ
    var rk = s.match(DI_ROLE);
    if (rk && new RegExp('^[\\-\\s]*' + rk[0].replace(/[+]/g, '\\+'), 'i').test(s)) {
      var after = s.replace(DI_ROLE, '').replace(/\b(STA|STD|STBY)\b[:\s]*\d{0,2}[:.]?\d{0,2}/gi, '').replace(/[\s:\-\d\.\(\)\/]/g, '');
      if (after.length < 3) { curR = rk[0].toUpperCase().replace(/\s+/g, ' '); return; }
    }
    // 3) บรรทัดชื่อ (มีเลขนำ หรือมีรหัสทีม)
    var num = s.match(/^\s*\d+\s*[\.\)]?\s*(.+)$/);
    var body = (num ? num[1] : s).trim(), role = curR;
    var irm = body.match(DI_ROLE);
    if (irm && new RegExp('^' + irm[0].replace(/[+]/g, '\\+'), 'i').test(body)) { role = irm[0].toUpperCase(); body = body.replace(DI_ROLE, '').replace(/^[\s:\-\.]+/, ''); }
    var parts = body.split(/[\/ ]+/).filter(Boolean), team = '';
    for (var i = parts.length - 1; i >= 0; i--) { if (DI_TEAMS.test(parts[i])) { team = parts[i].toUpperCase(); parts.splice(i, 1); break; } }
    var name = '';
    for (var j = 0; j < parts.length; j++) { var p = parts[j].toUpperCase().replace(/[^A-Z฀-๿].*$/, ''); if (p.length >= 3 && !DI_STOP.test(p)) { name = p; break; } }
    if ((num || team) && name && curF && !DI_STOP.test(name))
      out.push({ flight: curF, role: (role || '').replace(/\s+/g, ' ').trim(), name: name, team: team, time: curT });
  });
  return out;
}

// ─── DUTY "REQUEST" FORMAT (ทีมขอ N คน/ตำแหน่ง · ไม่มีชื่อ) → คำขอซัพให้ระบบคิดคน ───
/** "0820"/"08.20"/"08:20" → "08:20" */
function diTime_(s) { var m = String(s || '').match(/(\d{1,2})[:.]?(\d{2})/); return m ? (('0' + m[1]).slice(-2) + ':' + m[2]) : ''; }
/** ป้ายตำแหน่งจากข้อความ → phase (CI/SUP/GATE/ARR) หรือ null
 *  จับ "โทเคนบทบาทตัวแรก" เพื่อไม่ให้ลำดับผิด (เช่น ARR/G → ARR · GATE+BIR → GATE) และไม่ชนรหัสไฟลท์ (G9687) */
function dutyPhaseOf_(label) {
  var u = String(label || '').toUpperCase();
  var m = u.match(/CHECK\s*-?\s*IN|CHK[\s-]*IN|\bCKIN\b|\bCI\b|\bSUP\b|SPVR|\bSOD\b|SUPERVIS|\bARR\b|ARRIVAL|\bGATE\b|\bGTE\b|BOARD|\bG\b|\bCIQ\b|\bCRW\b|CREW|\bMEET\b|ASSIST|ASSIT|\bASST\b|\bIB\b|STBY|STAND\s*BY|\bTF\b|T\/F|\bBIR\b|รับเครื่อง|ESCORT/);
  if (!m) return null;
  var t = m[0];
  if (/^(CHECK|CHK|CKIN)/.test(t) || t === 'CI') return 'CI';
  if (/SUP|SPVR|SOD|SUPERVIS/.test(t)) return 'SUP';
  if (/GATE|GTE|BOARD/.test(t) || t === 'G') return 'GATE';                // GATE / GTE / G (คำเดี่ยว) — ไม่จับ G9687
  return 'ARR';                                                            // ARR/CIQ/CRW/MEET/ASST/IB/STBY/TF/BIR/ESCORT
}
var DI_FLT2 = /\b((?:[A-Z]{2}|[0-9][A-Z]|[A-Z][0-9])\d{2,4}(?:\s*\/\s*\d{2,4})?)/;   // \b กัน "TA1800" ใน "STA1800"
/** แตกข้อความ "คำขอซัพ" จาก Duty → [{flight, phase, n, win, sta, std, label}] (ป้อนเข้า slaManualSupportRows_) */
function dutyParseRequests_(text) {
  var out = [], curF = '', curSta = '', curStd = '', curWin = '', pending = null, fltFresh = false;
  function flush(def) { if (pending) { if (pending.n == null) pending.n = def || 1; out.push(pending); pending = null; } }
  String(text || '').split(/\n/).forEach(function (raw) {
    var s = raw.replace(/[🔺🔻▪️•]/g, '').trim(); if (!s) return;
    var wasFresh = fltFresh; fltFresh = false;   // fresh = บรรทัดก่อนเป็น "หัวไฟลท์เปล่า" → บรรทัดนี้ถ้าเป็นหัวไฟลท์สายเดียวกัน = ขาที่สองของ turnaround
    // ช่วงเวลาที่ระบุ "ขอคนช่วงเวลา 06.35 - 07.35" / "ขอ stand by ขาเข้า 07:40 - 09:10"
    if (/ขอคน|ช่วงเวลา|ช่วง\s*เวลา|STAND\s*BY|\bSTBY\b|\bSBY\b/i.test(s)) {
      var wm = s.match(/(\d{1,2}[:.]?\d{2})\s*[-–]\s*(\d{1,2}[:.]?\d{2})/);
      if (wm) { curWin = diTime_(wm[1]) + '-' + diTime_(wm[2]); return; }
    }
    // บรรทัดที่ "ขึ้นต้น" ด้วย standby เช่น "SBY AT GATE 1750" / "STBY 0740"
    //   · ถ้ามีตำแหน่งต่อท้าย (AT GATE) → เป็นคำขอตำแหน่งนั้น + เวลายืน  · ถ้าล้วนเวลา → แค่เวลาเริ่มยืน
    if (/^\s*(SBY|STBY|STAND\s*BY)\b/i.test(s.replace(/^[\-\s]*\d*[.)]?\s*/, ''))) {
      var one = s.match(/(\d{1,2}[:.]?\d{2})/);
      var sbyPh = dutyPhaseOf_(s.replace(/^\s*[\-\d.)\s]*(SBY|STBY|STAND\s*BY)\b/i, ''));
      if (sbyPh && curF) {
        flush(1);
        var sbyT = one ? diTime_(one[1]) : curSta;
        pending = { flight: curF, phase: sbyPh, n: null, win: sbyT ? (sbyT + (curStd ? '-' + curStd : '')) : curWin,
          sta: sbyT || curSta, std: curStd,
          label: s.replace(/\d{1,2}[:.]?\d{2}/g, '').replace(/^[\-\s]*/, '').trim().slice(0, 22) };
        return;
      }
      if (one) { curSta = diTime_(one[1]); if (pending && !pending.sta) pending.sta = curSta; }
      return;
    }
    // บรรทัดเวลาล้วน "STA.../STD..." (เช่น "STA1800/STD1855", "STA 08:10 / STD 09:00", "STA: 0845 STD: 1025")
    // จับก่อนหัวไฟลท์ กัน "STA1800" ถูกอ่านเป็นไฟลท์ "TA1800"
    if (/^\s*STA\b/i.test(s) || /^\s*STD\b/i.test(s) || /^\s*ETA\b/i.test(s)) {
      var m2 = s.match(/STA\D*(\d{1,2}[:.]?\d{2})\s*\/\s*(\d{1,2}[:.]?\d{2})/i);   // "STA 1240/1350" = STA + STD
      if (m2) { curSta = diTime_(m2[1]); curStd = diTime_(m2[2]);
        if (pending) { if (!pending.sta) pending.sta = curSta; if (!pending.std) pending.std = curStd; } return; }
      var sa = s.match(/STA\D*(\d{1,2}[:.]?\d{2})/i) || s.match(/ETA\D*(\d{1,2}[:.]?\d{2})/i);
      var sdd = s.match(/STD\D*(\d{1,2}[:.]?\d{2})/i);
      if (sa) curSta = diTime_(sa[1]); if (sdd) curStd = diTime_(sdd[1]);
      if (pending) { if (sa && !pending.sta) pending.sta = curSta; if (sdd && !pending.std) pending.std = curStd; }  // เติมเวลาให้คำขอที่เปิดค้าง
      return;
    }
    var fm = s.match(DI_FLT2);
    // "รบกวนขอ Support RY" / "ขอ Support EY" — สายไม่มีเลขไฟลท์ → ใช้รหัสสายเป็น pseudo-flight (คำขอไม่หลุดไปเกาะไฟลท์อื่น)
    if (!fm) { var supM = s.match(/SUPP?ORT\s+([A-Z]{2})\b/i); if (supM && dutyPhaseOf_(s) === null) { flush(1); curF = supM[1].toUpperCase(); curSta = ''; curStd = ''; curWin = ''; return; } }
    // หัวไฟลท์ = รหัสไฟลท์อยู่ "ต้นบรรทัด" (โทเคนแรก) — ครอบคลุมกรณีมีตำแหน่งต่อท้ายบรรทัดเดียวกัน เช่น "SU284/286 ARR+G"
    var fltAtStart = fm && /^\W*$/.test(s.slice(0, fm.index));
    if (fm && (fltAtStart || (dutyPhaseOf_(s) === null && /STA|STD|RON/i.test(s)))) {
      var fcode = fm[1].replace(/\s/g, '').toUpperCase();
      // ขาที่สองของ turnaround เดียวกัน — หัวไฟลท์เปล่า 2 บรรทัดติด สายเดียวกัน เช่น "PG271 STA.." แล้ว "PG272 STD.." → รวมเป็น "PG271/272"
      if (wasFresh && curF && curF.indexOf('/') < 0 && fcode.indexOf('/') < 0 && fcode.slice(0, 2) === curF.slice(0, 2)) {
        curF = curF + '/' + fcode.slice(2);
        var d2 = s.match(/STD\D*(\d{1,2}[:.]?\d{2})/i); if (d2) curStd = diTime_(d2[1]);
        var a2 = s.match(/STA\D*(\d{1,2}[:.]?\d{2})/i); if (a2 && !curSta) curSta = diTime_(a2[1]);
        fltFresh = true; return;
      }
      flush(1);
      curF = fcode;
      fltFresh = true;                                         // หัวไฟลท์เปล่า → พร้อมรวมขาที่สอง (จะถูกล้างเมื่อเจอตำแหน่ง/เวลา)
      curSta = ''; curStd = ''; curWin = '';                   // เริ่มไฟลท์ใหม่ → ล้างค่าเก่า (กันค่าค้างข้ามไฟลท์)
      var t = s.match(/STA\D*(\d{1,2}[:.]?\d{2})/i), d = s.match(/STD\D*(\d{1,2}[:.]?\d{2})/i);
      if (t) curSta = diTime_(t[1]); if (d) curStd = diTime_(d[1]);   // EY: STA/STD อยู่บรรทัดถัดไป → เติมทีหลัง
      // ตำแหน่งต่อท้ายหัวไฟลท์บรรทัดเดียวกัน (เช่น "SU284/286 ARR+G") → เปิดคำขอตำแหน่งแรกไว้ (รายละเอียดเวลา/เกทตามบรรทัดถัดไป)
      var rest = s.slice(fm.index + fm[0].length).replace(/^[\s\/]+/, '');
      var ph0 = dutyPhaseOf_(rest);
      if (ph0) {
        fltFresh = false;                                      // มีตำแหน่งในบรรทัดหัวไฟลท์ → ไม่ใช่หัวเปล่า → ห้ามรวมขาที่สอง
        var lSby0 = (rest.match(/(?:STBY|STAND\s*BY)\D*(\d{1,2}[:.]?\d{2})/i) || [])[1];
        pending = { flight: curF, phase: ph0, n: null,
          win: (lSby0 && curStd) ? (diTime_(lSby0) + '-' + curStd) : curWin,
          sta: curSta, std: curStd,
          label: rest.replace(/\(.*?\)/g, '').replace(/\b(STA|STD|STBY|STAND\s*BY|ETA)\b.*$/i, '').trim().slice(0, 22) };
      }
      return;
    }
    // STA | 0640  /  STD | 0925 (แยกบรรทัด) — เติมเวลาให้คำขอที่ยังเปิดค้างอยู่ด้วย (เช่น "SU284/286 ARR+G" แล้วบรรทัดถัดมา "STA 0830")
    var sm = s.match(/^STA\D*(\d{1,2}[:.]?\d{2})/i); if (sm) { curSta = diTime_(sm[1]); if (pending && !pending.sta) pending.sta = curSta; return; }
    var dm2 = s.match(/^STD\D*(\d{1,2}[:.]?\d{2})/i); if (dm2) { curStd = diTime_(dm2[1]); if (pending && !pending.std) pending.std = curStd; return; }
    // จำนวน (บรรทัดตัวเลขล้วน) → ให้ตำแหน่งที่ค้างอยู่
    if (/^\d{1,2}$/.test(s)) { if (pending) { pending.n = parseInt(s, 10) || 1; out.push(pending); pending = null; } return; }
    // ป้ายตำแหน่ง (ตัดเลขลำดับ/ขีดนำหน้า)
    var clean = s.replace(/^[\-\s]*\d+[.)]?\s*/, '').replace(/^[\-\s]+/, '');
    var ph = dutyPhaseOf_(clean);
    if (ph && curF) {
      flush(1);
      // เวลาฝังในบรรทัดตำแหน่งเอง เช่น "GATE STD 1035 stby 0900" / "ARR+G STA 0830"
      var lSta = (clean.match(/STA\D*(\d{1,2}[:.]?\d{2})/i) || [])[1];
      var lStd = (clean.match(/STD\D*(\d{1,2}[:.]?\d{2})/i) || [])[1];
      var lSby = (clean.match(/(?:STBY|STAND\s*BY)\D*(\d{1,2}[:.]?\d{2})/i) || [])[1];
      var lWin = curWin;
      if (lSby && lStd) lWin = diTime_(lSby) + '-' + diTime_(lStd);              // stby→STD = ช่วงงาน
      pending = { flight: curF, phase: ph, n: null, win: lWin,
        sta: lSta ? diTime_(lSta) : curSta, std: lStd ? diTime_(lStd) : curStd,
        label: clean.replace(/\(.*?\)/g, '').replace(/\b(STA|STD|STBY|STAND\s*BY|ETA)\b.*$/i, '').replace(/เครื่องลงเร็ว.*$/, '').trim().slice(0, 22) };
    }
  });
  flush(1);
  // ระบุชนิดเกทใน/นอกจากป้ายตำแหน่ง (GATE INT / GATE 83 DOM) → ให้หน้า Support แยกแสดง/จับคู่คนถูกชนิด
  out.forEach(function (r) {
    if (r.phase === 'GATE' && typeof slaGateType_ === 'function') {
      var g = slaGateType_(r.label); r.gtype = (g === 'I') ? 'INT' : (g === 'D' ? 'DOM' : '');
    }
  });
  return out;
}
/** เรียกจากปุ่มในแท็บ Support: แตกข้อความ Duty → JSON คำขอ (ให้ client ป้อนเข้าตารางคิดคน) */
function dutyRequestsJson(text) { try { return JSON.stringify(dutyParseRequests_(text)); } catch (e) { return '[]'; } }

/** ตรวจแต่ละรายการกับ roster วันนั้น → เติม {found, recTeam, bucket, shift, status} */
function dutyValidate_(res, ll, entries) {
  var people = {};
  function addP(team, r) {
    var fn = String(r.name || '').toUpperCase().split(/[\s(]/)[0]; if (fn.length < 3) return;
    var d = acDuty_(r);
    (people[fn] = people[fn] || []).push({ name: r.name, team: team, bucket: r.bucket, ds: d.ds, de: d.de, shift: r.shiftTime || r.shift, assigns: (r.assignments || []).map(function (a) { return a.flight; }).filter(Boolean) });
  }
  Object.keys(res.teams).forEach(function (t) { res.teams[t].records.forEach(function (r) { addP(t, r); }); });
  if (ll && ll.totals.staff > 0) Object.keys(ll.sections).forEach(function (s) { ll.sections[s].records.forEach(function (r) { addP('LL·' + s, r); }); });
  entries.forEach(function (e) {
    var cand = people[e.name];
    if (!cand) { e.status = '❓ ไม่พบชื่อใน roster'; e.found = false; return; }
    var rec = cand.filter(function (c) { return e.team && c.team.toUpperCase().indexOf(e.team) >= 0; })[0] || cand[0];
    e.found = true; e.recTeam = rec.team; e.bucket = rec.bucket; e.shift = rec.shift;
    var inSheet = rec.assigns.some(function (f) { return slaFlightKey_(f) === slaFlightKey_(e.flight) || String(f).toUpperCase().indexOf(e.flight) >= 0; });
    var st = [];
    if (rec.bucket === 'off') st.push('⛔ OFF');
    else if (rec.bucket !== 'working' && rec.bucket !== 'ot_off') st.push('⚠️ ' + rec.bucket);
    if (e.team && rec.team.toUpperCase().indexOf(e.team) < 0) st.push('ทีมไม่ตรง(' + rec.team + ')');
    st.push(inSheet ? '✅ มีในชีตแล้ว' : '📝 ยังไม่กรอกในชีต');
    e.inSheet = inSheet; e.status = st.join(' · ');
  });
  return entries;
}

/** Lazy: แปลงข้อความ Duty → ตารางพรีวิว (เรียกจากปุ่มในแท็บ Support) */
function rbDutyImportHtml(iso, text) {
  try {
    var entries = dutyParse_(text);
    var reqs = dutyParseRequests_(text);
    var d = rbLoadResLL_(rbDateFromIso_(iso));
    if (entries.length) dutyValidate_(d.res, d.ll, entries);
    // ข้อความ "ขอซัพ" (ระบุตำแหน่ง+จำนวน ไม่มีชื่อคนที่ตรง roster) → โชว์คำขอ + ปุ่มคิดคน แทนการเดาชื่อมั่ว
    var foundNames = entries.filter(function (e) { return e.found; }).length;
    if (reqs.length >= 1 && foundNames === 0) {
      var rb2 = reqs.map(function (q) {
        var win = q.win || ((q.sta || q.std) ? ((q.sta || '–') + '-' + (q.std || '–')) : '-');
        return '<tr><td class="b">' + rbEsc_(q.flight) + '</td><td>' + rbEsc_(SLA_PH_LB[q.phase] || q.phase) +
          (q.label ? ' <span class="muted">(' + rbEsc_(q.label) + ')</span>' : '') + '</td><td class="tnum">' + q.n +
          '</td><td class="tnum">' + rbEsc_(win) + '</td></tr>';
      }).join('');
      return '<div class="sectionlabel">ℹ️ ข้อความนี้เป็น <b>"คำขอซัพ"</b> (ตำแหน่ง+จำนวน ไม่มีชื่อคน) — แตกได้ <b class="okk">' + reqs.length +
        ' คำขอ</b><br><span class="muted">กดปุ่ม <b>➕ แตกคำขอ → คิดคนในตาราง</b> ด้านบน เพื่อให้ระบบจับคนว่างให้</span></div>' +
        '<div style="margin:6px 0"><button class="btn btn--accent" onclick="supDutyToRows()">➕ แตกคำขอ → คิดคนในตาราง</button></div>' +
        rbTblCard_('📥 คำขอซัพจาก Duty (พรีวิว)',
          '<tr><th>Flight</th><th>ตำแหน่ง</th><th>จำนวน</th><th>ช่วงเวลา</th></tr>', rb2, '');
    }
    if (!entries.length) return '<div class="panel muted" style="padding:14px">ไม่พบรายการในข้อความ — ถ้าเป็น "ขอซัพ" (ตำแหน่ง+จำนวน) กดปุ่ม <b>➕ แตกคำขอ → คิดคนในตาราง</b> · ถ้าเป็นลิสต์ชื่อคน ต้องมี "ไฟลท์ + ชื่อ" เช่น "1. PANISARA ZF"</div>';
    var notIn = entries.filter(function (e) { return e.found && !e.inSheet; }).length;
    var nf = entries.filter(function (e) { return !e.found; }).length;
    var body = entries.map(function (e) {
      var bad = !e.found || e.bucket === 'off' || (e.found && !e.inSheet);
      return '<tr class="' + (e.found && e.inSheet ? '' : 'rowbad') + '" data-team="' + rbEsc_(e.recTeam || e.team) + '"><td class="b">' + rbEsc_(e.flight) +
        '</td><td>' + rbEsc_(e.role) + '</td><td class="b">' + rbEsc_(e.name) + '</td><td>' + rbEsc_(e.team || e.recTeam || '') +
        '</td><td>' + rbEsc_(e.shift || '') + '</td><td>' + rbEsc_(e.time || '') + '</td><td>' + rbEsc_(e.status || '') + '</td></tr>';
    }).join('');
    var sum = '<div class="sectionlabel">แตกได้ <b>' + entries.length + '</b> รายการ · <b class="badd">' + notIn + '</b> ยังไม่กรอกในชีต' + (nf ? ' · <span class="badd">' + nf + ' ไม่พบชื่อ</span>' : '') +
      ' <span class="muted">— กด "📤 สร้างชีต" เพื่อออกเป็นไฟล์</span></div>';
    return sum + rbTblCard_('📥 ซัพจาก Duty (แตกจากข้อความ)',
      '<tr><th>Flight</th><th>ตำแหน่ง</th><th>ชื่อ</th><th>ทีม</th><th>กะ</th><th>เวลาไฟลท์</th><th>สถานะ</th></tr>', body, '');
  } catch (e) { return '<div class="panel">แปลงไม่ได้: ' + rbEsc_(e.message) + '</div>'; }
}

/** สร้างชีต Google จากข้อความ Duty → คืน URL */
function dutyExportSheet(iso, text) {
  var entries = dutyParse_(text);
  if (!entries.length) throw new Error('ไม่พบรายการซัพในข้อความ');
  try { var d = rbLoadResLL_(rbDateFromIso_(iso)); dutyValidate_(d.res, d.ll, entries); } catch (eV) {}
  var ss = rbCreateSheet_('Support Duty ' + iso);
  var sh = ss.getSheets()[0]; sh.setName('Support');
  var head = ['Flight', 'ตำแหน่ง', 'ชื่อ', 'ทีม', 'กะ', 'เวลาไฟลท์', 'สถานะ'];
  var rows = entries.map(function (e) { return [e.flight, e.role, e.name, e.team || e.recTeam || '', e.shift || '', e.time || '', e.status || '']; });
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#1f4e79').setFontColor('#fff');
  if (rows.length) sh.getRange(2, 1, rows.length, head.length).setValues(rows);
  sh.setFrozenRows(1);
  [90, 110, 130, 60, 110, 110, 200].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  return ss.getUrl();
}
