/**
 * AirlineSupport.gs — กฎการรับพนักงานซัพพอร์ตรายสายการบิน (จากไฟล์ Data Airlines Check)
 * ok = สายนี้รับซัพพอร์ตไหม (false = ไม่รับเลย ต้องใช้คนทีมตัวเอง)
 * ph = เฟสที่อนุญาตให้ซัพพอร์ต (null = ทุกเฟส) — บางสายรับเฉพาะ ARR/GATE (ไม่ต้องเทรนโปรดักส์)
 * เฟส: SUP · CI(เช็คอิน/crew sign) · GATE(gate agent/bogo) · ARR(ขาเข้า)
 */
var AIRLINE_SUP = {
  'QR':{ok:false,ph:null},
  'SQ':{ok:true,ph:['ARR','GATE']},  // อนุญาตเฉพาะARR, GATE
  'EK':{ok:false,ph:null},
  'EY':{ok:true,ph:null},  // ไม่อนุญาตในตำแหน่ง Bogo
  'KE':{ok:false,ph:null},
  'WY':{ok:false,ph:null},
  'SU':{ok:true,ph:null},  // SP CHECK-IN ONLY ECONOMY CT
  'TR':{ok:true,ph:null},
  'TK':{ok:false,ph:null},
  'JQ':{ok:true,ph:['ARR','GATE','CI']},  // อนุญาตเฉพาะ ARR,Gate agent,Crew Sign
  'AK':{ok:true,ph:['ARR','GATE']},  // อนุญาตเฉพาะARR,Gate agent
  'PG':{ok:true,ph:null},  // ไม่อนุญาตในตำแหน่ง Bogo
  'WK':{ok:false,ph:null},
  'ZF':{ok:false,ph:null},
  'CX':{ok:true,ph:['ARR','GATE']},  // อนุญาตเฉพาะARR,GATE
  'LY':{ok:true,ph:null},
  'MH':{ok:true,ph:null},
  'OM':{ok:true,ph:null},
  'DE':{ok:true,ph:null},
  'DV':{ok:true,ph:null},
  'W5':{ok:true,ph:null},
  'AY':{ok:true,ph:null},
  'KC':{ok:true,ph:['SUP','GATE','ARR']},  // ไม่อนุญาติในตำแหน่งCheckin
  'LJ':{ok:true,ph:['ARR','CI']},  // อนุญาติเฉพาะตำแหน่งขาเข้า,Crew sign
  'OV':{ok:false,ph:null},
  '8M':{ok:true,ph:['ARR','GATE']},  // อนุญาตเฉพาะARR,Gate agent
  '6E':{ok:true,ph:null},
  'IT':{ok:true,ph:['ARR','GATE','CI']},  // อนุญาตเฉพาะ ARR,Gate agent,Crew Sign
  'HO':{ok:false,ph:null},
  'AI':{ok:true,ph:['ARR','GATE','CI']},  // อนุญาตเฉพาะ ARR,Gate agent,Crew Sign
  'G9':{ok:true,ph:null},
  '9C':{ok:true,ph:null},
  'DK':{ok:true,ph:null},
  'VJ':{ok:true,ph:null},
  'OD':{ok:true,ph:null},
  'HH':{ok:true,ph:null},
  'EO':{ok:true,ph:null},
  'N4':{ok:true,ph:null},
  'WZ':{ok:true,ph:null},
  'LO':{ok:true,ph:null},
  'HX':{ok:true,ph:null},
  'G2':{ok:true,ph:null},
  'S7':{ok:true,ph:null},
  'UO':{ok:false,ph:null},
  '6B':{ok:true,ph:null},
  'BY':{ok:true,ph:null},
  'FY':{ok:false,ph:null},
  'HY':{ok:false,ph:null},
  'NO':{ok:true,ph:null},
  'SG':{ok:false,ph:null},
  'U6':{ok:false,ph:null},
  'G8':{ok:false,ph:null},
  'OZ':{ok:false,ph:null},
  'AF':{ok:true,ph:['GATE']},  // อนุญาติเฉพาะตำแหน่งgate agent
  'N0':{ok:false,ph:null},
  'CA':{ok:true,ph:null},  // 1 ไฟลท์อนุญาติ 1 คน นั่งเคาเตอร์ ต้องมีคนประกบ
  'MU':{ok:true,ph:['GATE']},  // อนุญาติเฉพาะตำแหน่ง Gate agent no bogo
  'CZ':{ok:true,ph:null},  // อนุญาติ Check in counter จาก ทีม ZF คนที่เคยทำไฟลท์ CZ มาก่อน
  'HU':{ok:true,ph:['GATE']},  // อนุญาติเฉพาะตำแหน่ง Gate agent no bogo
  'FM':{ok:true,ph:['GATE']},  // อนุญาติเฉพาะตำแหน่ง Gate agent no bogo
  '3U':{ok:true,ph:['GATE']},  // อนุญาติเฉพาะตำแหน่ง Gate agent no bogo
  'OQ':{ok:true,ph:null},
  '3K':{ok:false,ph:null},
  'ZH':{ok:true,ph:null},
  'KY':{ok:true,ph:null},
  'AQ':{ok:true,ph:null},
  'PN':{ok:true,ph:null},
  '8L':{ok:true,ph:null},
  '9H':{ok:true,ph:null},
  'C6':{ok:false,ph:null},
  'HB':{ok:false,ph:null},
  'VN':{ok:false,ph:null},
  'QZ':{ok:true,ph:['ARR','GATE']},  // อนุญาตเฉพาะARR,Gate agent
};
/** สายการบินนี้รับซัพพอร์ตในเฟสนี้ไหม → {ok:bool, reason:''} */
function slaCanSupport_(airline, phase) {
  var a = String(airline || '').toUpperCase();
  var c = AIRLINE_SUP[a] || (typeof SLA_ALIAS !== 'undefined' && SLA_ALIAS[a] ? AIRLINE_SUP[SLA_ALIAS[a]] : null);
  if (!c) return { ok: true, reason: '' };                      // ไม่มีในตาราง → อนุญาต (default)
  if (!c.ok) return { ok: false, reason: 'ไม่รับซัพพอร์ต (ใช้คนทีมตัวเอง)' };
  if (c.ph && c.ph.indexOf(phase) < 0) return { ok: false, reason: 'รับซัพพอร์ตเฉพาะ ' + c.ph.join('/') };
  return { ok: true, reason: '' };
}
