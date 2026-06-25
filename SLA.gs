/**
 * SLA.gs — airline SLA (service level) staffing check + daily flight list.
 * =============================================================================
 * For each flight in the day's roster it counts how many staff were assigned to
 * each phase (Supervisor / Check-in / Gate / Arrival) and compares against the
 * airline SLA requirement, flagging shortages (which phase, how many short) =
 * the "support needed" check. (Renamed from the old SOP_* naming to SLA_*.)
 *
 * Requires RosterReader.gs (res = readRosterFromSpreadsheet()).
 */

// ── Airline SLA: timing offsets (นาที รอบ STD = เวลาออก) + required headcount per role/phase ──
// roles: [name, count, code, phase]  · phase = ALL(SUP) / CI / ARR / GATE
// ci    = check-in เปิด ก่อน STD (เช่น -180 = 3 ชม.)   · cc = check-in ปิด ก่อน STD (เช่น -60 = 1 ชม.)
// go    = gate open ก่อน STD (เช่น -45)                · lc = boarding/last call ก่อน STD
// brief = บรีฟเริ่ม ก่อนเวลาเปิด check-in (นาที)        · post = งาน post-flight หลัง STD/STA (นาที) — มีทุกสาย
// total = จำนวนพนักงานทั้งหมด · เวลาเปิดเคาน์เตอร์ใช้ OP ในชีตก่อน ถ้าไม่มีจึงใช้ STD+ci
// post-flight ใช้ค่า post รายสาย (full-service 30 / LCC 20) · SLA_POST = ค่า fallback กรณีสายไม่มี post
var SLA_POST = 20;   // fallback post-flight (นาที) เมื่อสายการบินไม่มีฟิลด์ post
var SLA_TRANSIT_MIN = 30;   // เวลาเดินทาง/เปลี่ยนงานต่อไฟลท์ขั้นต่ำ (นาที) — กันเสนอคนไปช่วยไฟลท์อื่นชิดเกินไป (ต้องมีช่องว่าง ≥ ค่านี้ ระหว่างไฟลท์)
var SLA_REST_MIN = 60;      // ถ้าทำ 2 ไฟลท์ติดกันมาแล้ว → ต้องพักก่อนไฟลท์ถัดไป ≥ ค่านี้ (นาที, ปรับเป็น 90 ได้ถ้าต้องการ 1.5 ชม.)
// ── ระเบียบชั่วโมงทำงาน (AOTGA) — กะ 7-12 ชม./วัน · OT แยก · เพดานรวม/สัปดาห์ดูทั้งสัปดาห์ ──
var WH_SHIFT_MIN = 7, WH_SHIFT_MAX = 12, WH_DAY_HIGH = 14;   // กะ 7-12 ชม. · รวม(กะ+OT) >14ช = เตือนพักไม่พอ
/** สถานะชั่วโมงทำงานรายวันของพนักงาน 1 คน → {shift, ot, total, level, txt}
 *  · ปกติ: total = กะ + OT (OT ก่อน/หลังกะ ไม่ทับกัน) · ot_off (วันหยุดมาทำ OT): total = OT เท่านั้น (กะไม่ได้ทำ)
 *  level: ok | short(กะ<7) | over(กะ>12) | high(รวม>14ช = เสี่ยงพักไม่พอ) */
function slaHoursStat_(shiftHrs, ot, bucket) {
  var sh = Math.round((+shiftHrs || 0) * 10) / 10, o = Math.round((+ot || 0) * 10) / 10, total;
  if (bucket === 'ot_off') { sh = 0; total = o; }              // วันหยุดมาทำ OT → ทำงานจริง = OT (กะปกติไม่ได้ทำ ไม่นับซ้ำ)
  else total = Math.round((sh + o) * 10) / 10;
  var level = 'ok', txt = '';
  if (sh > 0 && sh < WH_SHIFT_MIN) { level = 'short'; txt = 'กะ ' + sh + 'ช <' + WH_SHIFT_MIN; }
  else if (sh > WH_SHIFT_MAX) { level = 'over'; txt = 'กะ ' + sh + 'ช >' + WH_SHIFT_MAX; }
  if (total > WH_DAY_HIGH) { level = 'high'; txt = 'รวม ' + total + 'ช (พักอาจไม่พอ)'; }   // OT มากจนเสี่ยง
  return { shift: sh, ot: o, total: total, level: level, txt: txt };
}
var SLA_DB = {
  'SQ': {ci:-240,cc:-40,go:-75,lc:-45,brief:60,post:30,total:13,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['FLIGHT CTRL',1,'SOD/FC','CI'],['CHECK-IN GK',1,'CT1/GK','CI'],
           ['CHECK-IN',4,'CT/G','CI'],['GATE AGENT',2,'GATE','GATE'],['BOARDING',4,'B','GATE']]},
  'CX': {ci:-240,cc:-60,go:-60,lc:-45,brief:60,post:30,total:15,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['FLIGHT CTRL',1,'SOD/FC','CI'],['CHECK-IN GK',1,'CT1/GK','CI'],
           ['CHECK-IN',5,'CT/G','CI'],['GATE AGENT',2,'GATE','GATE'],['BOARDING',5,'B','GATE']]},
  'LY': {ci:-240,cc:-60,go:-75,lc:-45,brief:60,post:30,total:13,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN GK',1,'CT1/GK','CI'],
           ['CHECK-IN',7,'CT','CI'],['GATE AGENT',1,'GATE','GATE'],['BOARDING',3,'B','GATE']]},
  'QR': {ci:-240,cc:-45,go:-75,lc:-45,brief:60,post:30,total:20,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['FLIGHT CONTROLLER',1,'FC','CI'],['CHECK-IN GK',1,'CT1/GK','CI'],
           ['CHECK-IN',10,'CT/G','CI'],['ARRIVAL',3,'ARR/G','ARR'],['GATE/MONITOR',4,'GM/PFD','GATE']]},
  'MH': {ci:-240,cc:-60,go:-75,lc:-45,brief:60,post:30,total:9,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN GK',1,'CT1/GK','CI'],['CHECK-IN',3,'CT/G','CI'],
           ['ARRIVAL',1,'ARR','ARR'],['GATE/BIR',2,'G/BIR','GATE'],['GATE/MAAS',1,'G/MAAS','GATE']]},
  'DE': {ci:-240,cc:-45,go:-75,lc:-45,brief:60,post:30,total:11,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['FLIGHT CTRL',1,'FC','CI'],['CHECK-IN GK',1,'CT1/GK','CI'],
           ['CHECK-IN',3,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE/MONITOR',4,'GM/PFD','GATE']]},
  'PG': {ci:-45,cc:-15,go:-45,lc:-15,brief:60,post:20,total:9,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['GATE MONITOR',2,'GM','GATE'],['GATE INT',1,'GM(INT)','GATE'],
           ['DEPARTURE',1,'D','GATE'],['GATE AGENT',3,'G','GATE'],['ARRIVAL',2,'ARR','ARR']]},
  'AK': {ci:-180,cc:-60,go:-50,lc:-10,brief:60,post:20,total:8,
    roles:[['SUPERVISOR',1,'SPVR G','ALL'],['FLIGHT CTRL',1,'CF/C','CI'],['CHECK-IN',2,'C','CI'],
           ['ARRIVAL',1,'ARR','ARR'],['GATE/FLIGHT',1,'GC/F','GATE'],['GATE',2,'G','GATE']]},
  'QZ': {ci:-180,cc:-60,go:-50,lc:-10,brief:60,post:20,total:8,
    roles:[['SUPERVISOR',1,'SPVR G','ALL'],['FLIGHT CTRL',1,'CF/C','CI'],['CHECK-IN',2,'C','CI'],
           ['ARRIVAL',1,'ARR','ARR'],['GATE/FLIGHT',1,'GC/F','GATE'],['GATE',2,'G','GATE']]},
  'SU': {ci:-180,cc:-40,go:-60,lc:-40,brief:60,post:30,total:23,
    roles:[['SUPERVISOR',1,'SOD/CF','ALL'],['GATE MONITOR',1,'GM','GATE'],
           ['CHECK-IN',16,'CHECK-IN','CI'],['ARRIVAL',1,'ARR/G','ARR'],['GATE AGENT',4,'GATE AGENT','GATE']]},
  'B2': {ci:-180,cc:-40,go:-60,brief:60,post:30,total:8,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',7,'CI','CI']]},
  'W5': {ci:-180,cc:-40,go:-60,brief:60,post:30,total:8,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',7,'CI','CI']]},
  '3U': {ci:-180,cc:-60,go:-60,lc:-30,brief:60,post:30,total:11,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['FLIGHT CTRL',1,'FC/GK','CI'],['CHECK-IN',3,'CT/G','CI'],
           ['ARRIVAL',1,'ARR','ARR'],['GATE/SOD',1,'SOD G','GATE'],['GATE',4,'GATE','GATE']]},
  'CA': {ci:-180,cc:-50,go:-60,lc:-30,brief:60,post:30,total:12,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['FLIGHT CTRL',1,'FC/GK','CI'],['CHECK-IN',5,'CT/G','CI'],
           ['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',2,'GM','GATE'],['GATE',2,'GATE','GATE']]},
  'MU': {ci:-180,cc:-50,go:-60,brief:60,post:30,total:11,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',5,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',4,'GM','GATE']]},
  'CZ': {ci:-180,cc:-45,go:-60,brief:60,post:30,total:10,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',4,'GM','GATE']]},
  'FM': {ci:-180,cc:-50,go:-60,brief:60,post:30,total:11,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',5,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',4,'GM','GATE']]},
  'HO': {ci:-180,cc:-45,go:-60,brief:60,post:30,total:10,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',2,'ARR','ARR'],['GATE',3,'GM','GATE']]},
  'HU': {ci:-180,cc:-50,go:-60,brief:60,post:30,total:10,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',4,'GM','GATE']]},
  'AQ': {ci:-180,cc:-45,go:-60,brief:60,post:30,total:9,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',3,'GM','GATE']]},
  'HX': {ci:-240,cc:-50,go:-60,brief:60,post:30,total:11,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',5,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',4,'GM','GATE']]},
  'EY': {ci:-180,cc:-60,go:-60,lc:-45,brief:60,post:30,total:11,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['FLIGHT CTRL',1,'FC/CTR','CI'],['SOD/CTR',1,'SOD/CTR','CI'],
           ['J-CLASS',2,'J','CI'],['BOARDING',5,'B','GATE'],['ARRIVAL',1,'ARR','ARR']]},
  'AY': {ci:-180,cc:-60,go:-60,brief:60,post:30,total:9,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',3,'GATE','GATE']]},
  'DV': {ci:-180,cc:-60,go:-60,brief:60,post:30,total:9,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',3,'GATE','GATE']]},
  'KE': {ci:-240,cc:-45,go:-60,lc:-45,brief:60,post:30,total:8,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['ASST GC',1,'ASST GC','CI'],
           ['CHECK-IN',4,'C','CI'],['GATE',1,'G','GATE'],['ARRIVAL',1,'ARR','ARR']]},
  'KC': {ci:-240,cc:-45,go:-60,brief:60,post:30,total:9,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['CI GK',1,'FC/C1','CI'],['CHECK-IN',5,'C','CI'],
           ['GATE',1,'G','GATE'],['ARRIVAL',1,'ARR','ARR']]},
  'OZ': {ci:-180,cc:-45,go:-60,brief:60,post:30,total:7,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['CHECK-IN',4,'C','CI'],['GATE',1,'G','GATE'],['ARRIVAL',1,'ARR','ARR']]},
  'NO': {ci:-180,cc:-45,go:-60,brief:60,post:30,total:7,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['CHECK-IN',4,'C','CI'],['GATE',1,'G','GATE'],['ARRIVAL',1,'ARR','ARR']]},
  'AF': {ci:-240,cc:-45,go:-60,brief:60,post:30,total:9,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['CHECK-IN',5,'C','CI'],['GATE',1,'G','GATE'],['ARRIVAL',2,'ARR','ARR']]},
  'LJ': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:7,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['CHECK-IN',4,'C','CI'],['GATE',1,'G','GATE'],['ARRIVAL',1,'ARR','ARR']]},
  'OV': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:7,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['CHECK-IN',4,'C','CI'],['GATE',1,'G','GATE'],['ARRIVAL',1,'ARR','ARR']]},
  'WY': {ci:-180,cc:-60,go:-45,lc:-30,brief:60,post:20,total:15,
    roles:[['SUPERVISOR 1',1,'SPVR/FC','ALL'],['SUPERVISOR 2',1,'SM','ALL'],
           ['CHECK-IN',6,'C','CI'],['ARRIVAL',1,'RF','ARR'],['GATE',6,'GATE','GATE']]},
  'G9': {ci:-180,cc:-60,go:-45,brief:60,post:20,total:6,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['CHECK-IN',4,'C','CI'],['ARRIVAL',1,'ARR','ARR']]},
  'DK': {ci:-180,cc:-60,go:-45,brief:60,post:20,total:6,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['CHECK-IN',4,'C','CI'],['ARRIVAL',1,'ARR','ARR']]},
  '9C': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:7,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['CHECK-IN',4,'C','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',1,'GATE','GATE']]},
  'EK': {ci:-240,cc:-60,go:-60,lc:-45,brief:60,post:30,total:16,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['FLIGHT CTRL',1,'FC','CI'],['SOD/DOCUMENT',1,'SOD','CI'],
           ['CHECK-IN GK',1,'CT/GK','CI'],['CHECK-IN',3,'CT/G','CI'],['ARRIVAL',4,'ARR','ARR'],
           ['GATE/BIR',2,'GK/BIR','GATE'],['GATE/MAAS',1,'GM/MAAS','GATE'],
           ['CREW ASSIGN',1,'CREW','GATE'],['CF',1,'CF','GATE']]},
  'UO': {ci:-180,cc:-45,go:-60,brief:60,post:20,total:10,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',2,'ARR','ARR'],['GATE',3,'GATE','GATE']]},
  'FY': {ci:-144,cc:-45,go:-45,brief:60,post:20,total:8,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['CHECK-IN',3,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',3,'GATE','GATE']]},
  '6B': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:9,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',3,'GATE','GATE']]},
  'BY': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:9,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',3,'GATE','GATE']]},
  'AI': {ci:-180,cc:-45,go:-70,lc:-45,brief:60,post:20,total:12,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['FC/CTR-BC',2,'FC/CT-BC','CI'],['SOD',1,'SOD','CI'],
           ['ARRIVAL',2,'ARR','ARR'],['FC/PFD',1,'FC/PFD','GATE'],['GATE',4,'G','GATE']]},
  'IX': {ci:-180,cc:-45,go:-60,brief:60,post:20,total:5,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['SOD',1,'SOD','CI'],['CI GK',1,'CT/GK','CI'],['CHECK-IN',2,'CT/G','CI']]},
  'JQ': {ci:-180,cc:-60,go:-90,lc:-45,brief:60,post:20,total:15,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['SOD/GTE',1,'SOD*GTE','CI'],['SOD/CTR',1,'SOD*CTR','CI'],
           ['FC/CTR-BC',2,'FC/CT-BC','CI'],['SD',1,'SD','CI'],['FC/PFD',1,'FC/PFD','GATE'],
           ['ARRIVAL',3,'ARR','ARR'],['GATE',5,'G','GATE']]},
  'IT': {ci:-180,cc:-45,go:-60,lc:-30,brief:60,post:20,total:8,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['SOD',1,'SOD','CI'],['CHECK-IN GK',1,'CT/GK','CI'],
           ['CHECK-IN',2,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',2,'GATE','GATE']]},
  'N0': {ci:-180,cc:-45,go:-60,brief:60,post:20,total:8,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',2,'G','GATE']]},
  'TK': {ci:-180,cc:-60,go:-60,lc:-45,brief:60,post:30,total:11,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['SOD',1,'SOD','CI'],['GATE MONITOR',1,'GM','GATE'],
           ['FLIGHT CTRL',1,'FC','CI'],['CREW SIGN',1,'CS','ALL'],['ARRIVAL',2,'ARR','ARR'],
           ['BOGO',1,'BOGO','GATE'],['Y-CLASS',2,'Y','GATE'],['CHECK-IN',1,'PSM','CI']]},
  'VJ': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:5,
    roles:[['SOD',1,'SOD','ALL'],['GATE MONITOR',1,'GM','GATE'],['FLIGHT CTRL',1,'FC','CI'],
           ['CREW SIGN',1,'CS','CI'],['ARRIVAL',1,'ARR','ARR']]},
  'OD': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:5,
    roles:[['SOD',1,'SOD','ALL'],['GATE MONITOR',1,'GM','GATE'],['FLIGHT CTRL',1,'FC','CI'],
           ['ARRIVAL',1,'ARR','ARR']]},
  'SG': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:8,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',2,'G','GATE']]},
  'HY': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:8,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',2,'G','GATE']]},
  'TR': {ci:-150,cc:-60,go:-45,lc:-30,brief:60,post:20,total:10,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['FLIGHT CTRL',1,'FC','CI'],['SOD',1,'SOD','CI'],
           ['CHECK-IN GK',1,'CT/GK','CI'],['CHECK-IN',2,'CT/G','CI'],
           ['ARRIVAL',1,'ARR','ARR'],['GATE',3,'GATE','GATE']]},
  '6E': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:7,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['FLIGHT CTRL',1,'FC','CI'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR']]},
  'QP': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:7,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['FLIGHT CTRL',1,'FC','CI'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR']]},
  'SV': {ci:-240,cc:-45,go:-45,brief:60,post:30,total:14,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['MONITOR',1,'MONITOR','ALL'],
           ['CHECK-IN',7,'C','CI'],['ARRIVAL',2,'ARR','ARR'],['GATE',3,'G','GATE']]},
  'WK': {ci:-198,cc:-45,go:-45,brief:60,post:30,total:14,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['MONITOR',1,'MONITOR','ALL'],
           ['CHECK-IN',7,'C','CI'],['ARRIVAL',2,'ARR','ARR'],['GATE',3,'G','GATE']]},
  'KA': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:10,
    roles:[['SUPERVISOR',1,'SPVR','ALL'],['CHECK-IN',5,'C','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',3,'G','GATE']]},
  'ZF': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:10,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['FLIGHT CTRL',1,'FC/GK','CI'],['CHECK-IN',4,'CT/G','CI'],
           ['ARRIVAL',1,'ARR','ARR'],['GATE',3,'GATE','GATE']]},
  'HH': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:8,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',2,'GATE','GATE']]},
  'LO': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:8,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',2,'GATE','GATE']]},
  'EO': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:8,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',2,'GATE','GATE']]},
  'S7': {ci:-180,cc:-45,go:-45,brief:60,post:20,total:10,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',5,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',3,'GATE','GATE']]},
  'PRIVATE': {ci:-60,cc:-20,go:-20,brief:20,post:20,total:3,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',1,'CT/G','CI'],['GATE',1,'GATE','GATE']]},
  'CHARTER': {ci:-120,cc:-30,go:-30,brief:30,post:20,total:5,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',2,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',1,'GATE','GATE']]},
  'DEFAULT': {ci:-180,cc:-45,go:-45,lc:-30,brief:60,post:20,total:8,
    roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE',2,'GATE','GATE']]}
};
var SLA_ALIAS = { '8M':'QZ','VN':'HY','3K':'JQ','HB':'HX','WZ':'ZF','N4':'EO','C6':'LO','G2':'LO','H4':'LO',
  'ZH':'CA','PN':'CA','OQ':'CA','GX':'CA','KX':'CA','8H':'CA','9H':'CA','BK':'CA','PVT':'PRIVATE' };

// ── จำนวนคนที่ต้องการต่อสายการบิน [SUP, CI, ARR, GATE(controller), TTL] ──────
// ตรงตามไฟล์ SLA_Systems_Airlines (Manpower per Job · สเปคทางการ) · หลายลำ → ใช้แถวลำใหญ่สุด (TTL มากสุด)
// · CI = Check-in Open · ARR = Arrival Agent · GATE = Gate Monitor/Controller (1) เพราะ Gate Agent มาจาก
//   check-in counter (ไม่นับซ้ำ) · 6E แยกเกท (SEPARATE) → GATE = GM+GA · TTL = คอลัมน์ "Total MP/Flight" จากไฟล์
var SLA_RQ = {
  '3K':[1,4,1,1,8], '3U':[1,4,1,1,8], '6B':[1,5,2,1,10], '6E':[1,5,1,5,9], '8L':[1,4,1,1,8], '8M':[1,3,1,1,7],
  '9C':[1,5,1,1,9], '9H':[1,4,1,1,8], 'AF':[1,9,1,1,13], 'AI':[1,6,1,1,9], 'AK':[1,4,1,1,8], 'AQ':[1,3,1,1,7],
  'AY':[1,5,1,1,9], 'B2':[1,6,1,1,10], 'BY':[1,5,2,1,10], 'C6':[1,4,1,1,8], 'CA':[1,6,1,1,10], 'CX':[1,6,2,1,11],
  'CZ':[1,6,1,1,10], 'DE':[1,6,2,1,11], 'DK':[1,4,1,1,8], 'DV':[1,4,1,1,8], 'EK':[1,7,4,1,14], 'EO':[1,6,1,1,10],
  'EY':[1,7,1,1,12], 'FM':[1,4,1,1,8], 'FY':[1,3,1,1,6], 'G2':[1,6,1,1,10], 'G8':[1,4,1,1,8], 'G9':[1,4,1,1,8],
  'H4':[1,5,1,1,9], 'HB':[1,3,1,1,7], 'HH':[1,4,1,1,8], 'HO':[1,4,1,1,8], 'HU':[1,6,1,1,10], 'HX':[1,5,1,1,9],
  'HY':[1,5,1,1,8], 'IT':[1,4,1,1,7], 'IX':[1,4,1,1,7], 'JQ':[1,7,1,1,10], 'KC':[1,5,1,1,9], 'KE':[1,8,1,1,11],
  'KY':[1,3,1,1,7], 'LJ':[1,4,1,1,8], 'LO':[1,6,1,1,10], 'LY':[1,7,4,1,14], 'MH':[1,4,1,1,8], 'MU':[1,4,1,1,8],
  'N0':[1,5,1,1,9], 'N4':[1,6,1,1,10], 'NO':[1,6,1,1,10], 'OD':[1,4,1,1,7], 'OM':[1,4,1,1,8], 'OQ':[1,4,1,1,8],
  'OV':[1,4,1,1,8], 'OZ':[1,6,1,1,10], 'PG':[1,0,1,2,8], 'PN':[1,4,1,1,8], 'QP':[1,5,1,1,9], 'QR':[1,11,3,1,17],
  'QZ':[1,4,1,1,8], 'S7':[1,4,1,1,8], 'SG':[1,4,1,1,7], 'SQ':[1,4,1,1,8], 'SU':[1,8,1,1,12], 'SV':[1,7,2,1,12],
  'TK':[1,8,4,1,15], 'TR':[1,5,1,1,10], 'U6':[1,4,1,1,8], 'UO':[1,4,2,1,8], 'VJ':[1,4,1,1,8], 'VN':[1,7,1,1,10],
  'W5':[1,7,2,1,12], 'WK':[1,6,2,1,11], 'WY':[1,7,1,1,11], 'WZ':[1,6,1,1,10], 'ZF':[1,6,1,1,10], 'ZH':[1,4,1,1,8],
};

// ── Airline → check-in SYSTEM (ตารางทางการ) ─────────────────────────────────
var AIRLINE_SYS = {
  '3K':'Gonow', '3U':'Angel Lite', '6B':'iPort', '6E':'Gonow', '8H':'TravelSky', '8L':'TravelSky', '8M':'iPort',
  '9C':'TravelSky', '9H':'TravelSky', 'AF':'Altea', 'AI':'Altea', 'AK':'Gonow', 'AQ':'TravelSky', 'AY':'Altea',
  'B2':'ASTRA', 'BK':'TravelSky', 'BY':'iPort', 'C6':'iPort', 'CA':'TravelSky', 'CX':'Altea', 'CZ':'TravelSky',
  'DE':'Altea', 'DK':'Altea', 'DV':'TWD', 'EK':'AS Connect', 'EO':'Lydia DCS', 'EY':'Altea', 'FM':'TravelSky',
  'FY':'Gonow', 'G2':'iPort', 'G8':'Gonow', 'G9':'Altea', 'GX':'TravelSky', 'H4':'iPort', 'HB':'TravelSky',
  'HH':'iPort', 'HO':'TravelSky', 'HU':'TravelSky', 'HX':'iPort', 'HY':'Altea', 'IT':'iPort', 'IX':'Gonow',
  'JQ':'Gonow', 'KA':'iPort', 'KC':'Altea', 'KE':'Altea', 'KX':'TravelSky', 'KY':'TravelSky', 'LJ':'iFlyRes',
  'LO':'iPort', 'LY':'Altea', 'MH':'Altea', 'MU':'TravelSky', 'N0':'Gonow', 'N4':'Lydia DCS', 'NO':'iPort',
  'OD':'Sabre', 'OM':'iPort', 'OQ':'TravelSky', 'OV':'iPort', 'OZ':'Altea', 'PG':'Altea', 'PN':'TravelSky',
  'QP':'Gonow', 'QR':'Altea', 'QZ':'Gonow', 'S7':'TWD', 'SG':'Gonow', 'SQ':'Altea', 'SU':'ASTRA',
  'SV':'Altea', 'TK':'TOYA', 'TR':'Gonow', 'U6':'Gonow', 'UO':'Gonow', 'VJ':'iPort', 'VN':'Altea',
  'W5':'AVIA', 'WK':'Altea', 'WY':'Sabre', 'WZ':'ASTRA', 'ZF':'ASTRA', 'ZH':'TravelSky',
};
// iPort = ระบบที่ทุกคนทำได้ (ไฟลท์ iPort ใครว่างก็ช่วยเช็คอินได้)
var SLA_UNIVERSAL_SYS_NORM = 'iport';
function slaSysNorm_(s) { return String(s || '').toLowerCase().replace(/[\s.]+/g, ''); }   // Astra=ASTRA, iPort=iport
function slaSystemOf_(airline) { return AIRLINE_SYS[String(airline || '').toUpperCase()] || ''; }
/** ระบบที่ "ต้องรู้" เพื่อช่วยเช็คอินไฟลท์นี้ ('' = ไม่จำกัด เช่น iPort หรือไม่ใช่ CI/SUP) */
function slaNeedSys_(airline, ph) {
  if (ph !== 'CI' && ph !== 'SUP') return '';
  var s = slaSystemOf_(airline);
  return (s && slaSysNorm_(s) !== SLA_UNIVERSAL_SYS_NORM) ? s : '';
}

// Official establishment requirement per team (SUP/SNR/PSA) from the AOTGA
// Manpower Meeting file — the FULL roster needed, not the daily on-duty count.
// (Used for HR headcount planning vs the master active headcount, not the daily
// flight SLA above.)
var TEAM_SLA_RQ = {
  'SQ':{SUP:8,SNR:8,PSA:46,total:62}, 'QR':{SUP:8,SNR:8,PSA:92,total:108}, 'PG':{SUP:4,SNR:4,PSA:28,total:36},
  'AK':{SUP:7,SNR:6,PSA:27,total:40}, 'SU':{SUP:10,SNR:10,PSA:44,total:64}, 'KE':{SUP:7,SNR:9,PSA:63,total:79},
  'EY':{SUP:5,SNR:5,PSA:51,total:61}, 'JQ':{SUP:6,SNR:7,PSA:32,total:45}, 'TK':{SUP:6,SNR:7,PSA:30,total:43},
  'TR':{SUP:9,SNR:12,PSA:38,total:59}, 'WY':{SUP:9,SNR:12,PSA:36,total:57}, 'EK':{SUP:7,SNR:7,PSA:39,total:53},
  'WK':{SUP:4,SNR:6,PSA:30,total:40}, 'CHN':{SUP:11,SNR:10,PSA:58,total:79},
};

function slaGet_(airline) {
  var c = String(airline || '').trim().toUpperCase();
  if (SLA_DB[c]) return SLA_DB[c];
  if (SLA_ALIAS[c] && SLA_DB[SLA_ALIAS[c]]) return SLA_DB[SLA_ALIAS[c]];
  return SLA_DB.DEFAULT;
}
/** หัวไฟลท์ที่เป็นงานซัพพอร์ต (มีคำว่า SUPPORT/SUUPORT/SUPPORT ฯลฯ) — ไม่นับเป็นไฟลท์จริง */
function slaIsSupportFlight_(name) { return /SUU?PP?ORT/i.test(String(name || '')); }
function slaAirlineOf_(flight) {
  var s = String(flight || '').trim().toUpperCase();
  var m = s.match(/^([0-9A-Z]{2})\s*\d/);                   // 2-char IATA code (EK, 6E, G9, C6) + flight no.
  if (m) return m[1];
  var m2 = s.match(/([A-Z]{1,3})\s*\d/);
  return m2 ? m2[1] : 'DEFAULT';
}
/** เวลาเป็นนาที — '' หรือ 00:00 (placeholder) → null (ถือว่าไม่มีขานั้น) */
function slaRealMin_(x) { var v = acMin_(x); return v ? v : null; }
/** key รวมไฟลท์ = สายการบิน + เลขไฟลท์ "ตัวแรก" → TK172/173, TK172, TK172/TK173 = key เดียว
 *  (EY416/EY417 = EY416/417 = EY416 · CX773/778 ≠ CX778 เพราะเลขแรกต่างกัน) */
function slaFlightKey_(raw) {
  var s = String(raw || '').trim().toUpperCase();
  var air = slaAirlineOf_(s);
  // ตัด code สายการบินด้านหน้าออกก่อนหาเลขไฟลท์ — กันสายที่ code ขึ้นต้นด้วยตัวเลข (6E/9C/3U/3K)
  // ไม่งั้น \d+ จะไปจับเลขตัวแรกของ code (6E1077 → '6') ทำให้ทุกไฟลท์ของสายนั้นรวมเป็น key เดียว
  var rest = (air && air !== 'DEFAULT') ? s.replace(new RegExp('^' + air + '\\s*'), '') : s;
  var m = rest.match(/\d+/);                                // เลขไฟลท์ชุดแรก (หลังตัด code)
  return m ? (air + String(parseInt(m[0], 10))) : s.replace(/[\s.\/]+/g, '');
}
/** required headcount per phase for an airline — ใช้ SLA_RQ (Manpower) ก่อน, ไม่งั้น roles */
function slaReq_(airline) {
  var c = String(airline || '').toUpperCase();
  var rq = SLA_RQ[c] || (SLA_ALIAS[c] && SLA_RQ[SLA_ALIAS[c]]);
  if (rq) return { SUP: 1, CI: rq[1], ARR: rq[2], GATE: rq[3], total: rq[4] };   // SUP/FLT.Controller = 1 ต่อไฟลท์เสมอ
  var db = slaGet_(airline);
  var req = { SUP: 0, CI: 0, GATE: 0, ARR: 0, total: db.total || 0 };
  (db.roles || []).forEach(function (r) {
    var ph = r[3] === 'ALL' ? 'SUP' : r[3];
    if (req[ph] === undefined) ph = 'CI';
    req[ph] += r[1];
  });
  req.SUP = 1;                                                                   // SUP/FLT.Controller = 1 ต่อไฟลท์เสมอ
  return req;
}

// ── บทบาทเต็มตามไฟล์ SLA_Systems_Airlines (Manpower per Job · แท็บ "จัดล่วงหน้า" + คอลัมน์ Flights) ─
// [SUP, FC, Check-in Open, Arrival, Standby, GateMonitor, Gate Agent, Post Departure, sepGate, Total MP/Flight]
// ตรงตามไฟล์ทุกคอลัมน์ · หลายลำ → แถวลำใหญ่สุด (Total มากสุด) · Gate Agent มาจากเช็คอิน (ไม่นับใน Total) · 6E sepGate=1
var SLA_ROLES = {
  '3K':[1,1,4,1,0,1,3,1,0,8], '3U':[1,1,4,1,0,1,3,1,0,8], '6B':[1,1,5,2,0,1,4,1,0,10], '6E':[1,1,5,1,0,1,4,1,1,9],
  '8L':[1,1,4,1,0,1,3,1,0,8], '8M':[1,1,3,1,0,1,4,1,0,7], '9C':[1,1,5,1,0,1,3,1,0,9], '9H':[1,1,4,1,0,1,3,1,0,8],
  'AF':[1,1,9,1,0,1,4,1,0,13], 'AI':[1,0,6,1,0,1,4,1,0,9], 'AK':[1,1,4,1,0,1,3,1,0,8], 'AQ':[1,1,3,1,0,1,3,1,0,7],
  'AY':[1,1,5,1,0,1,4,1,0,9], 'B2':[1,1,6,1,0,1,4,1,0,10], 'BY':[1,1,5,2,0,1,4,1,0,10], 'C6':[1,1,4,1,0,1,3,1,0,8],
  'CA':[1,1,6,1,0,1,3,1,0,10], 'CX':[1,1,6,2,0,1,5,1,0,11], 'CZ':[1,1,6,1,0,1,3,1,0,10], 'DE':[1,1,6,2,0,1,5,1,0,11],
  'DK':[1,1,4,1,0,1,4,1,0,8], 'DV':[1,1,4,1,0,1,4,1,0,8], 'EK':[1,1,7,4,0,1,4,1,0,14], 'EO':[1,1,6,1,0,1,5,1,0,10],
  'EY':[1,1,7,1,1,1,5,1,0,12], 'FM':[1,1,4,1,0,1,3,1,0,8], 'FY':[1,0,3,1,0,1,3,1,0,6], 'G2':[1,1,6,1,0,1,4,1,0,10],
  'G8':[1,1,4,1,0,1,3,1,0,8], 'G9':[1,1,4,1,0,1,3,1,0,8], 'H4':[1,1,5,1,0,1,4,1,0,9], 'HB':[1,1,3,1,0,1,3,1,0,7],
  'HH':[1,1,4,1,0,1,4,1,0,8], 'HO':[1,1,4,1,0,1,3,1,0,8], 'HU':[1,1,6,1,0,1,3,1,0,10], 'HX':[1,1,5,1,0,1,3,1,0,9],
  'HY':[1,0,5,1,0,1,4,1,0,8], 'IT':[1,0,4,1,0,1,3,1,0,7], 'IX':[1,0,4,1,0,1,3,1,0,7], 'JQ':[1,0,7,1,0,1,7,2,0,10],
  'KC':[1,1,5,1,0,1,3,1,0,9], 'KE':[1,0,8,1,0,1,3,1,0,11], 'KY':[1,1,3,1,0,1,3,1,0,7], 'LJ':[1,1,4,1,0,1,3,1,0,8],
  'LO':[1,1,6,1,0,1,4,1,0,10], 'LY':[1,1,7,4,0,1,8,1,0,14], 'MH':[1,1,4,1,0,1,3,1,0,8], 'MU':[1,1,4,1,0,1,3,1,0,8],
  'N0':[1,1,5,1,0,1,4,1,0,9], 'N4':[1,1,6,1,0,1,5,1,0,10], 'NO':[1,1,6,1,0,1,5,1,0,10], 'OD':[1,0,4,1,0,1,4,1,0,7],
  'OM':[1,1,4,1,0,1,4,1,0,8], 'OQ':[1,1,4,1,0,1,3,1,0,8], 'OV':[1,1,4,1,0,1,3,1,0,8], 'OZ':[1,1,6,1,0,1,4,1,0,10],
  'PG':[1,0,0,1,0,2,4,0,0,8], 'PN':[1,1,4,1,0,1,3,1,0,8], 'QP':[1,1,5,1,0,1,4,1,0,9], 'QR':[1,1,11,3,0,1,5,1,0,17],
  'QZ':[1,1,4,1,0,1,3,1,0,8], 'S7':[1,1,4,1,0,1,4,1,0,8], 'SG':[1,0,4,1,0,1,4,1,0,7], 'SQ':[1,1,4,1,0,1,4,1,0,8],
  'SU':[1,1,8,1,0,1,5,1,0,12], 'SV':[1,1,7,2,0,1,5,1,0,12], 'TK':[1,1,8,4,0,1,4,1,0,15], 'TR':[1,1,5,1,1,1,5,1,0,10],
  'U6':[1,1,4,1,0,1,4,1,0,8], 'UO':[1,0,4,2,0,1,2,1,0,8], 'VJ':[1,1,4,1,0,1,4,1,0,8], 'VN':[1,0,7,1,0,1,5,1,0,10],
  'W5':[1,1,7,2,0,1,5,1,0,12], 'WK':[1,1,6,2,0,1,4,1,0,11], 'WY':[2,0,7,1,0,1,5,1,0,11], 'WZ':[1,1,6,1,0,1,5,1,0,10],
  'ZF':[1,1,6,1,0,1,4,1,0,10], 'ZH':[1,1,4,1,0,1,3,1,0,8],
};
/** บทบาทเต็มต่อไฟลท์ → {SUP,FC,CI,ARR,STB,GM,GA,post,sep,total} (GM = Gate Monitor/Controller, post = Post Departure) */
function slaRoles_(airline) {
  var c = String(airline || '').toUpperCase();
  var r = SLA_ROLES[c] || (SLA_ALIAS[c] && SLA_ROLES[SLA_ALIAS[c]]);
  if (!r) { var q = slaReq_(airline); return { SUP: 1, FC: 1, CI: q.CI, ARR: q.ARR, STB: 0, GM: 1, GA: Math.max(0, (q.total || 0) - 4 - q.CI - q.ARR), post: 1, sep: false, total: q.total }; }
  return { SUP: r[0], FC: r[1], CI: r[2], ARR: r[3], STB: r[4], GM: r[5], GA: r[6], post: r[7], sep: !!r[8], total: r[9] };
}
/** เวลาเปิด-ปิดเคาน์เตอร์เช็คอินของไฟลท์ (จาก CI window) → "HH:MM-HH:MM" */
function slaCounterTime_(f) {
  var w = slaPhaseWindow_(f, 'CI');
  return w ? (rrFmtMin_(((w[0] % 1440) + 1440) % 1440) + '-' + rrFmtMin_(((w[1] % 1440) + 1440) % 1440)) : '';
}
/** classify a job task code into a phase */
/** คืน "ทุกเฟส" ที่ task ครอบคลุม (agent 1 คนทำหลายงาน เช่น "PRIO/GA/PFD" = เช็คอิน+เกท)
 *  · [] = ไปเทรน/ประชุม (ไม่นับเป็นคนคุมไฟลท์) · ['CI'] = ค่าเริ่มต้น (เช็คอิน) */
function slaPhasesOf_(task) {
  var u = String(task || '').toUpperCase();
  if (!u) return ['CI'];
  if (/TRAINING|LOAD CONTROL|IN.?HOUSE|MEETING|E-?LEARN|SEMINAR/.test(u)) return [];   // เทรน/ประชุม → ไม่คุมไฟลท์
  var p = {};
  if (/\bSUP\b|SPVR|\bSOD\b|\bSM\b|\bFC\b|\bCF\b|FLT\s*CTRL|FLIGHT\s*CONTROL/.test(u)) p.SUP = 1;   // หัวหน้า/Flight Controller (FC/CF)
  if (/\bARR\b|ARRIVAL|MEET|\bAC\b|\bRF\b|ESCORT|BIR|CIQ|IMMIG/.test(u)) p.ARR = 1;          // arrival · CIQ (ด่าน ตม./ศุลกากร ขาเข้า)
  if (/\bG[ABCKM]?\b|GATE|BOARD|BGO|BOCO|MAAS|PFD|GBD|DEPART|(^|[\s\/])D\b|(^|[\s\/])I\b/.test(u)) p.GATE = 1;   // gate: G(Agent)/GA/GB(Boarding)/GC(Controller)/GK(Flight Release)/GM(Monitor) · D=Gate Dom, I=Gate Int (PG · ต้นโทเคนเท่านั้น กัน "A-D"/"INT")
  if (/\bCT\d|\bCT\b|\bC\d|^C\b|\bY\d|\bJ\d|\bW\d|WEB|KIOSK|\bKSK\b|BAG\s?DROP|PRIO|PSM|\bSD\b|CHECK|CKIN|CREW|\bCS\b|\bFR\b|COUNTER/.test(u)) p.CI = 1;   // เช็คอิน · CT/CT1/CT2/CT3 = เคาน์เตอร์ · KSK = kiosk · Bag Drop · crew sign
  var keys = Object.keys(p);
  return keys.length ? keys : ['CI'];   // ไม่เข้าเกณฑ์ใด → เช็คอิน (ค่าเริ่มต้น)
}

/** ทีมที่ไม่เกี่ยวกับ SLA เช็คอิน/เกท — ไม่นับใน Flights & SLA / Support */
function slaSkipTeam_(team) {
  var t = String(team || '').toUpperCase();
  return t.indexOf('PORTER') >= 0 || t.indexOf('CREWSIGN') >= 0 || t.indexOf('CREW SIGN') >= 0 ||
         (t.indexOf('ADMIN') >= 0 && t.indexOf('DOC') >= 0);
}

/** collect all flights from the day's roster (PSA + LL), with assigned staff. */
function slaCollectFlights_(res, ll) {
  var flights = {};
  function add(team, rec) {
    (rec.assignments || []).forEach(function (a) {
      var raw = String(a.flight || '').trim();
      var key = slaFlightKey_(raw);                          // รวมไฟลท์เดียวกัน (เลขไฟลท์แรกตรง = key เดียว) เก็บชื่อตัวแรก
      if (!key) return;
      if (slaIsSupportFlight_(key)) return;                  // SUPPORT/SUUPORT = งานซัพพอร์ต ไม่ใช่ไฟลท์จริง → ข้าม
      if (!acIsFlight_(raw)) return;                         // เคาน์เตอร์/พูล (Counter Gx ของ SU, LP MORNING/AFTERNOON, งานอื่นๆ) ไม่ใช่ไฟลท์ → ไม่วัด SLA
      if (!flights[key]) {
        flights[key] = { flight: raw, airline: slaAirlineOf_(key), teams: {},
          STA: a.STA || '', STD: a.STD || '', OP: a.OP || '', CL: a.CL || '',
          assigned: { SUP: 0, CI: 0, GATE: 0, ARR: 0, total: 0 }, staff: [] };
      }
      var f = flights[key];
      f.teams[team] = true;
      if (!f.STA && a.STA) f.STA = a.STA; if (!f.STD && a.STD) f.STD = a.STD;
      if (!f.OP && a.OP) f.OP = a.OP; if (!f.CL && a.CL) f.CL = a.CL;
      if (/\bTF\b|T\s*\/\s*S|TRANSFER/i.test(String(a.task || ''))) f.hasTransfer = true;   // มีคน tag transfer (T/S) → อาจต้อง +agent
      var phs = slaPhasesOf_(a.task);
      if (!phs.length) { f.staff.push({ name: rec.name, pos: rec.pos, team: team, task: a.task, phase: 'TRAIN' }); return; }   // ไปเทรน → แสดงได้ แต่ไม่นับเป็นคนคุมไฟลท์
      phs.forEach(function (ph) { f.assigned[ph]++; });          // นับทุกเฟสที่คนนี้ครอบคลุม
      f.assigned.total++;                                        // total = headcount (1 คน นับ 1)
      f.staff.push({ name: rec.name, pos: rec.pos, team: team, task: a.task, phase: phs.join('/') });
    });
  }
  Object.keys(res.teams).forEach(function (t) {
    if (slaSkipTeam_(t)) return;                              // ข้าม Porter / Crewsign / Admin Doc
    res.teams[t].records.forEach(function (r) { if (r.bucket === 'working' || r.bucket === 'ot_off') add(t, r); });
  });
  if (ll && ll.totals.staff > 0) {
    Object.keys(ll.sections).forEach(function (s) {
      ll.sections[s].records.forEach(function (r) { if (r.bucket === 'working' || r.bucket === 'ot_off') add('LL·' + s, r); });
    });
  }
  // หัวหน้า (Sup) ที่ทำงานของแต่ละทีม + ช่วงเวลา — สำหรับเครดิต "ผู้กำกับดูแล" (1 หัวหน้าดูหลายไฟลท์พร้อมกัน)
  var teamSups = {};
  Object.keys(res.teams).forEach(function (t) {
    if (slaSkipTeam_(t)) return;
    res.teams[t].records.forEach(function (r) {
      if ((r.bucket !== 'working' && r.bucket !== 'ot_off') || r.posGroup !== 'PSS') return;
      var d = acDuty_(r); if (d.ds == null || d.de == null) return;
      (teamSups[t] = teamSups[t] || []).push([d.ds, d.de]);
    });
  });
  // คนทำ common check-in (นั่งเคาน์เตอร์รวม เช่น SU "Counter G2") + ช่วงเวลา — เครดิตเช็คอินให้ไฟลท์ของทีมตามเวลา
  var teamCounter = {};
  Object.keys(res.teams).forEach(function (t) {
    if (slaSkipTeam_(t)) return;
    res.teams[t].records.forEach(function (r) {
      if (r.bucket !== 'working' && r.bucket !== 'ot_off') return;
      if (!(r.assignments || []).some(function (a) { return /^\s*(COUNTER\b|CT\s?\d)/i.test(String(a.flight || '')); })) return;
      var d = acDuty_(r); if (d.ds == null || d.de == null) return;
      (teamCounter[t] = teamCounter[t] || []).push([d.ds, d.de]);
    });
  });
  // ทีมเจ้าของสายการบิน = ทีมที่ชื่อตรง/มีโค้ดสายนั้น (เช่น SU→ทีม SU แม้ SU ทำ common check-in ไม่ผูกไฟลท์)
  var teamNames = Object.keys(res.teams);
  function homeTeamOf(airline) {
    var a = String(airline || '').toUpperCase(); if (!a) return '';
    for (var i = 0; i < teamNames.length; i++) if (teamNames[i].toUpperCase() === a) return teamNames[i];
    for (var j = 0; j < teamNames.length; j++) if ((teamNames[j].toUpperCase().split(/[^A-Z0-9]+/)).indexOf(a) >= 0) return teamNames[j];
    return '';
  }
  // compute requirement + shortages per flight
  var arr = Object.keys(flights).map(function (k) {
    var f = flights[k];
    f.req = slaReq_(f.airline);
    var home = homeTeamOf(f.airline);                         // ทีมเจ้าของสายการบิน (ประกาศก่อนใช้เครดิต check-in รวม)
    // leg-based: ตัด phase ตามขาที่ไฟลท์มีจริง (STD=ขาออก / STA=ขาเข้า · 00:00/ว่าง = ไม่มีขานั้น)
    var hasDep = slaRealMin_(f.STD) != null, hasArr = slaRealMin_(f.STA) != null;
    if (hasArr && hasDep && slaRealMin_(f.STA) === slaRealMin_(f.STD)) hasArr = false;   // STA=STD เวลาเดียวกัน = ขาออกอย่างเดียว (RON) → ไม่ต้องการ Arrival
    f.noTime = !hasDep && !hasArr;                            // ไม่มีทั้งคู่ = ข้อมูลเวลาหาย (ไม่ใช่ขาเดียว) → คงความต้องการเต็ม
    if (!f.noTime) {                                          // ตัด phase เฉพาะกรณี "มีขาเดียวจริง"
      var extra = Math.max(0, f.req.total - (f.req.SUP + f.req.CI + f.req.GATE + f.req.ARR));  // เกท "จากเช็คอิน" (departure)
      if (!hasDep) { f.req.CI = 0; f.req.GATE = 0; extra = 0; } // ขาเข้าอย่างเดียว → ไม่ต้องการ Check-in/Gate/คนเสริม
      if (!hasArr) { f.req.ARR = 0; }                           // ขาออกอย่างเดียว → ไม่ต้องการ Arrival
      f.req.total = f.req.SUP + f.req.CI + f.req.GATE + f.req.ARR + extra;
    }
    // เครดิต SUP จากผู้กำกับดูแล: ไม่มีคน task=SUP บนไฟลท์ แต่ทีมเจ้าของมีหัวหน้าทำงานคาบช่วงไฟลท์ → มีผู้คุม
    if (f.req.SUP > 0 && f.assigned.SUP === 0) {
      var sw = slaPhaseWindow_(f, 'SUP'); var sm = slaRealMin_(f.STD); if (sm == null) sm = slaRealMin_(f.STA);
      if (!sw && sm != null) sw = [sm - 30, sm + 30];
      if (sw && Object.keys(f.teams).some(function (t) { return (teamSups[t] || []).some(function (w) { return w[0] <= sw[1] && w[1] >= sw[0]; }); })) {
        f.assigned.SUP = f.req.SUP;
      }
    }
    // เครดิต Check-in จาก common check-in (เคาน์เตอร์รวม): ทีมเจ้าของมีคนนั่งเคาน์เตอร์คาบช่วงเช็คอิน → เช็คอินให้ไฟลท์นี้แล้ว
    if (f.req.CI > 0 && f.assigned.CI < f.req.CI && home && teamCounter[home]) {
      var ciw = slaPhaseWindow_(f, 'CI');
      if (ciw) {
        var nC = teamCounter[home].filter(function (w) { return w[0] <= ciw[1] && w[1] >= ciw[0]; }).length;
        if (nC > 0) f.assigned.CI = Math.min(f.req.CI, f.assigned.CI + nC);
      }
    }
    f.short = {};
    ['SUP', 'CI', 'GATE', 'ARR'].forEach(function (ph) {
      var d = f.req[ph] - f.assigned[ph];
      if (d > 0) f.short[ph] = d;
    });
    f.shortTotal = Math.max(0, f.req.total - f.assigned.total);
    // คนรวมพอ/เกิน (คนเกิน) → เฟสยืดหยุ่น Check-in/Gate/Arrival ที่ขาด จัดสรรจากคนที่มีได้ ไม่นับเป็นขาด · SUP ยังต้องมีจริง (จัดแทนไม่ได้)
    if (f.shortTotal === 0) {
      var redist = [];
      ['CI', 'GATE', 'ARR'].forEach(function (ph) { if (f.short[ph]) { redist.push(ph); delete f.short[ph]; } });
      if (redist.length) f.redist = redist;
    }
    f.ok = Object.keys(f.short).length === 0 && f.shortTotal === 0;
    var home = homeTeamOf(f.airline);                          // ทีมเจ้าของสายการบิน (ถ้ามี) มาก่อนทีมที่มาช่วย
    if (home) f.teams[home] = true;                            // ให้ candidate ถือว่าทีมนี้เป็นเจ้าของ (ไม่นับ support ซ้ำ)
    f.teamList = home || Object.keys(f.teams).join(',');
    return f;
  });
  // เศษขา (fragment): ไฟลท์ noTime ที่ "เลขไฟลท์ทุกตัว" ไปซ้ำกับไฟลท์ที่มีเวลาอยู่แล้ว = ขาที่สองซ้ำ → ซ่อนได้
  // (ส่วน noTime ที่ไม่มีเลขซ้ำเลย = ข้อมูลเวลาหายจริง → เก็บไว้เตือนให้เติม)
  var timedNums = {};
  arr.forEach(function (f) { if (!f.noTime) (String(f.flight).match(/\d+/g) || []).forEach(function (n) { timedNums[+n] = 1; }); });
  arr.forEach(function (f) {
    if (!f.noTime) { f.fragment = false; return; }
    var nums = (String(f.flight).match(/\d+/g) || []).map(Number);
    f.fragment = nums.length > 0 && nums.every(function (n) { return timedNums[n]; });
  });
  return arr.sort(function (a, b) { return String(a.STD || a.STA || 'zz').localeCompare(String(b.STD || b.STA || 'zz')); });
}

var SLA_PH_TH = { SUP: 'SUP', CI: 'Check-in', GATE: 'Gate', ARR: 'Arrival' };
function slaShortText_(f) {
  var parts = [];
  ['SUP', 'CI', 'GATE', 'ARR'].forEach(function (ph) { if (f.short[ph]) parts.push(SLA_PH_TH[ph] + ' ขาด ' + f.short[ph]); });
  return parts.length ? parts.join(' · ') : (f.shortTotal ? ('ขาดรวม ' + f.shortTotal) : '');
}

// ── SUPPORT FINDER: ใครว่าง + รู้ระบบเช็คอิน มาช่วยไฟลท์ที่ขาดได้ ──────────────
/** ระบบเช็คอินที่แต่ละทีม "ทำเป็น" = ระบบของสายการบินที่ทีมนั้นบินวันนี้ */
function slaTeamSystems_(res, ll) {
  var sys = {};
  function add(team, r) {
    if (r.bucket !== 'working' && r.bucket !== 'ot_off') return;
    (r.assignments || []).forEach(function (a) {
      var s = slaSystemOf_(slaAirlineOf_(a.flight));
      if (s) { (sys[team] = sys[team] || {})[slaSysNorm_(s)] = true; }   // เก็บเป็น normalized
    });
  }
  Object.keys(res.teams).forEach(function (t) { res.teams[t].records.forEach(function (r) { add(t, r); }); });
  if (ll && ll.totals.staff > 0) Object.keys(ll.sections).forEach(function (s) { ll.sections[s].records.forEach(function (r) { add('LL·' + s, r); }); });
  return sys;
}
/** ทีมลอย/สแตนด์บายที่ Duty เรียกมาช่วยก่อน (PVTLP=PVT pool, CHARTER=ZF pool, STBY) */
function slaIsFloatTeam_(team) {
  var t = String(team || '').toUpperCase();
  // ทีมลอย/พูลซัพพอร์ตที่ Duty เรียกมาช่วยก่อน — PVTLP(PVT/LP) · CHARTER/ZF(ชาร์เตอร์ ทำหน้าที่พูลซัพพอร์ตหลัก) · STBY
  return /PVT|PRIVATE|\bLP\b|FLOAT|STBY|STAND ?BY|CHARTER|\bZF\b/.test(t);
}
/** พนักงานที่มาทำงาน + เวลางาน + ช่วงที่ติดไฟลท์ + ระบบที่ทำเป็น (สำหรับหาคนว่าง)
 *  includeOff=true → รวมคนวันหยุด (OFF) ไว้เป็นตัวเลือก "re-sked" (ว่างทุกช่วง · จัดเวลาให้ใหม่ได้) */
function slaSupportPool_(res, ll, teamSys, includeOff) {
  var pool = [];
  function add(team, r) {
    var off = (r.bucket === 'off');
    if (!off && r.bucket !== 'working' && r.bucket !== 'ot_off') return;   // sick/leave/vac ไม่ดึง
    if (off && !includeOff) return;                                        // คน OFF เฉพาะตอนเปิด re-sked
    if (slaSkipTeam_(team)) return;                          // Porter / Crewsign / Admin Doc ไม่เป็นคนช่วย
    var d = acDuty_(r), ds = d.ds, de = d.de;
    if (off) {
      // OFF (re-sked): ถ้ายังมี "กะรายสัปดาห์" ติดอยู่ (เช่น X9=00:00-09:00) → เคารพเวลากะนั้น
      // ไม่สมมุติว่าว่าง 24 ชม. (กันแนะคนกะเช้าไปช่วยไฟลท์บ่าย) · ไม่มีกะระบุ → ว่างทุกช่วง จัดเวลาใหม่ได้
      if (ds == null || de == null) { ds = -100000; de = 100000; }
    }
    if (ds == null || de == null) return;
    var busy = [];
    if (!off) (r.assignments || []).forEach(function (a) { var w = acFlightWin_(a); if (w) busy.push(w); });
    var flts = off ? [] : (r.assignments || []).filter(function (a) { return acIsFlight_(a.flight); })
      .map(function (a) {
        var w = acFlightWin_(a);                                            // ช่วงที่ "ติดงานจริง" ตาม role (เช่น ขาเข้า = รอบ STA) ไม่ใช่ STA-STD เต็มไฟลท์ → ตรงกับเกณฑ์เช็คเวลาว่าง
        var tm = w ? (' ' + rrFmtMin_(((w[0] % 1440) + 1440) % 1440) + '-' + rrFmtMin_(((w[1] % 1440) + 1440) % 1440))
               : ((a.STA || a.STD) ? (' ' + (a.STA || '–') + '-' + (a.STD || '–'))
                  : ((a.OP || a.CL) ? (' ' + (a.OP || '–') + '-' + (a.CL || '–')) : ''));
        return a.flight + tm;
      });
    // ช่วงเวลา re-sked (แบบ Duty: "re-sked 11-20") — จากกะรายสัปดาห์ที่เคารพไว้ · ไม่มีกะ → "ทุกช่วง"
    var offWin = (off && ds > -100000 && de < 100000)
      ? (rrFmtMin_(((ds % 1440) + 1440) % 1440) + '-' + rrFmtMin_(((de % 1440) + 1440) % 1440)) : '';
    pool.push({ name: r.name, id: r.id || '', team: team, pos: r.pos || '', posGroup: r.posGroup || '', off: off,
      float: slaIsFloatTeam_(team),
      ds: ds, de: de, busy: busy, hold: [], sys: teamSys[team] || {}, nflt: flts.length,
      shiftDisp: off ? ('OFF · re-sked ' + (offWin || 'ทุกช่วง') + (r.shift && r.shift.toUpperCase() !== 'OFF' ? ' (' + r.shift + ')' : ''))
                     : (r.bucket === 'ot_off' ? 'OFF (มา OT)' : ((r.shiftTime && r.shiftTime !== r.shift) ? (r.shift + ' ' + r.shiftTime) : (r.shift || r.shiftTime || '-'))),
      otDisp: r.ot > 0 ? (r.ot + 'h ' + (r.bucket === 'ot_off' ? 'OFF' : (r.otType === 'PRE' ? 'ก่อนกะ' : 'หลังกะ')) + (r.otTime ? ' ' + r.otTime : '')) : '-',
      hrs: Math.round(((r.shiftHrs || 0) + (r.ot || 0)) * 10) / 10, hstat: slaHoursStat_(r.shiftHrs, r.ot, r.bucket), flts: flts });
  }
  Object.keys(res.teams).forEach(function (t) { res.teams[t].records.forEach(function (r) { add(t, r); }); });
  if (ll && ll.totals.staff > 0) Object.keys(ll.sections).forEach(function (s) { ll.sections[s].records.forEach(function (r) { add('LL·' + s, r); }); });
  return pool;
}
/** เวลา (นาที) ของแต่ละ phase สำหรับไฟลท์ (อิง STD + offset ของสายการบิน) */
function slaPhaseWindow_(f, ph) {
  var db = slaGet_(f.airline);
  var m = function (x) { var v = acMin_(x); return v ? v : null; };   // 00:00 = placeholder → null
  var std = m(f.STD), sta = m(f.STA);
  if (ph === 'CI')  return std != null ? [std + db.ci, std + db.cc] : null;
  var post = (db.post != null) ? db.post : SLA_POST;   // post-flight รายสาย (full-service 30 / LCC 20)
  if (ph === 'GATE') {                                  // Duty: STA−30 → STD (turnaround) · ขาออกอย่างเดียว → STD−90
    var gs = sta != null ? sta - 30 : (std != null ? std - 90 : null);
    var ge = std != null ? std + post : (sta != null ? sta + post : null);
    return (gs != null && ge != null) ? [gs, ge] : null;
  }
  if (ph === 'ARR') {                                   // Duty: STA−30 → STD (arrival/transfer ถึงขาออก) · ไม่มี STD → STA+post
    var as = sta != null ? sta - 30 : null;
    var ae = std != null ? std + post : (sta != null ? sta + post : null);
    return (as != null && ae != null) ? [as, ae] : null;
  }
  if (ph === 'SUP') return std != null ? [std + db.ci, std + post] : (sta != null ? [sta - 20, sta + post] : null);
  return null;
}
/** ช่องว่างที่ต้องมีก่อนรับไฟลท์ใหม่ (นาที) — ปกติ 30 นาที แต่ถ้าทำ "2 ไฟลท์ติด" มาแล้ว → ต้องพัก ≥ 60 นาที
 *  ติด = ไฟลท์ก่อนหน้าที่ห่างกัน ≤ SLA_REST_MIN (ไม่ได้พักจริงระหว่างกัน) เรียงต่อเนื่องมาถึงก่อน winStart */
function slaTransitBuf_(busy, winStart) {
  var prior = (busy || []).filter(function (b) { return b[1] <= winStart + 10; })
    .sort(function (a, b) { return b[1] - a[1]; });               // ใหม่ → เก่า
  var n = 0, ref = winStart;
  for (var i = 0; i < prior.length; i++) {
    if (ref - prior[i][1] <= SLA_REST_MIN) { n++; ref = prior[i][0]; } else break;   // ต่อเนื่อง (พักไม่ถึง 60 นาที)
  }
  return n >= 2 ? SLA_REST_MIN : SLA_TRANSIT_MIN;                 // ทำ 2 ไฟลท์ติดแล้ว → พัก ≥ 60 นาที ก่อนไฟลท์ที่ 3
}
/** หาคนที่มาช่วยไฟลท์ f ใน phase ph ได้
 *  · CI  = รู้ระบบเช็คอินของสายการบินนั้น + ว่าง (ตำแหน่งใดก็ได้)
 *  · SUP = ต้องเป็นตำแหน่ง Sup + รู้ระบบนั้น + ว่าง (สำหรับ Sup/Flight Controller)
 *  · GATE/ARR = ไม่ต้องใช้ระบบ · เรียงลำดับ Agent → Senior → Sup */
function slaCandidates_(f, ph, pool, max) {
  var win = slaPhaseWindow_(f, ph);
  var needSys = slaNeedSys_(f.airline, ph);                   // '' = iPort/ไม่จำกัด → ทุกคนช่วยได้
  var needNorm = needSys ? slaSysNorm_(needSys) : '';
  var cands = pool.filter(function (p) {
    if (f.teams[p.team]) return false;                       // คนทีมเดียวกับไฟลท์ ไม่นับเป็น support
    if (needNorm && !p.sys[needNorm]) return false;          // CI/SUP ต้องรู้ระบบสายการบินนั้น (ยกเว้น iPort)
    if (ph === 'SUP' && p.posGroup !== 'PSS' && p.posGroup !== 'SNR') return false;  // SUP/Flight Controller = ตำแหน่ง Sup หรือ Snr
    if (win) {
      if (!(p.ds <= win[0] + 30 && p.de >= win[1] - 30)) return false;   // เวลางานครอบช่วงนั้น
      var buf = slaTransitBuf_(p.busy, win[0]);              // 30 นาที ปกติ · 60 นาที ถ้าทำ 2 ไฟลท์ติดมาแล้ว
      for (var i = 0; i < p.busy.length; i++) {              // ต้องไม่ติดไฟลท์อื่นของตัวเองช่วงนั้น + เผื่อเวลาเดินทาง/พัก
        var b = p.busy[i];
        if (win[0] < b[1] + buf && win[1] > b[0] - buf) return false;
      }
      for (var j = 0; j < p.hold.length; j++) {              // ต้องไม่ถูกจอง (tentatively) ไปช่วยไฟลท์อื่นช่วงที่ทับกัน (+ เวลาเดินทาง/พัก)
        var h = p.hold[j];
        if (win[0] < h[1] + buf && win[1] > h[0] - buf) return false;
      }
    }
    return true;
  });
  function ovh(x) { return (x.hstat && (x.hstat.level === 'over' || x.hstat.level === 'high')) ? 1 : 0; }   // ชั่วโมงเกินเกณฑ์ → ดันท้าย
  if (ph === 'SUP') {
    // ทำงานก่อน OFF · ชั่วโมงไม่เกินก่อน · ทีมลอย(PVTLP/STBY)ก่อน · Sup ก่อน Snr · งานน้อยกว่าก่อน
    cands.sort(function (a, b) { return (a.off ? 1 : 0) - (b.off ? 1 : 0) || ovh(a) - ovh(b) || (a.float ? 0 : 1) - (b.float ? 0 : 1) || (a.posGroup === 'PSS' ? 0 : 1) - (b.posGroup === 'PSS' ? 0 : 1) || a.nflt - b.nflt || String(a.team).localeCompare(b.team); });
  } else {
    // CI / GATE / ARR: ทำงานก่อน OFF · ชั่วโมงไม่เกินก่อน · ทีมลอยก่อน · Agent → Senior → Sup · งานน้อย/ว่างกว่าก่อน
    var PRI = { PSA: 0, SNR: 1, PSS: 2 };
    cands.sort(function (a, b) {
      return (a.off ? 1 : 0) - (b.off ? 1 : 0) ||
        ovh(a) - ovh(b) ||
        (a.float ? 0 : 1) - (b.float ? 0 : 1) ||
        (PRI[a.posGroup] == null ? 3 : PRI[a.posGroup]) - (PRI[b.posGroup] == null ? 3 : PRI[b.posGroup]) || a.nflt - b.nflt;
    });
  }
  return max ? cands.slice(0, max) : cands;
}
function slaWinTxt_(f, ph) {
  var w = slaPhaseWindow_(f, ph);
  return w ? (rrFmtMin_(((w[0] % 1440) + 1440) % 1440) + '-' + rrFmtMin_(((w[1] % 1440) + 1440) % 1440)) : '';
}

/** Sheet tab: ✈️ Flights & SLA — day's flights + required vs assigned + shortage */
function rbWriteFlightSLA_(ss, res, dateStr, ll, tabName) {
  tabName = tabName || '✈️ Flights & SLA';
  var old = ss.getSheetByName(tabName);
  if (old) ss.deleteSheet(old);
  var sh = ss.insertSheet(tabName);

  var flights = slaCollectFlights_(res, ll).filter(function (f) { return !(f.noTime && f.fragment); });   // ซ่อนเศษขา (ขาที่สองซ้ำ)
  var W = 13;
  sh.getRange(1, 1, 1, W).merge().setValue('✈️ ไฟลท์บินประจำวัน + เช็ค SLA สายการบิน — ' + dateStr)
    .setBackground('#0d2137').setFontColor('#fff').setFontWeight('bold').setFontSize(13).setHorizontalAlignment('center');
  sh.setRowHeight(1, 28);
  var head = ['Flight', 'สายการบิน', 'ทีม', 'STA', 'STD', 'OP', 'CL', 'ส่งไป(คน)', 'SLA ต้องการ', 'SUP', 'Check-in', 'Gate', 'Arrival'];
  sh.getRange(2, 1, 1, W).setValues([head]).setBackground('#1f4e79').setFontColor('#fff').setFontWeight('bold')
    .setHorizontalAlignment('center');
  var body = [], status = [];
  flights.forEach(function (f) {
    function cell(ph) { return f.assigned[ph] + '/' + f.req[ph] + (f.short[ph] ? ' ⚠️-' + f.short[ph] : ' ✓'); }
    body.push([f.flight, f.airline, f.teamList, f.STA, f.STD, f.OP, f.CL,
               f.assigned.total, f.req.total, cell('SUP'), cell('CI'), cell('GATE'), cell('ARR')]);
    status.push(f.ok);
  });
  if (body.length) {
    sh.getRange(3, 1, body.length, W).setValues(body).setFontSize(9).setVerticalAlignment('middle');
    for (var i = 0; i < body.length; i++) {
      var bg = status[i] ? '#e8f5e9' : '#fff3cd';
      sh.getRange(3 + i, 1, 1, W).setBackground(i % 2 ? bg : bg);
      if (!status[i]) sh.getRange(3 + i, 1, 1, W).setBackground('#fde8e8');
    }
  }
  [110, 75, 90, 55, 55, 55, 55, 70, 80, 70, 80, 70, 70].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(2);
  return flights;
}

var SLA_MAX_CAND = 24;     // pool คนช่วยต่อ 1 ตำแหน่งที่ขาด (มีเผื่อไว้ดึงทดแทนข้ามทีม)
var SLA_PH_LB = { SUP: 'SUP', CI: 'Check-in', GATE: 'Gate', ARR: 'Arrival' };
function slaPosShort_(g) { return g === 'PSS' ? 'Sup' : (g === 'SNR' ? 'Snr' : (g === 'PSA' ? 'Agent' : (g || '-'))); }
/** สร้างรายการ "ไฟลท์ขาด + ใครมาช่วยได้" (ต่อ 1 phase ที่ขาด = 1 แถว) */
function slaSupportRows_(res, ll) {
  var flights = slaCollectFlights_(res, ll).filter(function (f) { return !f.ok && !f.noTime; });
  var teamSys = slaTeamSystems_(res, ll);
  var pool = slaSupportPool_(res, ll, teamSys, true);          // รวมคน OFF (re-sked) เป็นตัวเลือกท้ายสุด
  var rows = [];
  flights.forEach(function (f) {
    ['SUP', 'CI', 'GATE', 'ARR'].forEach(function (ph) {
      if (!f.short[ph]) return;
      var elig = (typeof slaCanSupport_ === 'function') ? slaCanSupport_(f.airline, ph) : { ok: true, reason: '' };
      var cands = elig.ok ? slaCandidates_(f, ph, pool, SLA_MAX_CAND) : [];   // สายไม่รับซัพพอร์ตเฟสนี้ → ไม่แนะคน
      // จอง (tentatively) คนที่น่าจะถูกส่งจริง = top shortN ตามช่วงเวลาเฟสนี้
      // → ไฟลท์อื่นที่เวลาทับกันจะไม่แนะคนเดิมซ้ำ (กระจายคน + กันส่งซ้อน) เรียงไฟลท์ตามเวลาอยู่แล้ว
      var rwin = slaPhaseWindow_(f, ph);
      if (rwin) cands.slice(0, f.short[ph]).forEach(function (c) { c.hold.push(rwin); });
      rows.push({
        flight: f.flight, airline: f.airline, system: slaSystemOf_(f.airline), team: f.teamList,
        STD: f.STD || f.STA || '', phase: SLA_PH_LB[ph], shortN: f.short[ph], win: slaWinTxt_(f, ph),
        needSys: slaNeedSys_(f.airline, ph), block: elig.ok ? '' : elig.reason,
        cands: cands.map(function (c) {
          return { name: c.name, pos: slaPosShort_(c.posGroup), team: c.team, off: !!c.off,
                   shift: c.shiftDisp, ot: c.otDisp, hrs: c.hrs, hlevel: (c.hstat || {}).level || 'ok', htxt: (c.hstat || {}).txt || '', n: c.nflt, flts: c.flts };
        }),
        nCand: cands.length,
      });
    });
  });
  return rows;
}
/** ตรวจรายชื่อที่จะส่งไปซัพ (วางข้อความ Duty) — เช็ค OFF · กะไม่ครอบเวลางาน · เวลาซ้อน · ลงเทรน
 *  จับชื่อจาก roster เท่านั้น (กัน false positive จากคำว่า ARR/GATE) · ตามเลขไฟลท์ในบรรทัดเหนือชื่อ */
function slaCheckDeploy_(res, ll, text) {
  var people = {};
  function addP(team, r) {
    var fn = String(r.name || '').toUpperCase().split(/[\s(]/)[0];
    if (fn.length < 3) return;
    var d = acDuty_(r);
    var train = (r.assignments || []).some(function (a) { return rrIsTrainingTask_(String(a.flight)); });
    (people[fn] = people[fn] || []).push({ name: r.name, team: team, bucket: r.bucket, ds: d.ds, de: d.de, shift: r.shiftTime || r.shift, train: train });
  }
  Object.keys(res.teams).forEach(function (t) { res.teams[t].records.forEach(function (r) { addP(t, r); }); });
  if (ll && ll.totals.staff > 0) Object.keys(ll.sections).forEach(function (s) { ll.sections[s].records.forEach(function (r) { addP('LL·' + s, r); }); });
  var flT = {};
  slaCollectFlights_(res, ll).forEach(function (f) { flT[slaFlightKey_(f.flight)] = f; });
  var picks = [], cur = null;
  String(text || '').split(/\n/).forEach(function (ln) {
    var fm = ln.match(/\b[A-Z0-9]{2}\s?\d{2,4}\b/);
    if (fm && acIsFlight_(fm[0])) { var k = slaFlightKey_(fm[0]); cur = flT[k] || { flight: fm[0].trim() }; }
    (ln.match(/[A-Za-z][A-Za-z']{2,}/g) || []).forEach(function (tk) {
      var u = tk.toUpperCase(); if (people[u]) picks.push({ name: u, flight: cur, line: ln });
    });
  });
  var seen = {}, list = [];
  picks.forEach(function (p) { var fk = (p.flight && p.flight.flight) || ''; var k = p.name + '|' + fk; if (seen[k]) return; seen[k] = 1; list.push(p); });
  var byName = {};
  var rows = list.map(function (p) {
    var cand = people[p.name], rec = cand[0], f = p.flight, teamMiss = '';
    // ทีมที่ระบุในข้อความ (เช่น "SUTHIDA ZF") → เลือก record ของทีมนั้น; ถ้าไม่มี → เตือนทีมไม่ตรง
    var hints = (String(p.line || '').toUpperCase().match(/\b[A-Z]{2,4}\b/g) || []).filter(function (h) { return h !== p.name; });
    if (hints.length) {
      var hit = cand.filter(function (c) { var ct = c.team.toUpperCase(); return hints.some(function (h) { return ct === h || ct.indexOf(h) >= 0; }); });
      if (hit.length) rec = hit[0];
      else if (cand.length === 1 && hints.length) {
        var th = hints.filter(function (h) { return Object.keys(res.teams).some(function (t) { return t.toUpperCase().indexOf(h) >= 0; }); });
        if (th.length && rec.team.toUpperCase().indexOf(th[0]) < 0) teamMiss = 'ทีมในข้อความ (' + th[0] + ') ≠ ที่พบ (' + rec.team + ') — เช็คสะกด/คนละคน';
      }
    }
    var win = (f && (f.STA || f.STD)) ? slaPhaseWindow_(f, 'GATE') : null;
    var cover = (win && rec.ds != null && rec.de != null) ? (rec.ds <= win[0] + 30 && rec.de >= win[1] - 30) : null;
    var issues = [];
    if (rec.bucket === 'off') issues.push('OFF (วันหยุด — ต้อง re-sked/OT)');
    else if (rec.bucket !== 'working' && rec.bucket !== 'ot_off') issues.push(rec.bucket);
    if (cover === false) issues.push('กะ ' + (rec.shift || '') + ' ไม่ครอบเวลางาน');
    if (rec.train) issues.push('ในตารางลงเทรน/ประชุม');
    if (teamMiss) issues.push(teamMiss);
    (byName[p.name] = byName[p.name] || []).push(win);
    return { name: p.name, team: rec.team, bucket: rec.bucket, shift: rec.shift, flight: (f && f.flight) || '(ไม่ระบุไฟลท์)', issues: issues, overlap: false };
  });
  Object.keys(byName).forEach(function (nm) {
    var a = byName[nm].filter(Boolean);
    for (var i = 0; i < a.length; i++) for (var j = i + 1; j < a.length; j++)
      if (a[i][0] < a[j][1] - 10 && a[i][1] > a[j][0] + 10) rows.forEach(function (r) { if (r.name === nm) r.overlap = true; });
  });
  return rows;
}
/** จัดกลุ่มคนช่วยตามทีม (ให้เลือกได้ว่าจะดึงจากทีมไหน) → [{team, people:[...]}] */
function slaGroupCands_(cands) {
  var by = {}, order = [];
  cands.forEach(function (c) { if (!by[c.team]) { by[c.team] = []; order.push(c.team); } by[c.team].push(c); });
  return order.map(function (t) { return { team: t, people: by[t] }; });
}

/** ข้อความ SOS ขอคนซัพ (คัดลอกส่งไลน์) — จัดกลุ่มตามไฟลท์
 *  · ลิสต์เฉพาะ "คนทีมอื่น" ที่ส่งมาช่วย (cands ตัดทีมเจ้าของไฟลท์ออกแล้วใน slaCandidates_)
 *  · เลือก top N ตามจำนวนที่ขาด (N = shortN) เป็นตัวตั้งต้น */
function slaSOSText_(res, ll, dateStr) {
  var rows = slaSupportRows_(res, ll);
  var byFlt = {}, order = [];
  rows.forEach(function (r) {
    if (!byFlt[r.flight]) { byFlt[r.flight] = { first: r, ph: [] }; order.push(r.flight); }
    byFlt[r.flight].ph.push(r);
  });
  if (!order.length) return '✅ ทุกไฟลท์ส่งคนครบตาม SLA — ไม่ต้องขอ Support';
  var out = ['🆘 ขอ Support' + (dateStr ? ' — ' + dateStr : '')];
  order.forEach(function (fl) {
    var g = byFlt[fl], f = g.first;
    out.push('');
    out.push(f.flight + (f.STD ? '  STD ' + f.STD : '') + (f.system ? '  · ' + f.system : ''));
    g.ph.forEach(function (r) {
      out.push('• ' + r.phase + ' ขาด ' + r.shortN + (r.win ? ' (' + r.win + ')' : ''));
      var picks = (r.cands || []).slice(0, r.shortN);
      if (picks.length) picks.forEach(function (c, i) { out.push('   ' + (i + 1) + '. ' + c.name + ' / ' + c.team + (c.off ? '  (OFF·re-sked)' : '')); });
      else out.push('   — ' + (r.needSys ? 'ไม่มีคนว่างที่รู้ระบบ ' + r.needSys : 'ไม่มีคนว่าง'));
    });
  });
  return out.join('\n');
}

/** Sheet tab: 🆘 Support — ไฟลท์ขาด + แนะนำคนที่ว่างและรู้ระบบเช็คอินมาช่วย */
function rbWriteSupport_(ss, res, dateStr, ll, tabName) {
  tabName = tabName || '🆘 Support';
  var old = ss.getSheetByName(tabName);
  if (old) ss.deleteSheet(old);
  var sh = ss.insertSheet(tabName);
  var rows = slaSupportRows_(res, ll);
  var W = 8;

  sh.getRange(1, 1, 1, W).merge().setValue('🆘 ไฟลท์ที่คนไม่ครบ + คนที่มาช่วยได้ (ว่าง & รู้ระบบเช็คอิน) — ' + dateStr)
    .setBackground('#b71c1c').setFontColor('#fff').setFontWeight('bold').setFontSize(13).setHorizontalAlignment('center');
  sh.setRowHeight(1, 28);
  sh.getRange(2, 1, 1, W).setValues([['Flight', 'สายการบิน', 'ระบบเช็คอิน', 'ทีม', 'STD', 'ตำแหน่งที่ขาด', 'ช่วงเวลา', 'คนที่มาช่วยได้ (ว่าง + ระบบตรง)']])
    .setBackground('#d32f2f').setFontColor('#fff').setFontWeight('bold').setHorizontalAlignment('center');
  if (!rows.length) {
    sh.getRange(3, 1, 1, W).merge().setValue('✅ ทุกไฟลท์ส่งพนักงานครบตาม SLA').setBackground('#e8f5e9')
      .setFontWeight('bold').setFontColor('#1b5e20').setHorizontalAlignment('center');
  } else {
    var body = rows.map(function (r) {
      var who = r.cands.length
        ? slaGroupCands_(r.cands).map(function (g) {
            return '[' + g.team + '] ' + g.people.map(function (p) { return p.name + '(' + p.pos + ')'; }).join(', ');
          }).join('   ·   ')
        : (r.needSys ? '— ไม่มีคนว่างที่รู้ระบบ ' + r.needSys : '— ไม่มีคนว่าง');
      return [r.flight, r.airline, r.system || '-', r.team, r.STD,
              r.phase + ' ขาด ' + r.shortN + (r.needSys ? ' (ต้องใช้ ' + r.needSys + ')' : ''), r.win, who];
    });
    sh.getRange(3, 1, body.length, W).setValues(body).setFontSize(9).setVerticalAlignment('middle').setWrap(true);
    for (var i = 0; i < rows.length; i++) {
      sh.getRange(3 + i, 1, 1, W).setBackground(rows[i].nCand ? '#fff8e1' : '#fdecec');
    }
  }
  [95, 70, 95, 90, 55, 150, 95, 360].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(2);
}
