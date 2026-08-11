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
  var m = u.match(/CHECK\s*-?\s*IN|CHK[\s-]*IN|\bCKIN\b|\bCI\b|\bCT\d+|\bCS\b|\bSUP\b|SPVR|\bSOD\b|SUPERVIS|\bRELEASE\b|\bFLT\s*RL\b|\bRF\b|ปล่อยเครื่อง|\bARR\b|ARRIVAL|\bGATE\b|\bGTE\b|BOARD|\bG\b|\bCIQ\b|\bCRW\b|CREW|\bMEET\b|ASSIST|ASSIT|\bASST\b|\bIB\b|STBY|STAND\s*BY|\bTF\b|T\/F|\bBIR\b|รับเครื่อง|ESCORT/);
  if (!m) return null;
  var t = m[0];
  if (t === 'RF' || /RELEASE|FLT\s*RL|ปล่อยเครื่อง/.test(t)) return 'RF';   // ปล่อยเครื่อง (release) — หาคนแบบเกท แสดงป้าย RF
  if (/^(CHECK|CHK|CKIN|CT\d|CS)/.test(t) || t === 'CI') return 'CI';       // CTn = เคาน์เตอร์ · CS = check-in support
  if (/SUP|SPVR|SOD|SUPERVIS/.test(t)) return 'SUP';
  if (/GATE|GTE|BOARD/.test(t) || t === 'G') return 'GATE';                // GATE / GTE / G (คำเดี่ยว) — ไม่จับ G9687
  return 'ARR';                                                            // ARR/CIQ/CRW/MEET/ASST/IB/STBY/TF/BIR/ESCORT
}
var DI_FLT2 = /\b((?:[A-Z]{2}|[0-9][A-Z]|[A-Z][0-9])\d{2,4}(?:\s*\/\s*(?:[A-Z]{2}|[0-9][A-Z]|[A-Z][0-9])?\d{2,4})?)/;   // \b กัน "TA1800" · ขาที่สองมี/ไม่มีรหัสสาย (9C8771/9C8772 · PG271/272)
// ─── ตรวจ "ชื่อคนที่ถูกจัดไว้แล้ว" ในคำขอ (Duty เติมสีเทา / ทีมใส่ชื่อเอง) → สล็อตนั้น "มีคนแล้ว" ไม่ต้องแนะนำ ───
var DI_NAME_STOP = /^(GATE|GTE|ARR|ARRIVAL|INT|INTER|DOM|TRANSFER|TF|AGENT|SPVR|SUP|SOD|SUPERVISOR|SUPERVIS|CHK|CHECK|CKIN|CIN|IN|OUT|CS|CT|CRW|CREW|RF|RL|RELEASE|STBY|SBY|STAND|BY|ASST|ASSIT|ASSIST|CIQ|BIR|MEET|ESCORT|ONLY|LAST|OPEN|CLOSE|CLS|BRIEF|COUNTER|CTC|CTR|AND|OR|OB|IB|G|GA|AC|CI|BOARD|SUPPORT|SUPPOT|ปล่อยเครื่อง|เดินเอกสาร|ส่ง|ขอ|คน)$/i;
/** โทเคนนี้เป็น "ชื่อคน" ไหม (ไม่ใช่คำตำแหน่ง/ตัวเลข) */
function diName_(tok) { return !!tok && !DI_NAME_STOP.test(tok) && !/^\d+[:.]?\d*$/.test(tok) && /[A-Za-z฀-๿]/.test(tok) && tok.length >= 2; }
/** สล็อตนี้ "ว่าง/ยังไม่จัด" ไหม — "X"/ว่าง/ไม่มีตัวอักษร = ว่าง (ต้องหาคน) */
function diSlotOpen_(txt) { var s = String(txt || '').replace(/\(.*?\)/g, '').trim(); return /^x\b/i.test(s) || !/[A-Za-z฀-๿]/.test(s); }
/** ดึงชื่อคนหลัง ":"/"::" — "GATE : Suthita QR"→"Suthita QR" · "CRW/GA:: Chutharat PV"→"Chutharat PV" · "SPVR/G : X"→'' · "GATE INT"→'' */
function diAssignedName_(txt) {
  var s = String(txt || '').replace(/\(.*?\)/g, '').trim();
  var ci = s.search(/:/); if (ci < 0) return '';
  var tail = s.slice(ci).replace(/^:+/, '').trim();
  if (!tail || /^x\b/i.test(tail)) return '';
  var nameW = tail.split(/[\s,\/·]+/).filter(Boolean).filter(diName_);
  return nameW.length ? nameW.join(' ').slice(0, 26) : '';
}
/** แตกข้อความ "คำขอซัพ" จาก Duty → [{flight, phase, n, win, sta, std, label}] (ป้อนเข้า slaManualSupportRows_) */
function dutyParseRequests_(text) {
  var out = [], curF = '', curSta = '', curStd = '', curWin = '', pending = null, fltFresh = false, rfMode = false;
  function flush(def) {
    if (!pending) return;
    var names = (pending.names || []).slice();
    if (pending.inlineName) names.unshift(pending.inlineName);
    var xCount = (pending.xCount || 0) + (pending.inlineX ? 1 : 0);
    var total = Math.max(pending.nExplicit || 0, names.length + xCount, def || 1, pending.n || 0);
    pending.n = total;                                   // จำนวนที่ขอทั้งหมด
    pending.open = names.length === 0 ? total : (xCount + Math.max(0, total - names.length - xCount));  // ยังต้องหาคนกี่คน
    pending.assigned = names.join(', ');                 // ชื่อที่จัดไว้แล้ว (Duty/ทีม)
    out.push(pending); pending = null;
  }
  String(text || '').split(/\n/).forEach(function (raw) {
    // ตัด emoji/ธงชาติ (🇮🇳🇦🇺...) ออกทั้งบรรทัด — กันธงหน้าเลขไฟลท์ทำให้จับหัวไฟลท์ไม่ติด
    var s = String(raw).replace(/[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️‍•▪]/gu, '').trim();
    if (!s) return;
    if (/^(เนื่องจาก|หมายเหตุ|\*?LACK OF|remark\b|note\b)/i.test(s)) return;   // บรรทัดหมายเหตุ ไม่ใช่คำขอ
    var wasFresh = fltFresh; fltFresh = false;   // fresh = บรรทัดก่อนเป็น "หัวไฟลท์เปล่า" → บรรทัดนี้ถ้าเป็นหัวไฟลท์สายเดียวกัน = ขาที่สองของ turnaround
    // หัวข้อ "ขอซัพปล่อยเครื่อง (RF)" — ตั้งโหมด RF ให้ไฟลท์ถัดไป (บรรทัด "SU285 CTC CTR G11 (0950)" ไม่มีคำตำแหน่งปกติ)
    if (!s.match(DI_FLT2) && /ปล่อยเครื่อง|\(RF\)|\bRELEASE\b|\bFLT\s*RL\b/i.test(s)) { rfMode = true; return; }
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
          inlineName: diAssignedName_(s), inlineX: /:\s*x\b/i.test(s),
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
    // เวลาเปิด-ปิดเคาน์เตอร์ "OP05:50 CL08:05" / "( OP 1805 CL 2005 )" → ช่วงเวลา (กัน "OP05" ถูกอ่านเป็นไฟลท์ 9C หาย)
    var opcl = s.match(/\bOP\s*[:.]?\s*(\d{1,2}[:.]?\d{2})\D+CL\s*[:.]?\s*(\d{1,2}[:.]?\d{2})/i);
    if (opcl) { curWin = diTime_(opcl[1]) + '-' + diTime_(opcl[2]); if (pending && !pending.win) pending.win = curWin; return; }
    var fm = s.match(DI_FLT2);
    // "รบกวนขอ Support RY" / "ขอ Support EY" — สายไม่มีเลขไฟลท์ → ใช้รหัสสายเป็น pseudo-flight (คำขอไม่หลุดไปเกาะไฟลท์อื่น)
    if (!fm) { var supM = s.match(/SUPP?ORT\s+([A-Z]{2})\b/i); if (supM && dutyPhaseOf_(s) === null) { flush(1); curF = supM[1].toUpperCase(); curSta = ''; curStd = ''; curWin = ''; return; } }
    // หัวข้อทีม "SU รบกวนขอซัพพอต 15JAN26" / "W5 รบกวนขอซัพพอต" / "PG รบกวนขอซัพพอร์ต" — รหัสสายต้นบรรทัด → pseudo-flight (คำขอที่ไม่มีเลขไฟลท์ไม่หลุดไปเกาะไฟลท์ก่อนหน้า)
    if (!fm) { var thM = s.match(/^\s*([A-Z][A-Z0-9])\s+(?:รบกวน|ขอ\s*ซัพ|ขอ\s*support)/i); if (thM && dutyPhaseOf_(s) === null) { flush(1); curF = thM[1].toUpperCase(); curSta = ''; curStd = ''; curWin = ''; fltFresh = false; return; } }
    // หัวไฟลท์ = รหัสไฟลท์อยู่ "ต้นบรรทัด" — รองรับเลขลำดับนำหน้า เช่น "1.9C8771/9C8772" (ไม่งั้นไฟลท์หลุด)
    var fltAtStart = fm && /^[\s\-]*\d{0,2}[.)]?\s*$/.test(s.slice(0, fm.index));
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
          inlineName: diAssignedName_(rest), inlineX: /:\s*x\b/i.test(rest),
          label: rest.replace(/\(.*?\)/g, '').replace(/\b(STA|STD|STBY|STAND\s*BY|ETA)\b.*$/i, '').trim().slice(0, 22) };
      } else if (rfMode) {                                     // โหมดปล่อยเครื่อง — "SU285 CTC CTR G11 (0950)" → คำขอ RF
        fltFresh = false; rfMode = false;
        var rfT = (rest.match(/(\d{1,2}[:.]?\d{2})/) || [])[1];
        pending = { flight: curF, phase: 'RF', n: null,
          win: rfT ? (diTime_(rfT) + (curStd ? '-' + curStd : '')) : curWin,
          sta: rfT ? diTime_(rfT) : curSta, std: curStd,
          inlineName: diAssignedName_(rest), inlineX: /:\s*x\b/i.test(rest),
          label: (rest.replace(/\(.*?\)/g, '').replace(/\d{1,2}[:.]?\d{2}/g, '').trim().slice(0, 22) || 'ปล่อยเครื่อง') };
      }
      return;
    }
    // STA | 0640  /  STD | 0925 (แยกบรรทัด) — เติมเวลาให้คำขอที่ยังเปิดค้างอยู่ด้วย (เช่น "SU284/286 ARR+G" แล้วบรรทัดถัดมา "STA 0830")
    var sm = s.match(/^STA\D*(\d{1,2}[:.]?\d{2})/i); if (sm) { curSta = diTime_(sm[1]); if (pending && !pending.sta) pending.sta = curSta; return; }
    var dm2 = s.match(/^STD\D*(\d{1,2}[:.]?\d{2})/i); if (dm2) { curStd = diTime_(dm2[1]); if (pending && !pending.std) pending.std = curStd; return; }
    // เลขลำดับคน "3" หรือ "3 SUBAIDA ZF" ใต้ตำแหน่ง → นับจำนวนที่ขอ (เลขมากสุด) ยังไม่ push รอตำแหน่ง/ไฟลท์ถัดไป
    // (ยกเว้นเลข+ตำแหน่ง เช่น "2.ARR" = ตำแหน่งใหม่ → ปล่อยให้ handler ตำแหน่งจัดการ)
    var numLead = s.match(/^\s*(\d{1,2})[.)]?\s*(.*)$/);
    if (numLead && pending && !DI_FLT2.test(s) && dutyPhaseOf_(numLead[2] || '') === null) {
      var ni = +numLead[1]; if (ni >= 1 && ni <= 20) pending.nExplicit = Math.max(pending.nExplicit || 0, ni);
      var slot = String(numLead[2] || '').replace(/\(.*?\)/g, '').trim();   // "X"/ว่าง = ยังไม่จัด · "WASSANA SV" = จัดแล้ว
      if (diSlotOpen_(slot)) pending.xCount = (pending.xCount || 0) + 1;
      else { (pending.names = pending.names || []).push(slot.slice(0, 26)); }
      return;
    }
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
      if (lSby) lWin = diTime_(lSby) + '-' + (lStd ? diTime_(lStd) : (curStd || ''));   // stby→STD = ช่วงยืน (STD จากบรรทัดหรือหัวไฟลท์)
      pending = { flight: curF, phase: ph, n: null, win: lWin,
        sta: lSta ? diTime_(lSta) : curSta, std: lStd ? diTime_(lStd) : curStd,
        inlineName: diAssignedName_(clean), inlineX: /:\s*x\b/i.test(clean),   // "GATE : Suthita QR" = จัดแล้ว · "SPVR/G : X" = ว่าง
        label: clean.replace(/\(.*?\)/g, '').replace(/\b(STA|STD|STBY|STAND\s*BY|ETA)\b.*$/i, '').replace(/เครื่องลงเร็ว.*$/, '').trim().slice(0, 22) };
    }
  });
  flush(1);
  // "CTC CTR G11 (STBY..)" = เคาน์เตอร์ติดต่อของงานเดินเอกสาร (RF) ไม่ใช่คำขอ ARR — ตัดทิ้ง (แถว RF ที่ตามมาถูกจับแล้ว)
  out = out.filter(function (r) { return !(r.phase === 'ARR' && /\bCTC\b/i.test(r.label || '')); });
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

// ─── RQ SUPPORT: อ่าน "ไฟล์รวมคำร้องขอซัพ" (แท็บวันที่ = ข้อความไลน์) → หาคนซัพ (แยกจาก SLA) ───
var RQ_SHEET_ID = '1tOsBEK8UQGkV_T5rSLgxmlf7SYQYUFbW8je8vXWCXkU';   // ← ID ไฟล์รวม RQ Support (เว้นว่าง = ปิด) · Script Property 'RQ_SHEET_ID' จะ override ค่านี้ถ้าตั้งไว้
function rqSheetId_() {
  try { var v = PropertiesService.getScriptProperties().getProperty('RQ_SHEET_ID'); if (v) return String(v).trim(); } catch (e) {}
  return RQ_SHEET_ID;
}
/** หาแท็บวันที่ในไฟล์ RQ — รองรับชื่อมั่ว "15jan"/"22 JUL"/"16Jan26"/"1 DEC25"/"9 MAR" (ตัดช่องว่าง+ปี) */
function rqFindDateTab_(ss, date) {
  var mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][date.getMonth()];
  var dd = date.getDate();
  var want = [String(dd) + mon, ('0' + dd).slice(-2) + mon];   // "15JAN" / "15JAN"
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var nm = sheets[i].getName().toUpperCase().replace(/\s+/g, '').replace(/(20)?2[0-9]$/, '');   // ตัดช่องว่าง + ปี (26/2026)
    if (want.indexOf(nm) >= 0) return sheets[i];
  }
  return null;
}
/** อ่านข้อความคำร้องจากแท็บวันนั้น (คอลัมน์ A + B ที่มีชื่อจริง) → string */
function rqReadText_(ss, date) {
  var sh = rqFindDateTab_(ss, date);
  if (!sh) return null;
  var last = sh.getLastRow(); if (last < 1) return '';
  var vals = sh.getRange(1, 1, last, Math.min(2, sh.getLastColumn())).getValues();
  return vals.map(function (r) {
    var a = r[0] == null ? '' : String(r[0]).trim();
    var b = (r.length > 1 && r[1] != null) ? String(r[1]).trim() : '';
    return (b && b !== a) ? b : a;   // มีคอลัมน์ B (เวอร์ชันเติมชื่อจริง) → ใช้ B
  }).join('\n');
}
// ─── อ่านคำร้องจาก Gmail (บัญชีที่รันสคริปต์) ───
var RQ_GMAIL_QUERY = '';   // Script Property 'RQ_GMAIL_QUERY' — คำค้น Gmail เช่น "subject:(ขอซัพพอร์ต) newer_than:3d" (เว้นว่าง = ปิด)
function rqGmailQuery_() { try { var v = PropertiesService.getScriptProperties().getProperty('RQ_GMAIL_QUERY'); if (v) return String(v).trim(); } catch (e) {} return RQ_GMAIL_QUERY; }
/** อ่านอีเมลคำร้องขอซัพจาก Gmail ของ "บัญชีที่รันสคริปต์" → ข้อความรวม (เลือกเมลที่กล่าวถึงวันเป้าหมาย หรือรับใกล้วันนั้น ±2 วัน) */
function rqReadGmail_(date) {
  var q = rqGmailQuery_(); if (!q || typeof GmailApp === 'undefined') return '';
  var MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  var dd = date.getDate(), dRe = new RegExp('\\b0?' + dd + '\\s*[\\/\\-\\s]?\\s*(' + MON[date.getMonth()] + '|' + (date.getMonth() + 1) + ')\\b', 'i');
  var out = [];
  try {
    GmailApp.search(q, 0, 40).forEach(function (th) {
      th.getMessages().forEach(function (m) {
        var subj = m.getSubject() || '', body = m.getPlainBody() || '';
        if (dRe.test(subj) || dRe.test(body.slice(0, 500)) || Math.abs(m.getDate().getTime() - date.getTime()) < 2 * 86400000)
          out.push(subj + '\n' + body);
      });
    });
  } catch (e) {}
  return out.join('\n\n———\n\n');
}
/** เลือกทางเลือก k คน + บังคับมีคน "นอก PVT/LP" อย่างน้อย 1 (ถ้ามี) — เห็น charter/ทีมอื่นชัดขึ้น */
function rqAltPick_(cands, k) {
  var isLP = function (c) { return /PVT\s*\/?\s*LP|PVTLP/i.test(String(c.team || '')); };
  var out = cands.slice(0, k);
  if (out.length && out.every(isLP)) {                         // ทางเลือกบน ๆ เป็น PVT/LP ล้วน → สลับคนสุดท้ายเป็นคนนอก LP คนแรกที่หาเจอ
    var nonLP = cands.filter(function (c) { return !isLP(c); })[0];
    if (nonLP && out.indexOf(nonLP) < 0) out[out.length - 1] = nonLP;
  }
  return out;
}
/** Lazy view: 🆘 หาซัพจากคำร้องจริง (ไฟล์ RQ + Gmail) — แยกจาก SLA */
function rqFindSupport(iso, showAlt) {
  try {
    showAlt = (showAlt === true || showAlt === 1 || showAlt === '1' || showAlt === 'true');
    var date = iso ? rbDateFromIso_(iso) : new Date();
    var text = '', srcs = [], rqSet = !!rqSheetId_(), rqOpened = false, rqHasTab = false;
    if (rqSet) {
      try {
        var ss = SpreadsheetApp.openById(rqSheetId_()); rqOpened = true;
        if (typeof rqFindDateTab_ === 'function' && rqFindDateTab_(ss, date)) rqHasTab = true;
        var t = rqReadText_(ss, date); if (t) { text += t + '\n'; srcs.push('ไฟล์ RQ'); }
      } catch (eS) {}
    }
    var gm = rqReadGmail_(date); if (gm) { text += '\n' + gm; srcs.push('Gmail'); }
    if (!text.trim()) {
      var ddmon = ('0' + date.getDate()).slice(-2) + ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][date.getMonth()];
      var msg = !rqSet ? 'ยังไม่ได้ตั้งไฟล์รวมคำร้อง — ตั้ง <b>RQ_SHEET_ID</b> หรือ <b>RQ_GMAIL_QUERY</b>'
        : !rqOpened ? 'เปิดไฟล์ RQ ไม่ได้ — แชร์ไฟล์ให้บัญชีที่รันสคริปต์ (<b>hktadminpsa@aotga.com</b>)'
        : !rqHasTab ? ('ยังไม่มีแท็บวันที่ <b>' + ddmon + '</b> ในไฟล์ RQ — ยังไม่มีคำร้องของวันนี้ (หรือชื่อแท็บไม่ตรง · ต้องเป็น DDMON เช่น ' + ddmon + ')')
        : ('แท็บวันที่ <b>' + ddmon + '</b> มีอยู่ แต่ยังไม่มีข้อความคำร้อง');
      return '<div class="panel" style="padding:22px"><b>ยังไม่มีคำร้องของวันนี้</b><br><span class="muted">' + msg + '</span></div>';
    }
    var reqs = dutyParseRequests_(text);
    if (!reqs.length) return '<div class="panel muted" style="padding:22px">มีข้อความจาก ' + rbEsc_(srcs.join('+')) + ' แต่แตกเป็นคำร้องไม่ได้ (ตรวจรูปแบบ)</div>';
    var d, noRoster = false;
    try { d = rbLoadResLL_(date); }                            // roster วันนั้นเปิดไม่ได้ (วันอนาคต/ยังไม่แชร์) → ยังโชว์คำร้องได้ แค่ไม่จับคู่คนว่าง
    catch (eR) { noRoster = true; d = { res: { teams: {} }, ll: { totals: { staff: 0 }, sections: {} } }; }
    var rows = slaManualSupportRows_(d.res, d.ll, reqs, showAlt);
    var nOpen = 0, nCov = 0;
    var body = rows.map(function (r) {
      var who;
      if (r.covered) {
        nCov++; who = '<span class="okk">✅ จัดแล้ว' + (r.assigned ? ': <b>' + rbEsc_(r.assigned) + '</b>' : '') + '</span>';
        if (showAlt && r.cands && r.cands.length)                 // โหมดเสนอทางเลือก: โชว์ตัวสำรอง 3 คน (บังคับมีคนนอก PVT/LP ≥1) เผื่อคนที่จัดไว้ติด OFF/เวลาไม่ครอบ
          who += '<br><span class="muted">↳ ทางเลือก: ' + rqAltPick_(r.cands, 3).map(function (c) { return rbEsc_(c.name) + ' <span class="muted">' + rbEsc_(c.team) + (c.off ? ' ⛱️OFF' : (c.rest ? ' 😴' : '')) + ' · ' + (c.n || 0) + ' ไฟลท์</span>'; }).join(' · ') + '</span>';
      }
      else {
        nOpen++;
        who = r.cands && r.cands.length
          ? r.cands.slice(0, Math.max(1, r.shortN)).map(function (c) { return '<b>' + rbEsc_(c.name) + '</b> <span class="muted">' + rbEsc_(c.team) + (c.off ? ' ⛱️OFF' : (c.rest ? ' 😴' : '')) + ' · ' + rbEsc_(c.shift || '') + ' · ' + (c.n || 0) + ' ไฟลท์</span>'; }).join('<br>')
          : '<span class="badd">' + (r.block ? '🚫 ' + rbEsc_(r.block)
              : (r.noFlightTime ? '⚠️ ยังไม่กรอกเวลาไฟลท์ (STA/STD) — เติมก่อนจึงหาคนได้'
              : (r.needSys ? 'ไม่มีคนว่างที่รู้ระบบ ' + rbEsc_(r.needSys) : 'ไม่มีคนว่าง'))) + '</span>';
        if (r.assigned) who = '<span class="muted">จัดแล้ว: ' + rbEsc_(r.assigned) + ' · ขออีก ' + r.shortN + '</span><br>' + who;   // จัดบางส่วน
      }
      var ask = r.covered ? ('มี ' + (r.reqN || 1) + ' คน') : ('ขออีก ' + r.shortN + (r.reqN > r.shortN ? '/' + r.reqN : ''));
      var winCell = rbEsc_(r.win || '-') + (r.winFb ? ' <span class="muted" title="ประเมินจากเวลาไฟลท์ (OP/CL หรือ STD ไม่ครบ)">≈</span>' : '');
      return '<tr' + (r.covered ? ' style="opacity:.62"' : '') + '><td class="b">' + rbEsc_(r.flight) + '</td><td>' + rbEsc_(r.airline) + '</td><td>' + rbEsc_(r.system || '-') +
        '</td><td>' + rbEsc_(r.phase) + (r.gtype ? ' <b>' + rbEsc_(r.gtype) + '</b>' : '') + ' ' + ask +
        (r.label ? ' <span class="muted">(' + rbEsc_(r.label) + ')</span>' : '') + '</td><td class="tnum">' + winCell + '</td><td>' + who + '</td></tr>';
    }).join('');
    var warn = noRoster ? '<div class="panel" style="padding:10px 14px;background:#fff7e6;border-left:4px solid #fec909;margin-bottom:8px">⚠️ เปิด roster ของวันนี้ไม่ได้ (วันอนาคต หรือยังไม่แชร์ไฟล์) — แสดง<b>คำร้อง</b>ได้ แต่ยัง<b>ไม่ได้จับคู่คนว่าง</b></div>' : '';
    var altBtn = '<div style="margin:6px 0"><button class="btn" onclick="rqReload(' + (showAlt ? '0' : '1') + ')">' +
      (showAlt ? '🙈 ซ่อนทางเลือก' : '🔁 เสนอทางเลือกแม้จัดแล้ว') + '</button>' +
      (showAlt ? ' <span class="muted">— แสดงตัวสำรองต่อท้ายแถวที่จัดแล้ว (เผื่อคนเดิมติด OFF/เวลาไม่ครอบ)</span>' : '') + '</div>';
    return warn + '<div class="sectionlabel">🆘 หาซัพจาก <b>' + rbEsc_(srcs.join(' + ')) + '</b> (คำร้องจริงจากทีม) — แตกได้ <b class="okk">' + reqs.length + ' คำร้อง</b> · <b class="badd">' + nOpen + '</b> ยังต้องหาคน · <b class="okk">' + nCov + '</b> จัดแล้ว <span class="muted">· คนละชุดกับ SLA (อิงที่ทีมขอมาจริง)</span></div>' + altBtn +
      rbTblCard_('🆘 คำร้องขอซัพ + คนที่แนะนำ', '<tr><th>Flight</th><th>สาย</th><th>ระบบ</th><th>ตำแหน่งที่ขอ</th><th>ช่วงเวลา</th><th>คนที่แนะนำ (ว่าง · รู้ระบบ)</th></tr>', body, '');
  } catch (e) { return '<div class="panel" style="padding:20px">หาซัพจาก RQ ไม่ได้: ' + rbEsc_(e.message) + '</div>'; }
}
