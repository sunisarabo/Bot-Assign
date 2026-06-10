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

// ── Airline SLA: timing offsets (รอบ STD) + required headcount per role/phase ──
// roles: [name, count, code, phase]  · phase = ALL(SUP) / CI / ARR / GATE
// ci/cc = check-in open/close (นาที รอบ STD) · go = gate · brief/post = ก่อน/หลัง
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
// จาก Manpower Meeting (ตัดชนิดเครื่องบินออก = ใช้แถวลำใหญ่สุด) · TTL = จำนวนคนจริง
// · gate agent มาจาก check-in (ไม่นับซ้ำใน per-phase) · total ใช้ TTL
var SLA_RQ = {
  '3K':[2,4,1,2,8], '3U':[2,4,1,2,8], '6B':[2,5,2,2,10], '6E':[2,5,1,6,9], '8L':[2,4,1,2,8], '8M':[2,3,1,2,7],
  '9C':[2,5,1,2,9], '9H':[2,4,1,2,8], 'AF':[2,9,1,2,13], 'AI':[2,6,1,2,10], 'AK':[2,3,1,2,7], 'AQ':[2,3,1,2,7],
  'AY':[2,5,1,2,9], 'BY':[2,5,2,2,10], 'C6':[2,4,1,2,8], 'CA':[2,6,1,2,10], 'CX':[2,6,2,2,11], 'CZ':[2,6,1,2,10],
  'DE':[2,6,2,2,11], 'DK':[2,7,1,2,11], 'DV':[2,4,1,2,8], 'EK':[2,7,3,2,13], 'EO':[2,6,1,2,10], 'EY':[2,9,1,2,13],
  'FM':[2,4,1,2,8], 'FY':[2,4,1,2,8], 'G2':[2,6,1,2,10], 'G8':[2,4,1,2,8], 'G9':[2,4,1,2,8], 'HB':[2,4,1,2,8],
  'HH':[2,4,1,2,8], 'HO':[2,4,1,2,8], 'HU':[2,6,1,2,10], 'HX':[2,5,1,2,9], 'HY':[2,5,1,2,9], 'IT':[2,4,1,2,8],
  'JQ':[2,7,1,3,11], 'KC':[2,5,1,2,9], 'KE':[2,8,1,2,12], 'KY':[2,3,1,2,7], 'LJ':[2,4,1,2,8], 'LO':[2,6,1,2,10],
  'LY':[2,8,1,2,12], 'MH':[2,4,1,2,8], 'MU':[2,4,1,2,8], 'N0':[2,5,1,2,9], 'N4':[2,6,1,2,10], 'NO':[2,6,1,2,10],
  'OD':[2,5,1,2,9], 'OM':[2,4,1,2,8], 'OQ':[2,4,1,2,8], 'OV':[2,4,1,2,8], 'OZ':[2,6,1,2,10], 'PG':[2,0,1,2,5],
  'PN':[2,4,1,2,8], 'QR':[2,9,2,2,14], 'QZ':[1,3,1,1,7], 'S7':[2,4,1,2,8], 'SG':[2,4,1,2,8], 'SQ':[2,5,1,2,9],
  'SU':[2,8,1,2,12], 'TK':[2,8,4,2,15], 'TR':[2,6,1,2,10], 'U6':[2,4,1,2,8], 'UO':[2,4,2,2,9], 'VJ':[2,5,1,2,9],
  'W5':[2,7,1,2,11], 'WK':[2,6,1,2,10], 'WY':[2,7,1,2,11], 'WZ':[2,6,1,2,10], 'ZF':[2,6,1,2,10], 'ZH':[2,4,1,2,8],
};

// ── Airline → check-in SYSTEM (ตารางทางการ) ─────────────────────────────────
var AIRLINE_SYS = {
  '3K':'Gonow', '3U':'Angel Lite', '6B':'iPort', '6E':'Gonow', '8H':'TravelSky', '8L':'TravelSky', '8M':'iPort',
  '9C':'TravelSky', '9H':'TravelSky', 'AF':'Altea', 'AI':'Altea', 'AK':'Gonow', 'AQ':'TravelSky', 'AY':'Altea',
  'B2':'ASTRA', 'BK':'TravelSky', 'BY':'iPort', 'C6':'iPort', 'CA':'TravelSky', 'CX':'Altea', 'CZ':'TravelSky',
  'DE':'Altea', 'DK':'Altea', 'DV':'TWD', 'EK':'AS Connect', 'EO':'Lydia DCS', 'EY':'Altea', 'FM':'TravelSky',
  'FY':'Gonow', 'G2':'iPort', 'G8':'Gonow', 'G9':'Altea', 'GX':'TravelSky', 'H4':'iPort', 'HB':'TravelSky',
  'HH':'iPort', 'HO':'TravelSky', 'HU':'TravelSky', 'HX':'iPort', 'HY':'Altea', 'IT':'Gonow', 'IX':'Gonow',
  'JQ':'Gonow', 'KA':'iPort', 'KC':'Altea', 'KE':'Altea', 'KX':'TravelSky', 'KY':'TravelSky', 'LJ':'iFlyRes',
  'LO':'iPort', 'LY':'Altea', 'MH':'Altea', 'MU':'TravelSky', 'N0':'Gonow', 'N4':'Lydia DCS', 'NO':'Gonow',
  'OD':'Sabre', 'OM':'iPort', 'OQ':'TravelSky', 'OV':'iPort', 'OZ':'Altea', 'PG':'Altea', 'PN':'TravelSky',
  'QP':'Gonow', 'QR':'Altea', 'QZ':'Gonow', 'S7':'TWD', 'SG':'Gonow', 'SQ':'Altea', 'SU':'ASTRA',
  'SV':'Altea', 'TK':'TOYA', 'TR':'Gonow', 'U6':'Gonow', 'UO':'Gonow', 'VJ':'iPort', 'VN':'Gonow',
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
/** required headcount per phase for an airline — ใช้ SLA_RQ (Manpower) ก่อน, ไม่งั้น roles */
function slaReq_(airline) {
  var c = String(airline || '').toUpperCase();
  var rq = SLA_RQ[c] || (SLA_ALIAS[c] && SLA_RQ[SLA_ALIAS[c]]);
  if (rq) return { SUP: rq[0], CI: rq[1], ARR: rq[2], GATE: rq[3], total: rq[4] };
  var db = slaGet_(airline);
  var req = { SUP: 0, CI: 0, GATE: 0, ARR: 0, total: db.total || 0 };
  (db.roles || []).forEach(function (r) {
    var ph = r[3] === 'ALL' ? 'SUP' : r[3];
    if (req[ph] === undefined) ph = 'CI';
    req[ph] += r[1];
  });
  return req;
}

// ── บทบาทเต็มตามตาราง Manpower per Job (สำหรับแท็บ "จัดล่วงหน้า") ──────────────
// [SUP, FC, Check-in, Arrival, Standby, Gate Monitor, Gate Agent(+Post Dep), sepGate, total]
var SLA_ROLES = {
  '3K':[1,1,4,1,0,1,4,0,8], '3U':[1,1,4,1,0,1,4,0,8], '6B':[1,1,5,2,0,1,5,0,10], '6E':[1,1,5,1,0,1,5,1,9], '8L':[1,1,4,1,0,1,4,0,8],
  '8M':[1,1,3,1,0,1,5,0,7], '9C':[1,1,5,1,0,1,4,0,9], '9H':[1,1,4,1,0,1,4,0,8], 'AF':[1,1,9,1,0,1,5,0,13], 'AI':[1,1,6,1,0,1,4,0,10],
  'AK':[1,1,3,1,0,1,5,0,7], 'AQ':[1,1,3,1,0,1,4,0,7], 'AY':[1,1,5,1,0,1,5,0,9], 'BY':[1,1,5,2,0,1,5,0,10], 'C6':[1,1,4,1,0,1,4,0,8],
  'CA':[1,1,6,1,0,1,4,0,10], 'CX':[1,1,6,2,0,1,6,0,11], 'CZ':[1,1,6,1,0,1,4,0,10], 'DE':[1,1,6,2,0,1,6,0,11], 'DK':[1,1,7,1,0,1,6,0,11],
  'DV':[1,1,4,1,0,1,5,0,8], 'EK':[1,1,7,3,0,1,6,0,13], 'EO':[1,1,6,1,0,1,6,0,10], 'EY':[1,1,9,1,0,1,6,0,13], 'FM':[1,1,4,1,0,1,4,0,8],
  'FY':[1,1,4,1,0,1,4,0,8], 'G2':[1,1,6,1,0,1,5,0,10], 'G8':[1,1,4,1,0,1,4,0,8], 'G9':[1,1,4,1,0,1,4,0,8], 'HB':[1,1,4,1,0,1,4,0,8],
  'HH':[1,1,4,1,0,1,5,0,8], 'HO':[1,1,4,1,0,1,4,0,8], 'HU':[1,1,6,1,0,1,4,0,10], 'HX':[1,1,5,1,0,1,4,0,9], 'HY':[1,1,5,1,0,1,5,0,9],
  'IT':[1,1,4,1,0,1,5,0,8], 'JQ':[1,1,7,1,0,1,9,0,11], 'KC':[1,1,5,1,0,1,4,0,9], 'KE':[1,1,8,1,0,1,4,0,12], 'KY':[1,1,3,1,0,1,4,0,7],
  'LJ':[1,1,4,1,0,1,4,0,8], 'LO':[1,1,6,1,0,1,5,0,10], 'LY':[1,1,8,1,0,1,10,0,12], 'MH':[1,1,4,1,0,1,4,0,8], 'MU':[1,1,4,1,0,1,4,0,8],
  'N0':[1,1,5,1,0,1,5,0,9], 'N4':[1,1,6,1,0,1,6,0,10], 'NO':[1,1,6,1,0,1,6,0,10], 'OD':[1,1,5,1,0,1,5,0,9], 'OM':[1,1,4,1,0,1,4,0,8],
  'OQ':[1,1,4,1,0,1,4,0,8], 'OV':[1,1,4,1,0,1,4,0,8], 'OZ':[1,1,6,1,0,1,5,0,10], 'PG':[1,1,0,1,0,2,4,0,5], 'PN':[1,1,4,1,0,1,4,0,8],
  'QR':[1,1,9,2,0,1,6,0,14], 'S7':[1,1,4,1,0,1,4,0,8], 'SG':[1,1,4,1,0,1,5,0,8], 'SQ':[1,1,5,1,0,1,5,0,9], 'SU':[1,1,8,1,0,1,5,0,12],
  'TK':[1,1,8,4,0,1,5,0,15], 'TR':[1,1,6,1,0,1,6,0,10], 'U6':[1,1,4,1,0,1,5,0,8], 'UO':[1,1,4,2,0,1,5,0,9], 'VJ':[1,1,5,1,0,1,5,0,9],
  'W5':[1,1,7,1,0,1,5,0,11], 'WK':[1,1,6,1,0,1,5,0,10], 'WY':[1,1,7,1,0,1,8,0,11], 'WZ':[1,1,6,1,0,1,6,0,10], 'ZF':[1,1,6,1,0,1,5,0,10],
  'ZH':[1,1,4,1,0,1,4,0,8],
};
/** บทบาทเต็มต่อไฟลท์ → {SUP,FC,CI,ARR,STB,GM,GA,sep,total} */
function slaRoles_(airline) {
  var c = String(airline || '').toUpperCase();
  var r = SLA_ROLES[c] || (SLA_ALIAS[c] && SLA_ROLES[SLA_ALIAS[c]]);
  if (!r) { var q = slaReq_(airline); return { SUP: 1, FC: 1, CI: q.CI, ARR: q.ARR, STB: 0, GM: 1, GA: Math.max(0, (q.total || 0) - 3 - q.CI - q.ARR), sep: false, total: q.total }; }
  return { SUP: r[0], FC: r[1], CI: r[2], ARR: r[3], STB: r[4], GM: r[5], GA: r[6], sep: !!r[7], total: r[8] };
}
/** เวลาเปิด-ปิดเคาน์เตอร์เช็คอินของไฟลท์ (จาก CI window) → "HH:MM-HH:MM" */
function slaCounterTime_(f) {
  var w = slaPhaseWindow_(f, 'CI');
  return w ? (rrFmtMin_(((w[0] % 1440) + 1440) % 1440) + '-' + rrFmtMin_(((w[1] % 1440) + 1440) % 1440)) : '';
}
/** classify a job task code into a phase */
function slaPhaseOf_(task) {
  var u = String(task || '').toUpperCase();
  if (!u) return 'CI';
  if (/SUP|SPVR|^SOD|SM\b|MONITOR|CREW|^CS\b|CRW/.test(u)) return 'SUP';
  if (/ARR|MEET|^AC\b|^RF\b|ESCORT|BIR/.test(u)) return 'ARR';
  if (/GATE|^G[\b\/CM-]|^GM|^GC|BOARD|^B\b|BGO|BOCO|MAAS|PFD|GBD|^D\b|DEPART/.test(u)) return 'GATE';
  return 'CI';   // check-in default (CT, C, Y, J, W, F, WEB, KIOSK, PSM, FC, GK, SD...)
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
      var key = String(a.flight || '').trim();
      if (!key) return;
      if (slaIsSupportFlight_(key)) return;                  // SUPPORT/SUUPORT = งานซัพพอร์ต ไม่ใช่ไฟลท์จริง → ข้าม
      if (!flights[key]) {
        flights[key] = { flight: key, airline: slaAirlineOf_(key), teams: {},
          STA: a.STA || '', STD: a.STD || '', OP: a.OP || '', CL: a.CL || '',
          assigned: { SUP: 0, CI: 0, GATE: 0, ARR: 0, total: 0 }, staff: [] };
      }
      var f = flights[key];
      f.teams[team] = true;
      if (!f.STA && a.STA) f.STA = a.STA; if (!f.STD && a.STD) f.STD = a.STD;
      if (!f.OP && a.OP) f.OP = a.OP; if (!f.CL && a.CL) f.CL = a.CL;
      var ph = slaPhaseOf_(a.task);
      f.assigned[ph]++; f.assigned.total++;
      f.staff.push({ name: rec.name, pos: rec.pos, team: team, task: a.task, phase: ph });
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
  // compute requirement + shortages per flight
  return Object.keys(flights).map(function (k) {
    var f = flights[k];
    f.req = slaReq_(f.airline);
    f.short = {};
    ['SUP', 'CI', 'GATE', 'ARR'].forEach(function (ph) {
      var d = f.req[ph] - f.assigned[ph];
      if (d > 0) f.short[ph] = d;
    });
    f.shortTotal = Math.max(0, f.req.total - f.assigned.total);
    f.ok = Object.keys(f.short).length === 0 && f.shortTotal === 0;
    f.teamList = Object.keys(f.teams).join(',');
    return f;
  }).sort(function (a, b) { return String(a.STD || a.STA || 'zz').localeCompare(String(b.STD || b.STA || 'zz')); });
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
/** พนักงานที่มาทำงาน + เวลางาน + ช่วงที่ติดไฟลท์ + ระบบที่ทำเป็น (สำหรับหาคนว่าง) */
function slaSupportPool_(res, ll, teamSys) {
  var pool = [];
  function add(team, r) {
    if (r.bucket !== 'working' && r.bucket !== 'ot_off') return;
    if (slaSkipTeam_(team)) return;                          // Porter / Crewsign / Admin Doc ไม่เป็นคนช่วย
    var d = acDuty_(r);
    if (d.ds == null || d.de == null) return;
    var busy = [];
    (r.assignments || []).forEach(function (a) { var w = acFlightWin_(a); if (w) busy.push(w); });
    var flts = (r.assignments || []).filter(function (a) { return acIsFlight_(a.flight); })
      .map(function (a) {
        var tm = (a.STA || a.STD) ? (' ' + (a.STA || '–') + '-' + (a.STD || '–'))
               : ((a.OP || a.CL) ? (' ' + (a.OP || '–') + '-' + (a.CL || '–')) : '');
        return a.flight + tm;
      });
    pool.push({ name: r.name, id: r.id || '', team: team, pos: r.pos || '', posGroup: r.posGroup || '',
      ds: d.ds, de: d.de, busy: busy, sys: teamSys[team] || {}, nflt: flts.length,
      shiftDisp: r.bucket === 'ot_off' ? 'OFF (มา OT)' : ((r.shiftTime && r.shiftTime !== r.shift) ? (r.shift + ' ' + r.shiftTime) : (r.shift || r.shiftTime || '-')),
      otDisp: r.ot > 0 ? (r.ot + 'h ' + (r.bucket === 'ot_off' ? 'OFF' : (r.otType === 'PRE' ? 'ก่อนกะ' : 'หลังกะ')) + (r.otTime ? ' ' + r.otTime : '')) : '-',
      hrs: Math.round(((r.shiftHrs || 0) + (r.ot || 0)) * 10) / 10, flts: flts });
  }
  Object.keys(res.teams).forEach(function (t) { res.teams[t].records.forEach(function (r) { add(t, r); }); });
  if (ll && ll.totals.staff > 0) Object.keys(ll.sections).forEach(function (s) { ll.sections[s].records.forEach(function (r) { add('LL·' + s, r); }); });
  return pool;
}
/** เวลา (นาที) ของแต่ละ phase สำหรับไฟลท์ (อิง STD + offset ของสายการบิน) */
function slaPhaseWindow_(f, ph) {
  var db = slaGet_(f.airline);
  var std = acMin_(f.STD), sta = acMin_(f.STA);
  if (ph === 'CI')  return std != null ? [std + db.ci, std + db.cc] : null;
  if (ph === 'GATE')return std != null ? [std + db.go, std + (db.post || 20)] : null;
  if (ph === 'ARR') return sta != null ? [sta - 20, sta + (db.post || 30)] : null;
  if (ph === 'SUP') return std != null ? [std + db.ci, std + (db.post || 30)] : (sta != null ? [sta - 20, sta + 30] : null);
  return null;
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
    if (ph === 'SUP' && p.posGroup !== 'PSS') return false;  // Sup/Flight Controller ต้องเป็น Sup
    if (win) {
      if (!(p.ds <= win[0] + 30 && p.de >= win[1] - 30)) return false;   // เวลางานครอบช่วงนั้น
      for (var i = 0; i < p.busy.length; i++) {              // ต้องไม่ติดไฟลท์อื่นช่วงนั้น
        var b = p.busy[i];
        if (win[0] < b[1] - 10 && win[1] > b[0] + 10) return false;
      }
    }
    return true;
  });
  if (ph === 'SUP') {
    cands.sort(function (a, b) { return a.nflt - b.nflt || String(a.team).localeCompare(b.team); });
  } else {
    // CI / GATE / ARR: Agent → Senior → Sup ตามลำดับ แล้วคนงานน้อย/ว่างกว่าก่อน
    var PRI = { PSA: 0, SNR: 1, PSS: 2 };
    cands.sort(function (a, b) {
      return (PRI[a.posGroup] == null ? 3 : PRI[a.posGroup]) - (PRI[b.posGroup] == null ? 3 : PRI[b.posGroup]) || a.nflt - b.nflt;
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

  var flights = slaCollectFlights_(res, ll);
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
  var flights = slaCollectFlights_(res, ll).filter(function (f) { return !f.ok; });
  var teamSys = slaTeamSystems_(res, ll);
  var pool = slaSupportPool_(res, ll, teamSys);
  var rows = [];
  flights.forEach(function (f) {
    ['SUP', 'CI', 'GATE', 'ARR'].forEach(function (ph) {
      if (!f.short[ph]) return;
      var cands = slaCandidates_(f, ph, pool, SLA_MAX_CAND);
      rows.push({
        flight: f.flight, airline: f.airline, system: slaSystemOf_(f.airline), team: f.teamList,
        STD: f.STD || f.STA || '', phase: SLA_PH_LB[ph], shortN: f.short[ph], win: slaWinTxt_(f, ph),
        needSys: slaNeedSys_(f.airline, ph),
        cands: cands.map(function (c) {
          return { name: c.name, pos: slaPosShort_(c.posGroup), team: c.team,
                   shift: c.shiftDisp, ot: c.otDisp, hrs: c.hrs, n: c.nflt, flts: c.flts };
        }),
        nCand: cands.length,
      });
    });
  });
  return rows;
}
/** จัดกลุ่มคนช่วยตามทีม (ให้เลือกได้ว่าจะดึงจากทีมไหน) → [{team, people:[...]}] */
function slaGroupCands_(cands) {
  var by = {}, order = [];
  cands.forEach(function (c) { if (!by[c.team]) { by[c.team] = []; order.push(c.team); } by[c.team].push(c); });
  return order.map(function (t) { return { team: t, people: by[t] }; });
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
