/**
 * MyWork.gs — หน้า "งานของฉัน" (พนักงานดูงานตัวเอง/ทีม ด้วยรหัส)
 * =============================================================================
 * กฎสิทธิ์ (ตาม 07-access-roles.md):
 *   • ดูย้อนหลังได้ทุกวัน
 *   • ดูล่วงหน้าได้แค่ "วันนี้ + 1" (พรุ่งนี้) เท่านั้น
 * เพดานบังคับ 2 ชั้น:
 *   1) แถบวันที่ — วันเกินพรุ่งนี้ทำเป็นปุ่มจาง กดไม่ได้ (disabled 🔒)
 *   2) ฝั่ง server — rbMyWorkHtml() clamp วันที่ที่เกินพรุ่งนี้ทิ้งเสมอ (กัน bypass ผ่านพารามิเตอร์)
 *
 * ใช้ข้อมูลจากฟังก์ชันเดิมของ PAS: rbLoadResLL_ (โหลดวัน) · rbPUCalc_ (Util รายคน)
 *   · helpers: rbDateFromIso_ / rbEsc_ / acFlightWin_ / acIsFlight_ / acIsJunkFlight_
 *
 * เรียกเป็น lazy tab:  loadMyWork(){ lazy("mwbox","rbMyWorkHtml","mw"); }
 *   rbMyWorkHtml(iso, empCode, startIso)
 *     iso      = วันที่เลือก (yyyy-MM-dd) · ว่าง = วันนี้
 *     empCode  = รหัสพนักงานที่อยากดู · ว่าง = ยังไม่เลือก (โชว์ช่องค้นหา)
 *     startIso = วันแรกของแถบ 7 วัน · ว่าง = (วันนี้-5) เพื่อให้แถบจบที่พรุ่งนี้พอดี
 *
 * ปุ่มทุกปุ่มเรียก google.script.run ในตัว (inline) + สลับ #mwRoot ด้วย outerHTML
 *   → ไม่ต้องแก้ JS ส่วนกลางของแอป (innerHTML ไม่รัน <script> ที่ฝังมา)
 */

var MW_PAST_PILLS = 5;   // จำนวนวันย้อนหลังที่โชว์ในแถบ (ที่เหลือ = วันนี้ + พรุ่งนี้)
var MW_WIN = 7;          // จำนวนปุ่มในแถบ

/** เขตเวลา + วันนี้/เพดาน (yyyy-MM-dd เทียบกันด้วย string ได้ตรง เพราะ zero-padded) */
function mwTz_() { return Session.getScriptTimeZone() || 'Asia/Bangkok'; }
function mwIso_(d) { return Utilities.formatDate(d, mwTz_(), 'yyyy-MM-dd'); }
function mwToday_() { return mwIso_(new Date()); }
function mwAddIso_(iso, n) { var d = rbDateFromIso_(iso); d.setDate(d.getDate() + n); return mwIso_(d); }
function mwCapIso_() { return mwAddIso_(mwToday_(), 1); }                 // เพดาน = วันนี้ + 1

var MW_WD = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
var MW_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
function mwThDate_(iso, withYear) {
  var d = rbDateFromIso_(iso);
  var s = MW_WD[d.getDay()] + ' ' + d.getDate() + ' ' + MW_MON[d.getMonth()];
  return withYear ? (s + ' ' + ((d.getFullYear() + 543) % 100)) : s;
}
function mwFmtMin_(m) {
  if (typeof rrFmtMin_ === 'function') return rrFmtMin_(m);
  m = ((m % 1440) + 1440) % 1440; return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2);
}

/** JS (inline) ที่เรียก rbMyWorkHtml แล้วสลับ #mwRoot — ใช้ single-quote ล้วน (วางใน onclick="…" ได้)
 *  isoE/codeE/startE = "นิพจน์ JS" (string หรือตัวแปร) เช่น "'2026-10-16'" หรือ "c" */
function mwCall_(isoE, codeE, startE) {
  return "if(window.google&&google.script&&google.script.run){" +
    "var r=document.getElementById('mwRoot');if(r)r.style.opacity='.5';" +
    "google.script.run.withSuccessHandler(function(h){var x=document.getElementById('mwRoot');if(x)x.outerHTML=h;})" +
    ".withFailureHandler(function(e){var x=document.getElementById('mwRoot');if(x)x.style.opacity='1';alert('โหลดไม่ได้: '+e.message);})" +
    ".rbMyWorkHtml(" + isoE + "," + codeE + "," + startE + ");" +
    "}else{alert('เปิดผ่าน Web App URL (/exec) เพื่อใช้งานส่วนนี้');}";
}
/** JS ค้นหาด้วยรหัสในช่อง #mwCode แล้วเรียกวันเดิม/แถบเดิม */
function mwSearchJs_(iso, startIso) {
  return "var el=document.getElementById('mwCode');var c=el?el.value.trim():'';" +
    "if(!c){alert('ใส่รหัสพนักงานก่อน');return;}" + mwCall_("'" + iso + "'", "c", "'" + (startIso || '') + "'");
}

/** ── หางานของคน 1 คนในวันนั้น (จาก res + ll) ── */
function mwFindPerson_(dd, empCode) {
  var hits = [];
  function scan(list, teamName) {
    (list || []).forEach(function (r) {
      if (empCode && String(r.id || '').trim() === String(empCode).trim()) hits.push({ r: r, team: r.team || teamName || '' });
    });
  }
  if (dd && dd.res && dd.res.teams) Object.keys(dd.res.teams).forEach(function (t) { scan(dd.res.teams[t].records, t); });
  if (dd && dd.ll && dd.ll.totals && dd.ll.totals.staff > 0 && dd.ll.sections)
    Object.keys(dd.ll.sections).forEach(function (s) { scan(dd.ll.sections[s].records, 'LL·' + s); });
  if (!hits.length) return null;
  // เลือกบล็อกที่มีข้อมูลมากสุด (กัน ID ซ้ำ บล็อกว่าง)
  function score(x) { return (x.r.assignments ? x.r.assignments.length : 0) + ((x.r.shiftTime && x.r.shiftTime !== '-') ? 2 : 0) + ((x.r.bucket === 'working' || x.r.bucket === 'ot_off') ? 1 : 0); }
  hits.sort(function (a, b) { return score(b) - score(a); });
  return hits[0];
}

/** ── งานไฟลท์/งานที่รับ ของ record ── */
function mwJobsOf_(r) {
  var WMAX = (typeof AC_WIN_MAX !== 'undefined') ? AC_WIN_MAX : 840;
  return (r.assignments || []).filter(function (x) {
    return x.flight && !(typeof acIsJunkFlight_ === 'function' && acIsJunkFlight_(x.flight));
  }).map(function (x) {
    var w = null; try { if (typeof acFlightWin_ === 'function') w = acFlightWin_(x); } catch (e) {}
    if (w && (w[1] - w[0]) > WMAX) w = null;
    var tm = w ? (mwFmtMin_(w[0]) + '–' + mwFmtMin_(w[1])) : '';
    var jb = x.task ? String(x.task).replace(/\s+/g, ' ').trim() : '';
    var real = (typeof acIsFlight_ === 'function') ? acIsFlight_(x.flight) : true;
    return { flight: x.flight, task: jb, time: tm, real: real };
  });
}

/** ── แถบวันที่ (คุมเพดานวันนี้+1) ── */
function mwStripHtml_(iso, empCode, startIso) {
  var cap = mwCapIso_();
  if (!startIso) startIso = mwAddIso_(mwToday_(), -MW_PAST_PILLS);   // ให้ปุ่มสุดท้าย = วันนี้+1 พอดี
  var prevStart = mwAddIso_(startIso, -MW_WIN);
  var nextStart = mwAddIso_(startIso, MW_WIN);
  var lastPill = mwAddIso_(startIso, MW_WIN - 1);
  var canNext = lastPill < cap;                                     // ยังมีวัน (≤เพดาน) ให้เลื่อนไปอีกไหม
  var ec = empCode ? String(empCode).replace(/'/g, '') : '';
  function go(toIso, toStart) { return mwCall_("'" + toIso + "'", ec ? ("'" + ec + "'") : "''", "'" + toStart + "'"); }

  var pills = '';
  for (var i = 0; i < MW_WIN; i++) {
    var dIso = mwAddIso_(startIso, i);
    var d = rbDateFromIso_(dIso);
    var locked = dIso > cap;                                        // เกินพรุ่งนี้ = ล็อก
    var sel = dIso === iso;
    var cls = 'mw-pill' + (sel ? ' mw-pill--on' : '') + (locked ? ' mw-pill--lock' : '');
    var attr = locked
      ? ' title="ยังไม่เปิดให้ดูล่วงหน้า (ดูได้ถึงพรุ่งนี้)" aria-disabled="true"'
      : ' onclick="' + go(dIso, startIso) + '"';
    pills += '<button class="' + cls + '"' + attr + '>' +
      '<span class="mw-pill__wd">' + MW_WD[d.getDay()] + '</span>' +
      '<span class="mw-pill__d">' + d.getDate() + '</span>' +
      '<span class="mw-pill__m">' + MW_MON[d.getMonth()] + '</span>' +
      (locked ? '<span class="mw-pill__lk">🔒</span>' : '') + '</button>';
  }
  var navPrev = '<button class="mw-nav" title="ย้อนหลัง" onclick="' + go(iso, prevStart) + '">‹</button>';
  var navNext = canNext
    ? '<button class="mw-nav" title="ถัดไป" onclick="' + go(iso, nextStart) + '">›</button>'
    : '<button class="mw-nav mw-nav--off" title="ดูล่วงหน้าได้ถึงพรุ่งนี้เท่านั้น" aria-disabled="true">›</button>';
  var todayBtn = '<button class="mw-today" onclick="' + go(mwToday_(), mwAddIso_(mwToday_(), -MW_PAST_PILLS)) + '">วันนี้</button>';

  return '<div class="mw-striprow">' +
    '<div class="mw-strip-hd"><b>' + mwThDate_(iso, true) + '</b>' + todayBtn + '</div>' +
    '<div class="mw-strip">' + navPrev + pills + navNext + '</div>' +
    '<div class="mw-note">ดูย้อนหลังได้ทุกวัน · ล่วงหน้าได้ถึง <b>พรุ่งนี้</b> (' + mwThDate_(cap, false) + ') เท่านั้น</div>' +
    '</div>';
}

/** ── การ์ดงานของคน ── */
function mwPersonHtml_(iso, empCode, hit) {
  if (!hit) {
    return '<div class="mw-card mw-empty">' +
      '<div class="mw-empty__ic">✈️</div>' +
      '<div class="mw-empty__t">ไม่พบงานของรหัส <b>' + rbEsc_(empCode || '-') + '</b> ในวันที่ ' + rbEsc_(mwThDate_(iso, false)) + '</div>' +
      '<div class="muted" style="font-size:12px;margin-top:4px">อาจยังไม่มีไฟล์เวรของวันนี้ หรือคนนี้ไม่ได้ขึ้นงาน — ลองเลือกวันอื่น หรือตรวจรหัส</div>' +
      '</div>';
  }
  var r = hit.r;
  var working = (r.bucket === 'working' || r.bucket === 'ot_off');
  var shiftTxt = (r.shiftTime && r.shiftTime !== '-') ? r.shiftTime : (working ? '(ไม่ระบุเวลา)' : '—');
  var shiftHrs = (typeof r.shiftHrs === 'number' && r.shiftHrs > 0) ? r.shiftHrs : null;
  var otHrs = (r.ot > 0) ? r.ot : 0;
  var otTag = otHrs > 0 ? (otHrs + 'h ' + (r.bucket === 'ot_off' ? 'OFF' : (r.otType === 'PRE' ? 'ก่อนกะ' : 'หลังกะ')) + (r.otTime ? ' (' + r.otTime + ')' : '')) : '';
  var pu = null; try { pu = (typeof rbPUCalc_ === 'function') ? rbPUCalc_(r) : null; } catch (e) {}
  var util = (pu && pu.dutyMin > 0) ? Math.round(pu.util * 100) : null;

  var bucketTh = { working: 'ขึ้นงาน', ot_off: 'OT (วันหยุด)', off: 'วันหยุด (OFF)', sick: 'ลาป่วย', leave: 'ลา' };
  var statusTxt = bucketTh[r.bucket] || (working ? 'ขึ้นงาน' : 'ไม่ขึ้นงาน');

  function kpi(val, label, color) {
    return '<div class="mw-kpi"><div class="mw-kpi__v" style="color:' + (color || '#1D428A') + '">' + val + '</div><div class="mw-kpi__l">' + label + '</div></div>';
  }
  var kpis = '<div class="mw-kpis">' +
    kpi(shiftHrs != null ? shiftHrs + '<small> ชม.</small>' : '—', 'ชม.กะ', '#1D428A') +
    kpi(otHrs > 0 ? otHrs + '<small> ชม.</small>' : '—', 'ชม. OT', otHrs > 0 ? '#b45309' : '#94a3b8') +
    kpi(util != null ? util + '<small>%</small>' : '—', 'Util (ติดงาน)', util == null ? '#94a3b8' : (util >= 70 ? '#1c7a4f' : (util >= 40 ? '#b45309' : '#c0392b'))) +
    '</div>';

  var jobs = working ? mwJobsOf_(r) : [];
  var jobRows = '';
  jobs.forEach(function (j) {
    jobRows += '<tr>' +
      '<td class="b">' + rbEsc_(j.flight) + (j.real ? '' : ' <span class="muted" style="font-size:11px">(งาน)</span>') + '</td>' +
      '<td>' + (j.time ? '<span class="tnum">' + rbEsc_(j.time) + '</span>' : '<span class="muted">—</span>') + '</td>' +
      '<td>' + (j.task ? rbEsc_(j.task) : '<span class="muted">—</span>') + '</td></tr>';
  });
  var jobsCard = '<div class="mw-card">' +
    '<div class="mw-card__hd"><b>งานที่ได้รับมอบหมาย</b><span class="mw-badge">' + jobs.length + ' งาน</span></div>' +
    (jobs.length
      ? '<table class="mw-tbl"><thead><tr><th>ไฟลท์/งาน</th><th>ช่วงเวลา</th><th>หน้าที่</th></tr></thead><tbody>' + jobRows + '</tbody></table>'
      : '<div class="mw-noflt">✈️ ' + (working ? 'ไม่มีไฟลท์/งานที่ระบุในวันนี้' : 'ไม่ขึ้นงานในวันนี้') + '</div>') +
    '</div>';

  var shiftCard = '<div class="mw-card">' +
    '<div class="mw-shift">' +
    '<div class="mw-shift__l"><div class="mw-shift__cap">กะของวันที่เลือก</div>' +
    '<div class="mw-shift__big">' + rbEsc_(shiftTxt) + '</div>' +
    '<div class="mw-shift__sub">' + rbEsc_(statusTxt) + (otTag ? ' · <span style="color:#b45309">OT ' + rbEsc_(otTag) + '</span>' : '') + '</div></div>' +
    kpis + '</div></div>';

  return shiftCard + jobsCard;
}

/** ── หน้า "งานของฉัน" (lazy tab) ── */
function rbMyWorkHtml(iso, empCode, startIso) {
  try {
    var cap = mwCapIso_();
    if (!iso) iso = mwToday_();
    if (iso > cap) iso = cap;                                       // ★ server guard: ห้ามเกินพรุ่งนี้ (กัน bypass)
    empCode = empCode ? String(empCode).trim() : '';

    var hit = null, loadErr = '';
    if (empCode) {
      try {
        var dd = rbLoadResLL_(rbDateFromIso_(iso));
        if (dd && dd.res) hit = mwFindPerson_(dd, empCode);
      } catch (e) { loadErr = e.message; }
    }

    var ecAttr = empCode.replace(/"/g, '');
    var header = '<div class="mw-top">' +
      '<div class="mw-top__ttl">✈️ งานของฉัน' + (hit ? ' — ' + rbEsc_(hit.r.name || '') : '') + '</div>' +
      (hit ? '<div class="mw-top__sub"><code>' + rbEsc_(hit.r.id || empCode) + '</code> · ' + rbEsc_(hit.team || '-') + (hit.r.pos ? ' · ' + rbEsc_(hit.r.pos) : '') + '</div>' : '') +
      '<div class="mw-search">' +
      '<input id="mwCode" class="mw-inp" placeholder="ใส่รหัสพนักงาน…" value="' + rbEsc_(ecAttr) + '" ' +
      'onkeydown="if(event.key===\'Enter\'){' + mwSearchJs_(iso, startIso) + '}">' +
      '<button class="mw-btn" onclick="' + mwSearchJs_(iso, startIso) + '">ดูงาน</button>' +
      '</div></div>';

    var body = empCode
      ? (loadErr
        ? '<div class="mw-card"><div class="muted">โหลดข้อมูลวันนี้ไม่ได้: ' + rbEsc_(loadErr) + '</div></div>'
        : mwPersonHtml_(iso, empCode, hit))
      : '<div class="mw-card mw-empty"><div class="mw-empty__ic">🔎</div><div class="mw-empty__t">พิมพ์รหัสพนักงานด้านบน แล้วกด “ดูงาน”</div>' +
        '<div class="muted" style="font-size:12px;margin-top:4px">ดูงานของตัวเองหรือเพื่อนร่วมทีมได้ — ย้อนหลังทุกวัน / ล่วงหน้าถึงพรุ่งนี้</div></div>';

    return '<div class="mw-wrap" id="mwRoot">' + mwCss_() +
      header + mwStripHtml_(iso, empCode, startIso) + body + '</div>';
  } catch (e) {
    return '<div class="panel">โหลดหน้า "งานของฉัน" ไม่ได้: ' + rbEsc_(e.message) + '</div>';
  }
}

/** CSS ของแท็บ */
function mwCss_() {
  return '<style>' +
    '.mw-wrap{max-width:860px;margin:0 auto;transition:opacity .15s}' +
    '.mw-top{background:linear-gradient(135deg,#102a56,#1D428A);color:#fff;border-radius:16px;padding:16px 18px;margin-bottom:14px}' +
    '.mw-top__ttl{font-size:20px;font-weight:800}' +
    '.mw-top__sub{opacity:.9;font-size:13px;margin-top:3px}.mw-top__sub code{background:rgba(255,255,255,.18);padding:1px 7px;border-radius:6px}' +
    '.mw-search{display:flex;gap:8px;margin-top:12px}' +
    '.mw-inp{flex:1;border:0;border-radius:10px;padding:9px 12px;font-size:14px}' +
    '.mw-btn{background:#38bdf8;color:#05233b;border:0;border-radius:10px;padding:9px 18px;font-weight:700;cursor:pointer}' +
    '.mw-striprow{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:12px;margin-bottom:14px}' +
    '.mw-strip-hd{display:flex;align-items:center;gap:10px;font-size:15px;color:#0f172a;margin-bottom:8px}' +
    '.mw-today{margin-left:auto;background:#eef2ff;color:#1D428A;border:1px solid #c7d2fe;border-radius:20px;padding:4px 14px;font-weight:600;cursor:pointer;font-size:12px}' +
    '.mw-strip{display:flex;gap:6px;align-items:stretch;overflow-x:auto}' +
    '.mw-pill{flex:1;min-width:56px;background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:12px;padding:8px 4px;cursor:pointer;text-align:center;position:relative;transition:.1s}' +
    '.mw-pill:hover{border-color:#94a3b8}' +
    '.mw-pill__wd{display:block;font-size:11px;color:#64748b}.mw-pill__d{display:block;font-size:20px;font-weight:800;color:#0f172a;line-height:1.1}.mw-pill__m{display:block;font-size:10px;color:#94a3b8}' +
    '.mw-pill--on{background:#1D428A;border-color:#1D428A}.mw-pill--on .mw-pill__wd,.mw-pill--on .mw-pill__d,.mw-pill--on .mw-pill__m{color:#fff}' +
    '.mw-pill--lock{background:#f1f5f9;border-style:dashed;border-color:#e2e8f0;cursor:not-allowed;opacity:.55}' +
    '.mw-pill--lock .mw-pill__d{color:#94a3b8}.mw-pill__lk{position:absolute;top:3px;right:5px;font-size:10px;opacity:.7}' +
    '.mw-nav{background:#fff;border:1.5px solid #e2e8f0;border-radius:10px;min-width:34px;font-size:20px;color:#1D428A;cursor:pointer}' +
    '.mw-nav--off{color:#cbd5e1;cursor:not-allowed}' +
    '.mw-note{font-size:11.5px;color:#64748b;margin-top:8px}' +
    '.mw-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:14px 16px;margin-bottom:14px}' +
    '.mw-card__hd{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:15px;color:#0f172a}' +
    '.mw-badge{margin-left:auto;background:#eef2ff;color:#1D428A;border-radius:20px;padding:2px 12px;font-size:12px;font-weight:700}' +
    '.mw-shift{display:flex;gap:16px;align-items:center;flex-wrap:wrap}' +
    '.mw-shift__l{flex:1;min-width:160px}.mw-shift__cap{font-size:12px;color:#64748b}.mw-shift__big{font-size:26px;font-weight:800;color:#1D428A;line-height:1.15}.mw-shift__sub{font-size:13px;color:#334155;margin-top:2px}' +
    '.mw-kpis{display:flex;gap:10px}.mw-kpi{text-align:center;min-width:72px}.mw-kpi__v{font-size:22px;font-weight:800}.mw-kpi__v small{font-size:12px;font-weight:600}.mw-kpi__l{font-size:11px;color:#64748b}' +
    '.mw-tbl{width:100%;border-collapse:collapse;font-size:13.5px}.mw-tbl th{text-align:left;color:#64748b;font-size:12px;border-bottom:2px solid #eef2f7;padding:6px 8px}.mw-tbl td{padding:7px 8px;border-bottom:1px solid #f1f5f9}' +
    '.mw-noflt{color:#64748b;text-align:center;padding:16px;font-size:13px}' +
    '.mw-empty{text-align:center;padding:26px}.mw-empty__ic{font-size:30px}.mw-empty__t{margin-top:8px;color:#0f172a;font-size:15px}' +
    '.mw-tbl .tnum,.tnum{font-variant-numeric:tabular-nums}' +
    '</style>';
}
