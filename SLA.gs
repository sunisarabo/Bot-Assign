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
  'QR':{ci:-240,cc:-45,go:-75,brief:60,post:30,total:20,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',11,'CT/G','CI'],['ARRIVAL',3,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',4,'GA','GATE']]},
  'MH':{ci:-240,cc:-60,go:-75,brief:60,post:30,total:9, roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',2,'GA','GATE']]},
  'DE':{ci:-240,cc:-45,go:-75,brief:60,post:30,total:12,roles:[['SUPERVISOR',2,'SUP','ALL'],['CHECK-IN',5,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',3,'GA','GATE']]},
  'OM':{ci:-240,cc:-45,go:-75,brief:60,post:30,total:12,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',5,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',4,'GA','GATE']]},
  'EY':{ci:-180,cc:-60,go:-60,brief:60,post:30,total:12,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',9,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',0,'GA','GATE']]},
  'AY':{ci:-180,cc:-45,go:-60,brief:60,post:30,total:13,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',6,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',4,'GA','GATE']]},
  'DV':{ci:-180,cc:-40,go:-60,brief:10,post:30,total:12,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',5,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',4,'GA','GATE']]},
  'SQ':{ci:-240,cc:-40,go:-75,brief:60,post:30,total:13,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',5,'CT/G','CI'],['ARRIVAL',2,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',4,'GA','GATE']]},
  'CX':{ci:-240,cc:-60,go:-60,brief:60,post:30,total:15,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',6,'CT/G','CI'],['ARRIVAL',2,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',5,'GA','GATE']]},
  'LY':{ci:-240,cc:-60,go:-75,brief:60,post:30,total:16,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',8,'CT/G','CI'],['ARRIVAL',3,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',3,'GA','GATE']]},
  'SU':{ci:-180,cc:-40,go:15, brief:60,post:30,total:23,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',16,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',4,'GA','GATE']]},
  'W5':{ci:-180,cc:-60,go:-120,brief:60,post:30,total:15,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',7,'CT/G','CI'],['ARRIVAL',2,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',4,'GA','GATE']]},
  'B2':{ci:-180,cc:-40,go:15, brief:60,post:30,total:13,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',6,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',4,'GA','GATE']]},
  'AK':{ci:-180,cc:-60,go:-50,brief:15,post:30,total:9, roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',3,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',3,'GA','GATE']]},
  'QZ':{ci:-180,cc:-60,go:-50,brief:15,post:30,total:9, roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',3,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',3,'GA','GATE']]},
  '8M':{ci:-180,cc:-60,go:-60,brief:15,post:30,total:8, roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',3,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',2,'GA','GATE']]},
  'PG':{ci:-180,cc:-40,go:-45,brief:30,post:20,total:7, roles:[['SUPERVISOR',1,'SUP','ALL'],['ARRIVAL',2,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',3,'GA','GATE']]},
  'KE':{ci:-240,cc:-60,go:-75,brief:60,post:30,total:16,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',8,'CT/G','CI'],['ARRIVAL',2,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',4,'GA','GATE']]},
  'OZ':{ci:-180,cc:-60,go:-60,brief:60,post:30,total:14,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',7,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',4,'GA','GATE']]},
  'KC':{ci:-180,cc:-60,go:-60,brief:60,post:30,total:12,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',5,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',4,'GA','GATE']]},
  'NO':{ci:-180,cc:-60,go:-60,brief:45,post:30,total:14,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',6,'CT/G','CI'],['ARRIVAL',2,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',4,'GA','GATE']]},
  'AF':{ci:-180,cc:-60,go:-60,brief:45,post:30,total:14,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',6,'CT/G','CI'],['ARRIVAL',2,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',4,'GA','GATE']]},
  'LJ':{ci:-180,cc:-60,go:-60,brief:45,post:30,total:14,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',6,'CT/G','CI'],['ARRIVAL',2,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',4,'GA','GATE']]},
  'OV':{ci:-180,cc:-60,go:-60,brief:45,post:30,total:14,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',6,'CT/G','CI'],['ARRIVAL',2,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',4,'GA','GATE']]},
  'EK':{ci:-240,cc:-60,go:-60,brief:60,post:30,total:17,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',6,'CT/G','CI'],['ARRIVAL',4,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',5,'GA','GATE']]},
  'UO':{ci:-180,cc:-60,go:-60,brief:30,post:30,total:11,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',2,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',3,'GA','GATE']]},
  'BY':{ci:-180,cc:-60,go:-60,brief:30,post:30,total:13,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',5,'CT/G','CI'],['ARRIVAL',2,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',4,'GA','GATE']]},
  'FY':{ci:-160,cc:-60,go:-60,brief:30,post:30,total:9, roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',3,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',3,'GA','GATE']]},
  '6B':{ci:-180,cc:-60,go:-60,brief:30,post:30,total:11,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',4,'GA','GATE']]},
  'WY':{ci:-180,cc:-60,go:-45,brief:20,post:20,total:13,roles:[['SUPERVISOR',2,'SUP','ALL'],['CHECK-IN',6,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',3,'GA','GATE']]},
  'G9':{ci:-180,cc:-75,go:-60,brief:20,post:20,total:11,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',5,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',3,'GA','GATE']]},
  'DK':{ci:-180,cc:-75,go:-60,brief:30,post:20,total:13,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',5,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',5,'GA','GATE']]},
  '9C':{ci:-180,cc:-60,go:-60,brief:30,post:20,total:11,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',5,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',3,'GA','GATE']]},
  'TK':{ci:-180,cc:-60,go:-60,brief:60,post:30,total:18,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',8,'CT/G','CI'],['ARRIVAL',2,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',6,'GA','GATE']]},
  'VJ':{ci:-180,cc:-50,go:-60,brief:30,post:20,total:11,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',5,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',3,'GA','GATE']]},
  'SG':{ci:-180,cc:-60,go:-50,brief:30,post:20,total:11,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',4,'GA','GATE']]},
  'HY':{ci:-180,cc:-60,go:-100,brief:30,post:20,total:12,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',5,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',4,'GA','GATE']]},
  'OD':{ci:-180,cc:-60,go:-60,brief:30,post:20,total:11,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',5,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',3,'GA','GATE']]},
  'TR':{ci:-150,cc:-60,go:-45,brief:30,post:20,total:11,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',5,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',3,'GA','GATE']]},
  '6E':{ci:-180,cc:-75,go:-60,brief:15,post:20,total:11,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',5,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',3,'GA','GATE']]},
  'QP':{ci:-195,cc:-60,go:-75,brief:30,post:20,total:12,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',5,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',4,'GA','GATE']]},
  'SV':{ci:-240,cc:-60,go:-60,brief:30,post:30,total:16,roles:[['SUPERVISOR',2,'SUP','ALL'],['CHECK-IN',7,'CT/G','CI'],['ARRIVAL',2,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',4,'GA','GATE']]},
  'WK':{ci:-210,cc:-60,go:-60,brief:60,post:30,total:15,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',7,'CT/G','CI'],['ARRIVAL',2,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',4,'GA','GATE']]},
  'KA':{ci:-180,cc:-60,go:-60,brief:30,post:30,total:14,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',6,'CT/G','CI'],['ARRIVAL',2,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',4,'GA','GATE']]},
  '3U':{ci:-180,cc:-60,go:-60,brief:15,post:30,total:11,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',4,'GA','GATE']]},
  'CA':{ci:-180,cc:-40,go:-60,brief:15,post:30,total:13,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',6,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',4,'GA','GATE']]},
  'CZ':{ci:-180,cc:-45,go:-70,brief:15,post:30,total:11,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',4,'GA','GATE']]},
  'MU':{ci:-180,cc:-60,go:-60,brief:10,post:30,total:12,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',5,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',4,'GA','GATE']]},
  'FM':{ci:-180,cc:-60,go:-60,brief:10,post:30,total:12,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',5,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',4,'GA','GATE']]},
  'HO':{ci:-180,cc:-60,go:-60,brief:15,post:30,total:11,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',2,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',3,'GA','GATE']]},
  'HU':{ci:-180,cc:-60,go:-60,brief:15,post:30,total:11,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',4,'GA','GATE']]},
  'AQ':{ci:-180,cc:-60,go:-60,brief:15,post:30,total:10,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',3,'GA','GATE']]},
  'HX':{ci:-240,cc:-60,go:-60,brief:15,post:30,total:11,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',5,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',4,'GA','GATE']]},
  'AI':{ci:-195,cc:-60,go:-70,brief:15,post:20,total:13,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',5,'CT/G','CI'],['ARRIVAL',2,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',4,'GA','GATE']]},
  'IX':{ci:-180,cc:-60,go:-75,brief:15,post:20,total:11,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',4,'GA','GATE']]},
  'JQ':{ci:-180,cc:-60,go:-90,brief:45,post:20,total:17,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',7,'CT/G','CI'],['ARRIVAL',3,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',5,'GA','GATE']]},
  'IT':{ci:-180,cc:-45,go:-60,brief:30,post:20,total:10,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',0,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',4,'GA','GATE']]},
  'N0':{ci:-240,cc:-60,go:-135,brief:60,post:20,total:14,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',6,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',5,'GA','GATE']]},
  'PVT':{ci:-60,cc:-20,go:-20,brief:20,post:20,total:2,roles:[['SUPERVISOR',1,'SUP','ALL'],['GATE AGENT',1,'GA','GATE']]},
  'CHARTER':{ci:-120,cc:-30,go:-30,brief:30,post:20,total:5,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',2,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE AGENT',1,'GA','GATE']]},
  'ZF':{ci:-180,cc:-45,go:-45,brief:30,post:20,total:10,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',5,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',2,'GA','GATE']]},
  'HH':{ci:-180,cc:-45,go:-45,brief:30,post:20,total:9, roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',2,'GA','GATE']]},
  'LO':{ci:-180,cc:-45,go:-45,brief:30,post:20,total:9, roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',2,'GA','GATE']]},
  'EO':{ci:-180,cc:-45,go:-45,brief:30,post:20,total:9, roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',2,'GA','GATE']]},
  'S7':{ci:-180,cc:-45,go:-45,brief:30,post:20,total:11,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',5,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',3,'GA','GATE']]},
  'DEFAULT':{ci:-180,cc:-45,go:-45,brief:60,post:20,total:8,roles:[['SUPERVISOR',1,'SUP','ALL'],['CHECK-IN',4,'CT/G','CI'],['ARRIVAL',1,'ARR','ARR'],['GATE MONITOR',1,'GM','GATE'],['GATE AGENT',1,'GA','GATE']]},
};
var SLA_ALIAS = { 'HB':'HX', 'G2':'LO', 'H4':'LO', 'C6':'LO', 'WZ':'ZF', 'N4':'EO', 'VN':'HY', 'ZH':'CA', 'PN':'CA', 'OQ':'CA', 'GX':'CA', 'KX':'CA', '8H':'CA', 'BK':'CA' };

// ── Airline → check-in SYSTEM (จากตาราง TEAM/POSITION → AIRLINES → SYSTEM) ──
// พนักงานจะ "เช็คอินแทน" สายการบินอื่นได้ ก็ต่อเมื่อรู้ระบบเช็คอินของสายการบินนั้น
// (= ระบบของสายการบินที่ทีมตัวเองทำอยู่)
var AIRLINE_SYS = {
  'AI':'Altea','IX':'Gonow','JQ':'Gonow','IT':'Iport','HX':'TravelSky','AK':'Gonow','QZ':'Gonow','8M':'Iport',
  'SQ':'Altea','CX':'Altea','LY':'Altea','HH':'Iport','LO':'Iport','G2':'Iport','H4':'Iport','C6':'Iport',
  'ZF':'Astra','WZ':'Astra','EO':'Lydia','N4':'Lydia','HB':'TravelSky','S7':'TWD','EK':'ASConnect',
  '6B':'Iport','BY':'Iport','FY':'Gonow','UO':'Gonow','QR':'Altea','MH':'Altea','DE':'Altea','OM':'Iport',
  '3U':'TravelSky','CA':'TravelSky','ZH':'TravelSky','CZ':'TravelSky','HU':'TravelSky','PN':'TravelSky',
  'MU':'TravelSky','FM':'TravelSky','8H':'TravelSky','9H':'TravelSky','OQ':'TravelSky','BK':'TravelSky',
  'AQ':'TravelSky','HO':'TravelSky','GX':'TravelSky','KX':'TravelSky','9C':'TravelSky',
  'KE':'Altea','KC':'Altea','AF':'Altea','OZ':'Altea','LJ':'iFlyRes','OV':'Iport','NO':'Iport',
  'TR':'Gonow','6E':'Gonow','QP':'Gonow','3K':'Gonow','WY':'Sabre','G9':'Altea','DK':'Altea','PG':'Altea',
  'W5':'AVIA','SU':'Astra','B2':'Astra','TK':'TOYA','HY':'Altea','VN':'Altea','SG':'Gonow','N0':'Gonow',
  'VJ':'Iport','OD':'Sabre','AY':'Altea','EY':'Altea','DV':'TWD','SV':'Altea','WK':'Altea','KA':'Iport',
};
// Iport = ระบบที่ "ทุกคนทำเป็น" — ไฟลท์ที่ใช้ Iport ใครว่างก็ช่วยเช็คอินได้ ไม่ต้องจำกัดระบบ
var SLA_UNIVERSAL_SYS = { 'Iport': true };
function slaSystemOf_(airline) { return AIRLINE_SYS[String(airline || '').toUpperCase()] || ''; }
/** ระบบที่ "ต้องรู้" เพื่อช่วยเช็คอินไฟลท์นี้ ('' = ไม่จำกัด เช่น Iport หรือไม่ใช่ CI/SUP) */
function slaNeedSys_(airline, ph) {
  if (ph !== 'CI' && ph !== 'SUP') return '';
  var s = slaSystemOf_(airline);
  return (s && !SLA_UNIVERSAL_SYS[s]) ? s : '';
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
function slaAirlineOf_(flight) {
  var s = String(flight || '').trim().toUpperCase();
  var m = s.match(/^([0-9A-Z]{2})\s*\d/);                   // 2-char IATA code (EK, 6E, G9, C6) + flight no.
  if (m) return m[1];
  var m2 = s.match(/([A-Z]{1,3})\s*\d/);
  return m2 ? m2[1] : 'DEFAULT';
}
/** required headcount per phase for an airline — roles = [name,count,code,phase] */
function slaReq_(airline) {
  var db = slaGet_(airline);
  var req = { SUP: 0, CI: 0, GATE: 0, ARR: 0, total: db.total || 0 };
  (db.roles || []).forEach(function (r) {
    var ph = r[3] === 'ALL' ? 'SUP' : r[3];
    if (req[ph] === undefined) ph = 'CI';
    req[ph] += r[1];
  });
  return req;
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
      if (s) { (sys[team] = sys[team] || {})[s] = true; }
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
  var needSys = slaNeedSys_(f.airline, ph);                   // '' = Iport/ไม่จำกัด → ทุกคนช่วยได้
  var cands = pool.filter(function (p) {
    if (f.teams[p.team]) return false;                       // คนทีมเดียวกับไฟลท์ ไม่นับเป็น support
    if (needSys && !p.sys[needSys]) return false;            // CI/SUP ต้องรู้ระบบสายการบินนั้น (ยกเว้น Iport)
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
