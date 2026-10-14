/*
 * office-script-prewc.ts — Office Script (Excel Online) · ไฟล์ Pre-Wheelchair (จองล่วงหน้า)
 *   อ่านแท็บรายวัน (01OCT26…31OCT26) → สร้างชีต "Pre-WC Dashboard":
 *     - KPI: จองรวมเดือน / ARR / DEP / แยกชนิด (WCHR/WCHS/WCHC/AVIH/MAAS)
 *     - ตารางรายวัน: ARR, DEP, รวม, แยกชนิด
 *     - แยกสายการบิน + กราฟจองรายวัน  (ดูวันอนาคตได้ — เป็นยอด "จองล่วงหน้า")
 *
 *   คอลัมน์แท็บรายวัน (0-based · แถวข้อมูลเริ่มที่ airlines(0) ไม่ว่าง):
 *     0=Airlines 1=Flt 2=Routing · ARR: 9=WCHR 10=WCHS 11=WCHC 12=AVIH 13=MAAS 14=TOTAL
 *     · DEP: 15=WCHR 16=WCHS 17=WCHC 18=AVIH 19=MAAS 20=TOTAL
 * ใช้: Excel Online (ไฟล์ Pre-WC) → Automate → New Script → วาง → Run
 */
function main(workbook: ExcelScript.Workbook): number {
  const ROYAL = "#1D428A";
  const SVC = ["WCHR", "WCHS", "WCHC", "AVIH", "MAAS"];
  const ARR = { WCHR: 9, WCHS: 10, WCHC: 11, AVIH: 12, MAAS: 13 };
  const DEP = { WCHR: 15, WCHS: 16, WCHC: 17, AVIH: 18, MAAS: 19 };
  const isDay = (s: string) => /^\d{2}[A-Z]{3}\d{2}$/.test(s);
  const num = (v: (string | number | boolean)) => { const n = Number(String(v == null ? "" : v).trim()); return isFinite(n) ? n : 0; };

  type Day = { date: string; arr: number; dep: number; svc: { [k: string]: number } };
  const days: Day[] = [];
  const byAir: { [k: string]: number } = {};
  let tArr = 0, tDep = 0; const tSvc: { [k: string]: number } = {};

  for (const ws of workbook.getWorksheets()) {
    const nm = ws.getName(); if (!isDay(nm)) continue;
    const g = ws.getRange("A1:Z150").getValues();
    const d: Day = { date: nm, arr: 0, dep: 0, svc: {} };
    for (const r of g) {
      const air = String(r[0] || "").trim();
      if (!air || air === "Airlines" || air.length > 4) continue;    // แถวไฟลท์จริง
      const a = num(r[14]), dp = num(r[20]);
      d.arr += a; d.dep += dp; tArr += a; tDep += dp;
      if (a + dp > 0) byAir[air] = (byAir[air] || 0) + a + dp;
      for (const s of SVC) {
        const v = num(r[ARR[s as keyof typeof ARR]]) + num(r[DEP[s as keyof typeof DEP]]);
        if (v) { d.svc[s] = (d.svc[s] || 0) + v; tSvc[s] = (tSvc[s] || 0) + v; }
      }
    }
    days.push(d);
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  const total = tArr + tDep;

  // ---- Dashboard ----
  const old = workbook.getWorksheet("Pre-WC Dashboard"); if (old) old.delete();
  const d = workbook.addWorksheet("Pre-WC Dashboard"); d.activate();
  bold(d.getRange("A1"), "PAS · Pre-WC Dashboard (จองล่วงหน้า)", 18, ROYAL);

  const kh = ["จองรวม", "ARR", "DEP"].concat(SVC);
  const kv: (string | number)[] = [total, tArr, tDep].concat(SVC.map(s => tSvc[s] || 0));
  d.getRangeByIndexes(2, 0, 1, kh.length).setValues([kh]);
  d.getRangeByIndexes(2, 0, 1, kh.length).getFormat().getFont().setBold(true);
  d.getRangeByIndexes(3, 0, 1, kv.length).setValues([kv]);
  d.getRangeByIndexes(3, 0, 1, kv.length).getFormat().getFont().setColor(ROYAL);
  d.getRangeByIndexes(3, 0, 1, kv.length).getFormat().getFont().setSize(13);

  const hr = 6;
  const head = ["วันที่", "ARR", "DEP", "รวม"].concat(SVC);
  d.getRangeByIndexes(hr - 1, 0, 1, head.length).setValues([head]);
  headerFmt(d.getRangeByIndexes(hr - 1, 0, 1, head.length), ROYAL);
  const body = days.map(x => ([x.date, x.arr, x.dep, x.arr + x.dep] as (string | number)[]).concat(SVC.map(s => x.svc[s] || 0)));
  if (body.length) d.getRangeByIndexes(hr, 0, body.length, head.length).setValues(body);

  const airRows = Object.keys(byAir).map(a => [a, byAir[a]] as (string | number)[]).sort((a, b) => (b[1] as number) - (a[1] as number));
  const ac = head.length + 2;
  d.getRangeByIndexes(hr - 1, ac, 1, 2).setValues([["สายการบิน", "จอง"]]);
  headerFmt(d.getRangeByIndexes(hr - 1, ac, 1, 2), ROYAL);
  if (airRows.length) d.getRangeByIndexes(hr, ac, airRows.length, 2).setValues(airRows);

  const chart = d.addChart(ExcelScript.ChartType.columnClustered, d.getRangeByIndexes(hr - 1, 0, body.length + 1, 4));
  chart.setPosition(d.getRangeByIndexes(hr + body.length + 1, 0), d.getRangeByIndexes(hr + body.length + 16, 9));
  chart.getTitle().setText("ยอดจองรถเข็นรายวัน (ARR/DEP)");

  d.getUsedRange().getFormat().autofitColumns();
  console.log("Pre-WC: จองรวม " + total + " (ARR " + tArr + " / DEP " + tDep + ") · " + days.length + " วัน");
  return total;
}
function bold(rg: ExcelScript.Range, text: string, size: number, color: string) { rg.setValue(text); rg.getFormat().getFont().setSize(size); rg.getFormat().getFont().setBold(true); rg.getFormat().getFont().setColor(color); }
function headerFmt(rg: ExcelScript.Range, color: string) { rg.getFormat().getFill().setColor(color); rg.getFormat().getFont().setColor("#FFFFFF"); rg.getFormat().getFont().setBold(true); }
