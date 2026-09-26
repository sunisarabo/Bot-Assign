/**
 * AirlineSupport.gs — กฎการรับพนักงานซัพพอร์ตรายสายการบิน (จากไฟล์ Data Airlines Check)
 * ok = สายนี้รับซัพพอร์ตไหม (false = ไม่รับเลย ต้องใช้คนทีมตัวเอง)
 * ph = เฟสที่อนุญาตให้ซัพพอร์ต (null = ทุกเฟส) — อ้างอิงไฟล์ Name_List_and_Support_allowance
 * เฟส: SUP · CI(เช็คอิน) · ARR(ขาเข้า) · GATE(gate agent/controller/BOCO) — ทุกสาย Supervisor/FC = No → ไม่รับซัพ SUP ข้ามทีม
 */
var AIRLINE_SUP = {
  'AK':{ok:true,ph:['ARR','GATE']},  // AirAsia Berhad (Malaysia — ARR/GATE
  'QZ':{ok:true,ph:['ARR','GATE']},  // Indonesia AirAsia — ARR/GATE
  '8M':{ok:true,ph:['ARR','GATE']},  // Myanmar Airways Internat — ARR/GATE
  'ZF':{ok:true,ph:['CI','ARR','GATE']},  // Azur Air — CI/ARR/GATE
  'LO':{ok:true,ph:['CI','ARR','GATE']},  // LOT Polish Airlines — CI/ARR/GATE
  'N4':{ok:true,ph:['ARR','GATE']},  // Nordwind Airlines — ARR/GATE
  'HH':{ok:true,ph:['CI','ARR','GATE']},  // Qanot Sharq Airlines — CI/ARR/GATE
  'EO':{ok:true,ph:['ARR','GATE']},  // IKAR Airlines (Pegas Fly — ARR/GATE
  'S7':{ok:true,ph:['ARR','GATE']},  // S7 Airlines — ARR/GATE
  'CZ':{ok:true,ph:['ARR','GATE']},  // China Southern Airlines — ARR/GATE
  'MU':{ok:true,ph:['GATE']},  // China Eastern — เฉพาะ Gate agent (no bogo) ตามไฟล์
  'FM':{ok:true,ph:['GATE']},  // Shanghai — เฉพาะ Gate agent (no bogo) ตามไฟล์
  '3U':{ok:true,ph:['GATE']},  // Sichuan — เฉพาะ Gate agent (no bogo) ตามไฟล์
  'CA':{ok:true,ph:['ARR','GATE']},  // Air China — ARR/GATE
  'HO':{ok:true,ph:['ARR','GATE']},  // Juneyao Airlines — ARR/GATE
  'HX':{ok:true,ph:['ARR','GATE']},  // Hong Kong Airlines — ARR/GATE
  'HU':{ok:true,ph:['GATE']},  // Hainan — เฉพาะ Gate agent (no bogo) ตามไฟล์
  '6B':{ok:true,ph:['ARR','GATE']},  // TUI fly Nordic — ARR/GATE
  'BY':{ok:true,ph:['ARR','GATE']},  // TUI Airways — ARR/GATE
  'UO':{ok:false,ph:null},  // HK Express — ไม่รับซัพ (ไฟล์ Data Airlines Check)
  'EK':{ok:false,ph:null},  // Emirates — ไม่รับซัพ
  'FY':{ok:false,ph:null},  // Firefly — ไม่รับซัพ
  'EY':{ok:true,ph:['ARR','GATE']},  // Etihad Airways — ARR/GATE
  'AY':{ok:true,ph:['ARR','GATE']},  // Finnair — ARR/GATE
  'DV':{ok:true,ph:['CI','ARR','GATE']},  // SCAT Airlines — CI/ARR/GATE
  'AI':{ok:true,ph:['ARR','GATE']},  // Air India — ARR/GATE
  'IX':{ok:true,ph:['ARR','GATE']},  // Air India Express — ARR/GATE
  'JQ':{ok:true,ph:['ARR','GATE']},  // Jetstar Airways — ARR/GATE
  'IT':{ok:true,ph:['CI','ARR','GATE']},  // Tigerair Taiwan — CI/ARR/GATE
  'KC':{ok:true,ph:['ARR','GATE']},  // Air Astana — ARR/GATE
  'OZ':{ok:false,ph:null},  // Asiana Airlines — ไม่รับซัพ
  'KE':{ok:false,ph:null},  // Korean Air — ไม่รับซัพ
  'LJ':{ok:true,ph:['ARR']},  // Jin Air — รับซัพเฉพาะขาเข้า (+Crew sign) ตามไฟล์
  'NO':{ok:true,ph:['ARR','GATE']},  // Neos — ARR/GATE
  'OV':{ok:true,ph:['ARR','GATE']},  // SalamAir — ARR/GATE
  'PG':{ok:true,ph:['ARR','GATE']},  // Bangkok Airways — ARR/GATE (รับขาเข้าด้วย)
  'PRIVATE':{ok:true,ph:['ARR']},  // Private Flight / General — ARR
  'QR':{ok:false,ph:null},  // Qatar Airways — ไม่รับซัพ
  'DE':{ok:true,ph:['ARR','GATE']},  // Condor — ARR/GATE
  'MH':{ok:true,ph:['ARR','GATE']},  // Malaysia Airlines — รับซัพ ARR/GATE (ไฟล์ Data Airlines Check)
  'OM':{ok:true,ph:['ARR','GATE']},  // Miat Mongolian Airlines — ARR/GATE
  'SQ':{ok:true,ph:['ARR','GATE']},  // Singapore Airlines — ARR/GATE
  'CX':{ok:true,ph:['ARR','GATE']},  // Cathay Pacific — ARR/GATE
  'LY':{ok:true,ph:['CI','ARR','GATE']},  // El Al Israel Airlines — CI/ARR/GATE
  'SU':{ok:true,ph:['ARR','GATE']},  // Aeroflot Russian Airline — ARR/GATE
  'W5':{ok:true,ph:['ARR','GATE']},  // Mahan Air — ARR/GATE
  'B2':{ok:false,ph:null},  // Belavia Belarusian Airli — ไม่รับซัพ
  'TK':{ok:false,ph:null},  // Turkish Airlines — ไม่รับซัพ
  'HY':{ok:true,ph:['ARR','GATE']},  // Uzbekistan Airways — ARR/GATE
  'OD':{ok:true,ph:['ARR','GATE']},  // Batik Air Malaysia — ARR/GATE
  'VJ':{ok:true,ph:['ARR','GATE']},  // VietJet Air — ARR/GATE
  'SG':{ok:true,ph:['ARR','GATE']},  // SpiceJet — ARR/GATE
  'TR':{ok:true,ph:['ARR','GATE']},  // Scoot — ARR/GATE
  '6E':{ok:true,ph:['ARR','GATE']},  // IndiGo — ARR/GATE
  'QP':{ok:true,ph:['ARR','GATE']},  // Akasa Air — ARR/GATE
  'WK':{ok:true,ph:['ARR','GATE']},  // Edelweiss Air — ARR/GATE
  'SV':{ok:true,ph:['ARR','GATE']},  // Saudia — ARR/GATE
  'G9':{ok:true,ph:['ARR','GATE']},  // Air Arabia — ARR/GATE
  'WY':{ok:true,ph:['ARR','GATE']},  // Oman Air — ARR/GATE
  '9C':{ok:true,ph:['ARR','GATE']},  // Spring Airlines — ARR/GATE
  'DK':{ok:true,ph:['CI','ARR','GATE']},  // Sunclass Airlines — CI/ARR/GATE
  // ── สายที่ไม่อยู่ในไฟล์ Support Allowance (คงค่าเดิมไว้) ──
  '3K':{ok:false,ph:null},
  '8L':{ok:true,ph:null},
  '9H':{ok:true,ph:null},
  'AF':{ok:true,ph:['GATE']},
  'AQ':{ok:true,ph:null},
  'C6':{ok:false,ph:null},
  'G2':{ok:true,ph:null},
  'G8':{ok:false,ph:null},
  'HB':{ok:false,ph:null},
  'KY':{ok:true,ph:null},
  'N0':{ok:false,ph:null},
  'OQ':{ok:true,ph:null},
  'PN':{ok:true,ph:null},
  'U6':{ok:false,ph:null},
  'VN':{ok:true,ph:['ARR','GATE']},  // Vietnam Airlines — รับซัพ ARR/GATE (เหมือนสายต่างชาติทั่วไป)
  'WZ':{ok:true,ph:null},
  'ZH':{ok:true,ph:null},
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
