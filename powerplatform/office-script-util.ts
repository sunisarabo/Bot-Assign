/*
 * office-script-util.ts — Office Script (Excel Online) คำนวณ Util แบบ merge ช่วงซ้อน "เป๊ะ"
 *   พอร์ตตรงจาก backend/productivity.js (winOf + mergeMinutes + clamp เข้าเวลากะ)
 *   ใช้จาก Power Automate: Action "Run script" → ส่ง duties + assignments (เวลาเป็น "นาที")
 *   → คืน [{dutyId, dutyMin, busyMin, util, idleMin}] เอาไปเขียน pas_duty.pas_duty_min/pas_busy_min
 *
 * ทำไมต้องใช้: flow แปลง expression รวมช่วงซ้อนไม่ได้ · สคริปต์นี้ merge interval ได้จริง (เท่า Node module)
 */
const DEP_LEAD = 60;   // ขาออก: ยุ่งก่อน STD
const ARR_TAIL = 45;   // ขาเข้า: ยุ่งหลัง STA
const DEF_JOB  = 45;   // งานไม่มีเวลา

interface Assignment { dutyId: string; sta?: number; std?: number; counterOpen?: number; counterClose?: number; }
interface Duty { dutyId: string; shiftStart?: number; shiftEnd?: number; }
interface Result { dutyId: string; dutyMin: number; busyMin: number; util: number | null; idleMin: number; }

function main(workbook: ExcelScript.Workbook, duties: Duty[], assignments: Assignment[]): Result[] {
  // จัดกลุ่ม assignment ตาม duty
  const byDuty: { [k: string]: Assignment[] } = {};
  for (const a of assignments) { (byDuty[a.dutyId] = byDuty[a.dutyId] || []).push(a); }

  return duties.map((d) => {
    let ds = d.shiftStart, de = d.shiftEnd;
    if (ds != null && de != null && de <= ds) de += 1440;                 // ข้ามเที่ยงคืน
    const dutyMin = (ds != null && de != null) ? de - ds : 0;

    let iv: number[][] = (byDuty[d.dutyId] || []).map(winOf).filter((w): w is number[] => w !== null);
    if (dutyMin > 0) iv = clampIv(iv, ds as number, de as number);       // clamp เข้าเวลากะ
    const busyMin = mergeMinutes(iv);
    const util = dutyMin > 0 ? Math.min(100, Math.round(busyMin / dutyMin * 100)) : null;
    const idleMin = dutyMin > 0 ? Math.max(0, dutyMin - busyMin) : 0;
    return { dutyId: d.dutyId, dutyMin, busyMin, util, idleMin };
  });
}

// ช่วง [lo,hi] นาทีที่ assignment ทำให้ติดงาน (null = ประมาณไม่ได้)
function winOf(a: Assignment): number[] | null {
  const op = a.counterOpen, cl = a.counterClose, sta = a.sta, std = a.std;
  if (op != null && cl != null) return [op, cl < op ? cl + 1440 : cl];   // เคาน์เตอร์
  if (std != null) return [Math.max(0, std - DEP_LEAD), std];            // ขาออก
  if (sta != null) return [sta, sta + ARR_TAIL];                         // ขาเข้า
  if (op != null) return [op, op + DEF_JOB];
  return null;
}
// รวมช่วงซ้อน → ผลรวมนาทีจริง (ไม่นับซ้ำ)
function mergeMinutes(iv: number[][]): number {
  if (!iv.length) return 0;
  iv = iv.slice().sort((a, b) => a[0] - b[0]);
  let total = 0, lo = iv[0][0], hi = iv[0][1];
  for (let i = 1; i < iv.length; i++) {
    if (iv[i][0] <= hi) { hi = Math.max(hi, iv[i][1]); }
    else { total += hi - lo; lo = iv[i][0]; hi = iv[i][1]; }
  }
  return total + (hi - lo);
}
function clampIv(iv: number[][], lo: number, hi: number): number[][] {
  const out: number[][] = [];
  for (const seg of iv) { const x = Math.max(seg[0], lo), y = Math.min(seg[1], hi); if (y > x) out.push([x, y]); }
  return out;
}
