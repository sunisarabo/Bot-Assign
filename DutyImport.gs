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
    if (!entries.length) return '<div class="panel muted" style="padding:14px">ไม่พบรายการซัพในข้อความ — ตรวจรูปแบบ (ต้องมีเลขไฟลท์ + บรรทัดชื่อ เช่น "1. PANISARA ZF")</div>';
    var d = rbLoadResLL_(rbDateFromIso_(iso));
    dutyValidate_(d.res, d.ll, entries);
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
  var ss = SpreadsheetApp.create('Support Duty ' + iso);
  var sh = ss.getSheets()[0]; sh.setName('Support');
  var head = ['Flight', 'ตำแหน่ง', 'ชื่อ', 'ทีม', 'กะ', 'เวลาไฟลท์', 'สถานะ'];
  var rows = entries.map(function (e) { return [e.flight, e.role, e.name, e.team || e.recTeam || '', e.shift || '', e.time || '', e.status || '']; });
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#1f4e79').setFontColor('#fff');
  if (rows.length) sh.getRange(2, 1, rows.length, head.length).setValues(rows);
  sh.setFrozenRows(1);
  [90, 110, 130, 60, 110, 110, 200].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  return ss.getUrl();
}
