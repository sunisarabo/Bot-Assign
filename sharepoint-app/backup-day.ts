// backup-day.ts — สำรองข้อมูลดิบของ 1 วัน (จาก SharePoint Lists) ลงไฟล์ Excel รายเดือน
// 1 ไฟล์ = 1 เดือน (เช่น PAS_2026-10.xlsx) · 1 แท็บ = 1 วัน (เช่น 10OCT) · แท็บ INDEX = สารบัญ
// Flow K เรียกทีละ List: first = true ตอน List แรก → ล้างแท็บวันนั้นแล้วเขียนใหม่
// v1.1 · 12 ต.ค. 2569

type Cell = string | number | boolean;
type Obj = { [k: string]: unknown };

const BK_SKIP = [
  "FileSystemObjectType",
  "ServerRedirectedEmbedUri",
  "ServerRedirectedEmbedUrl",
  "ContentTypeId",
  "ComplianceAssetId",
  "GUID",
  "Attachments",
  "AuthorId",
  "EditorId",
  "Id",
  "__metadata",
];
const BK_MON = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];
// ลำดับ List ในแท็บ (ใช้เรียงใน INDEX)
const BK_ORDER = [
  "PAS_Manpower",
  "PAS_DayStats",
  "PAS_Duty",
  "PAS_Assignment",
  "PAS_OT_Person",
  "PAS_FlightSLA",
  "PAS_Support",
  "PAS_AutoPlan",
  "PAS_DataIssue",
];
const BK_MAXLEN = 32000;
const BK_CHUNK = 400;
const BK_IDX = "INDEX";
const BK_IDX_HEAD = ["วันที่", "แท็บ", "List", "แถว", "คอลัมน์", "สำรองเมื่อ"];

function bkTab(day: string): string {
  const m = day.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return m[3] + BK_MON[Number(m[2]) - 1];
}

function bkNow(): string {
  // เวลาไทย (UTC+7)
  const d = new Date(Date.now() + 7 * 3600000);
  const p = (n: number) => (n < 10 ? "0" : "") + n;
  const ymd =
    d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate());
  return ymd + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes());
}

function bkRows(json: string): Obj[] {
  if (!json) return [];
  const v: unknown = JSON.parse(json);
  if (Array.isArray(v)) return v as Obj[];
  const o = v as Obj;
  if (o && Array.isArray(o.value)) return o.value as Obj[];
  if (o && Array.isArray(o.d)) return o.d as Obj[];
  return [];
}

function bkKeep(k: string): boolean {
  if (BK_SKIP.indexOf(k) >= 0) return false;
  if (k.indexOf("odata") === 0) return false;
  if (k.indexOf("OData_") === 0) return false;
  return true;
}

function bkCols(rows: Obj[]): string[] {
  const cols: string[] = [];
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (bkKeep(k) && cols.indexOf(k) < 0) cols.push(k);
    }
  }
  return cols;
}

function bkCell(v: unknown): Cell {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "boolean") return v;
  let s = typeof v === "string" ? v : JSON.stringify(v);
  // Choice แบบมี metadata: {"Value":"WORKING"}
  if (typeof v === "object" && v !== null) {
    const o = v as Obj;
    if (typeof o.Value === "string") s = o.Value;
  }
  if (s.length > BK_MAXLEN) s = s.substring(0, BK_MAXLEN) + "…";
  if (s === "") return "";
  // ' นำหน้า = เก็บเป็นข้อความตามจริง (ไม่แปลงเป็นเวลา/ตัวเลข/สูตร)
  return "'" + s;
}

function bkOrder(workbook: ExcelScript.Workbook) {
  const names = workbook
    .getWorksheets()
    .map((w) => w.getName())
    .filter((n) => /^\d{2}[A-Z]{3}$/.test(n));
  names.sort();
  const idx = workbook.getWorksheet(BK_IDX);
  if (idx) idx.setPosition(0);
  let pos = idx ? 1 : 0;
  for (const n of names) {
    const w = workbook.getWorksheet(n);
    if (w) w.setPosition(pos);
    pos++;
  }
}

function bkIndex(
  workbook: ExcelScript.Workbook,
  day: string,
  tab: string,
  list: string,
  n: number,
  nc: number,
  first: boolean
) {
  let ws = workbook.getWorksheet(BK_IDX);
  if (!ws) ws = workbook.addWorksheet(BK_IDX);
  const used = ws.getUsedRange(true);
  const old: Cell[][] = used ? used.getValues() : [];
  const keep: Cell[][] = [];
  for (let i = 1; i < old.length; i++) {
    const r = old[i];
    const d = String(r[0]);
    if (!d) continue;
    if (d === day && (first || String(r[2]) === list)) continue;
    keep.push(r.slice(0, 6));
  }
  keep.push([day, tab, list, n, nc, bkNow()]);
  const ord = (l: Cell) => {
    const i = BK_ORDER.indexOf(String(l));
    return i < 0 ? 99 : i;
  };
  keep.sort((a, b) => {
    const da = String(a[0]);
    const db = String(b[0]);
    if (da !== db) return da < db ? -1 : 1;
    return ord(a[2]) - ord(b[2]);
  });
  if (used) used.clear();
  const out: Cell[][] = [BK_IDX_HEAD];
  for (const r of keep) {
    // วันที่เก็บเป็นข้อความ (ไม่ให้ Excel แปลงเป็นวันที่)
    const d0 = "'" + String(r[0]);
    out.push([d0, r[1], r[2], r[3], r[4], "'" + String(r[5])]);
  }
  ws.getRangeByIndexes(0, 0, out.length, 6).setValues(out);
  const h = ws.getRangeByIndexes(0, 0, 1, 6).getFormat();
  h.getFont().setBold(true);
  h.getFill().setColor("#BFE3FF");
}

function main(
  workbook: ExcelScript.Workbook,
  day: string,
  list: string,
  rows: string,
  first?: boolean
) {
  const tab = bkTab(day || "");
  if (!tab) return { status: "error", reason: "day ต้องเป็น yyyy-mm-dd: " + day };
  const data = bkRows(rows || "");
  const cols = bkCols(data);

  // first = ลบแท็บวันนั้นทิ้งแล้วสร้างใหม่
  const prev = workbook.getWorksheet(tab);
  if (prev && first) prev.delete();
  let ws = workbook.getWorksheet(tab);
  if (!ws) ws = workbook.addWorksheet(tab);

  // ต่อท้ายบล็อกเดิม (เว้น 1 แถว)
  const used = ws.getUsedRange(true);
  let r0 = 0;
  if (used) r0 = used.getRowIndex() + used.getRowCount() + 1;

  const nc = Math.max(1, cols.length);
  const title = "■ " + list + " · " + data.length + " แถว · วันที่ " + day;
  ws.getRangeByIndexes(r0, 0, 1, 1).setValue("'" + title);
  const tf = ws.getRangeByIndexes(r0, 0, 1, nc).getFormat();
  tf.getFont().setBold(true);
  tf.getFill().setColor("#13315C");
  tf.getFont().setColor("#FFFFFF");

  if (cols.length) {
    const head: Cell[][] = [cols.map((c) => "'" + c)];
    ws.getRangeByIndexes(r0 + 1, 0, 1, nc).setValues(head);
    const hf = ws.getRangeByIndexes(r0 + 1, 0, 1, nc).getFormat();
    hf.getFont().setBold(true);
    hf.getFill().setColor("#BFE3FF");
    for (let i = 0; i < data.length; i += BK_CHUNK) {
      const part = data.slice(i, i + BK_CHUNK);
      const vals: Cell[][] = part.map((o) => cols.map((c) => bkCell(o[c])));
      ws.getRangeByIndexes(r0 + 2 + i, 0, vals.length, nc).setValues(vals);
    }
  } else {
    ws.getRangeByIndexes(r0 + 1, 0, 1, 1).setValue("(ไม่มีข้อมูล)");
  }

  bkIndex(workbook, day, tab, list, data.length, cols.length, !!first);
  bkOrder(workbook);
  // ลบแท็บว่างตั้งต้นของไฟล์แม่แบบ (Sheet1 / ชีต1) ถ้ามีแท็บวันแล้ว
  for (const n of ["Sheet1", "ชีต1"]) {
    const s = workbook.getWorksheet(n);
    if (s && !s.getUsedRange(true)) s.delete();
  }
  return { status: "ok", sheet: tab, list: list, rows: data.length, cols: cols.length };
}
