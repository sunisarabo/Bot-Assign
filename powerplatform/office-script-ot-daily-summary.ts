/*
 * office-script-ot-daily-summary.ts — Office Script (Excel Online) · ไฟล์ OT รวม
 *   อ่านชีต "ข้อมูลคำนวณ" (OT จริงรายคน×รายวัน · ~103k แถว)
 *   → สร้าง Table "OTDailySummary" (1 แถว/วัน/แผนก + แถวรวม ALL ต่อวัน)
 *   เพื่อให้ Power Automate/Power Apps ดึง "ทั้งเดือน" แบบเบา (เดือนละ ~100 แถว)
 *
 *   คอลัมน์ผลลัพธ์:
 *     DateKey (yyyy-mm-dd, text) · DateTH · Dept · People · Cases · Hours
 *     · Hrs_x1_5 · Hrs_x1_0 · Hrs_x3_0
 *
 *   parameter: srcName = ชื่อชีตต้นทาง (ค่าเริ่มต้น "ข้อมูลคำนวณ")
 * ใช้: เปิดไฟล์ OT รวมใน Excel Online → Automate → New Script → วาง → Run
 *   (รันซ้ำได้ · มันลบ/สร้างชีต OTDailySummary ใหม่ทุกครั้ง)
 */
function main(workbook: ExcelScript.Workbook, srcName: string = "ข้อมูลคำนวณ"): void {
  const ROYAL = "#1D428A";
  const MON_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

  const src = workbook.getWorksheet(srcName);
  if (!src) { console.log("ไม่พบชีต " + srcName); return; }
  const vals = src.getUsedRange().getValues();
  if (vals.length < 2) { console.log("ไม่มีข้อมูล"); return; }

  // --- หา index คอลัมน์จากหัว ---
  const hdr = vals[0].map(x => String(x == null ? "" : x).trim());
  const find = (pred: (h: string) => boolean) => { for (let i = 0; i < hdr.length; i++) if (pred(hdr[i])) return i; return -1; };
  const cDate = find(h => h === "วันที่");
  const cCode = find(h => h.indexOf("รหัส") >= 0);
  const cDept = find(h => h === "แผนก");
  const cRate = find(h => h.indexOf("อัตรา") >= 0);
  const cHrs = find(h => h === "ชั่วโมง");
  if (cDate < 0 || cCode < 0 || cDept < 0 || cHrs < 0) { console.log("หาหัวคอลัมน์ไม่ครบ (วันที่/รหัส/แผนก/ชั่วโมง)"); return; }

  // --- รวมยอดต่อ (DateKey × Dept) ---
  type Agg = { dateKey: string; dateTH: string; dept: string; people: { [c: string]: boolean }; cases: number; hrs: number; h15: number; h10: number; h30: number; };
  const map: { [k: string]: Agg } = {};
  const ord: string[] = [];                                   // คงลำดับการเจอ
  function bucket(key: string, dateKey: string, dateTH: string, dept: string): Agg {
    if (!map[key]) { map[key] = { dateKey, dateTH, dept, people: {}, cases: 0, hrs: 0, h15: 0, h10: 0, h30: 0 }; ord.push(key); }
    return map[key];
  }

  for (let i = 1; i < vals.length; i++) {
    const r = vals[i];
    const dk = toDateKey(r[cDate]); if (!dk.key) continue;
    const dept = String(r[cDept] == null ? "" : r[cDept]).trim() || "-";
    const code = String(r[cCode] == null ? "" : r[cCode]).trim();
    const hrs = num(r[cHrs]);
    const rate = cRate >= 0 ? num(r[cRate]) : 0;

    const targets = [bucket(dk.key + "|" + dept, dk.key, dk.th, dept), bucket(dk.key + "|ALL", dk.key, dk.th, "ALL")];
    for (const a of targets) {
      if (code) a.people[code] = true;
      a.cases++; a.hrs += hrs;
      if (rate === 1.5) a.h15 += hrs; else if (rate === 3) a.h30 += hrs; else a.h10 += hrs;
    }
  }

  // --- เรียง: วันที่ ↑ แล้ว ALL ไว้ท้ายของแต่ละวัน ---
  ord.sort((a, b) => {
    const A = map[a], B = map[b];
    if (A.dateKey !== B.dateKey) return A.dateKey < B.dateKey ? -1 : 1;
    if (A.dept === "ALL") return 1; if (B.dept === "ALL") return -1;
    return A.dept < B.dept ? -1 : 1;
  });

  const HEAD = ["DateKey", "DateTH", "Dept", "People", "Cases", "Hours", "Hrs_x1_5", "Hrs_x1_0", "Hrs_x3_0"];
  const body = ord.map(k => { const a = map[k]; return [a.dateKey, a.dateTH, a.dept, Object.keys(a.people).length, a.cases, r1(a.hrs), r1(a.h15), r1(a.h10), r1(a.h30)] as (string | number)[]; });

  // --- เขียนชีต + Table ---
  const outName = "OTDailySummary";
  const old = workbook.getWorksheet(outName); if (old) old.delete();
  const ws = workbook.addWorksheet(outName); ws.activate();
  ws.getRangeByIndexes(0, 0, 1, HEAD.length).setValues([HEAD]);
  if (body.length) ws.getRangeByIndexes(1, 0, body.length, HEAD.length).setValues(body);

  const tblRange = ws.getRangeByIndexes(0, 0, body.length + 1, HEAD.length);
  const tbl = workbook.addTable(tblRange, true);
  tbl.setName(outName);
  // DateKey เป็นข้อความ (กัน Excel แปลงเป็นวันที่ → filter eq ใน flow จะเพี้ยน)
  ws.getRangeByIndexes(1, 0, Math.max(body.length, 1), 1).setNumberFormat("@");
  ws.getRangeByIndexes(0, 0, 1, HEAD.length).getFormat().getFill().setColor(ROYAL);
  ws.getRangeByIndexes(0, 0, 1, HEAD.length).getFormat().getFont().setColor("#FFFFFF");
  ws.getUsedRange().getFormat().autofitColumns();

  const days = Object.keys(map).filter(k => map[k].dept === "ALL").length;
  console.log("OTDailySummary: " + body.length + " แถว · " + days + " วัน (Table ชื่อ " + outName + ")");

  // ---- helpers ----
  function toDateKey(v: (string | number | boolean)): { key: string; th: string } {
    let d: Date | null = null;
    if (typeof v === "number" && isFinite(v) && v > 0) {
      d = new Date(Math.round((v - 25569) * 86400 * 1000));    // Excel serial → UTC Date
    } else {
      const s = String(v || "").trim(); if (!s) return { key: "", th: "" };
      const t = Date.parse(s); if (!isFinite(t)) return { key: "", th: "" }; d = new Date(t);
    }
    const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
    const key = y + "-" + ("0" + (m + 1)).slice(-2) + "-" + ("0" + day).slice(-2);
    const th = day + " " + MON_TH[m] + " " + ((y + 543) % 100);
    return { key, th };
  }
  function num(v: (string | number | boolean)): number { const x = Number(String(v == null ? "" : v).trim()); return isFinite(x) ? x : 0; }
  function r1(n: number): number { return Math.round(n * 10) / 10; }
}
