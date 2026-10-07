/*
 * import-master.ts — Office Script: 00.Master.xlsx → SharePoint List PAS_Employees (sync อัตโนมัติ)
 *   อ่านชีต "Total" + ทุกชีต "BKK Batch …" ด้วยกติกาเดียวกับ MasterReader.gs / DbExport.gs (rbExportMasterObj_)
 *   เรียกจาก Power Automate (Flow B แถวคิว kind = MASTER) · ไม่แก้ไฟล์ต้นทาง
 *
 * พารามิเตอร์
 *   filePath = path ไฟล์ (เก็บใน master_file)
 *   existing = ข้อความ JSON ของแถวเดิมใน List: [{"ID":1,"Title":"2607384","row_hash":"…"}, …]
 *              (ใน flow: Get items PAS_Employees → Select ID/Title/row_hash → string(body('Select')))
 *   siteUrl  = (ไม่บังคับ)
 *
 * ผล: upsert ตามรหัสพนักงาน (Title)
 *   ใหม่ → POST · เปลี่ยน (row_hash ต่าง) → MERGE · เหมือนเดิม → ข้าม · หายไปจากไฟล์ → DELETE
 *   คืน { status, reason, counts{…}, batches[{list,boundary,body,n}] }  — ส่งด้วย "Send an HTTP request to SharePoint" (_api/$batch)
 *
 * แหล่งข้อมูล: ไฟล์ Manpower ของไซต์ PS-Manpower (แนะนำ — รายชื่อครบ) หรือ 00.Master.xlsx ในโฟลเดอร์ปี — โครงเดียวกัน
 * ชีต: "Total" → ถ้าไม่มี ใช้ชีตแรกที่มีหัว "รหัส"+"ชื่อ" (ไม่ใช่ BKK Batch)
 * คอลัมน์: หาจากหัวตาราง (รหัส/ทีม/ชื่อ/สกุล/แผนก/ตำแหน่ง/เริ่มงาน/Name/Surname/พ้นสภาพ/สถานะ) — ไม่เจอใช้ตำแหน่งเดิม:
 * Total (0-based): 1=รหัส 2=ทีม 3=คำนำหน้า 4=ชื่อ 5=สกุล 6=แผนก 7=ตำแหน่ง 8=เริ่มงาน 10=Name 11=Surname 12=พ้นสภาพ 13=สถานะ
 * BKK Batch: หาแถวหัวที่มี "รหัส"+"ชื่อ" · 1=รหัส(B…) 2=ทีม 4=ชื่อ 5=สกุล 7=ตำแหน่ง
 */
const SITE_M = "https://aotgath.sharepoint.com/sites/0AAYJ05_KoLORUk9PVA";
const LIST_EMP = "PAS_Employees";
const BATCH_M = 100;
const DEPT_PSA = "การโดยสาร", DEPT_LL = "ติดตามสัมภาระ";
// ไม่เกิน 50% ของรายชื่อเดิมถูกลบในรอบเดียว — กันไฟล์ผิด/ชีตหายแล้วล้างรายชื่อทั้งหมด
const MAX_DELETE_RATIO = 0.5;

type CellM = string | number | boolean;
interface Emp { Title: string; name_th: string; name_en: string; team: string; dept: string; position: string; pos_group: string; source: string; status: string; start_date: string | null; resign_date: string | null; master_file: string; row_hash: string }
interface MBatch { list: string; boundary: string; body: string; n: number }
interface Old { ID: number; Title: string; row_hash?: string }

function main(workbook: ExcelScript.Workbook, filePath?: string, existing?: string, siteUrl?: string) {
  const site = (siteUrl || SITE_M).replace(/\/$/, "");
  const file = filePath || "";
  const total = workbook.getWorksheet("Total") || findEmployeeSheet(workbook);
  const zero = { total: 0, active: 0, resigned: 0, psa: 0, ll: 0, bkk: 0, globex: 0, created: 0, updated: 0, unchanged: 0, deleted: 0 };
  if (!total) return { status: "skipped", reason: "ไม่พบชีต Total หรือชีตที่มีหัว รหัส+ชื่อ — ไม่ใช่ไฟล์รายชื่อพนักงาน", counts: zero, batches: [] as MBatch[] };

  const today = isoToday();
  const emp: { [code: string]: Emp } = {};
  const data = total.getUsedRange().getValues();
  const col = columnMap(data);
  for (let i = col.header + 1; i < data.length; i++) {
    const r = data[i];
    const at = (k: string): CellM => (col.c[k] >= 0 ? r[col.c[k]] : "");
    const code = digits(at("code"));
    if (!/^\d{6,8}$/.test(code)) continue;
    const team = str(at("team")), deptRaw = str(at("dept")), pos = str(at("pos"));
    const dept = deptRaw.indexOf(DEPT_PSA) >= 0 ? "PSA" : (deptRaw.indexOf(DEPT_LL) >= 0 ? "LL" : "OTHER");
    const st = str(at("status")).toUpperCase(), resign = toIso(at("resign"));
    const resigned = st === "RESIGNED" || st.indexOf("ลาออก") >= 0 || st.indexOf("พ้นสภาพ") >= 0 || (st !== "ACTIVE" && !!resign && resign < today);
    const th = col.c.fullTh >= 0 ? str(at("fullTh")) : join(at("first"), at("last"));
    emp[code] = mk(code, th, join(at("nameEn"), at("surEn")), team, dept, pos, "HKT", resigned ? "RESIGNED" : "ACTIVE", toIso(at("start")), resign, file);
  }
  if (!Object.keys(emp).length) return { status: "skipped", reason: "ชีต " + total.getName() + " ไม่มีรหัสพนักงาน 6–8 หลัก", counts: zero, batches: [] as MBatch[] };

  // BKK Batch (ทุกแท็บ) → source BKK · ไม่มีใน Total = เพิ่มเป็น PSA ACTIVE
  let bkk = 0;
  for (const ws of workbook.getWorksheets()) {
    const nm = ws.getName();
    if (!/BKK/i.test(nm) || !/BATCH/i.test(nm)) continue;
    const g = ws.getUsedRange().getValues();
    let hi = -1;
    for (let h = 0; h < Math.min(8, g.length); h++) {
      const u = g[h].map(c => str(c));
      if (u.some(c => /รหัส/.test(c)) && u.some(c => /ชื่อ/.test(c))) { hi = h; break; }
    }
    for (let i = hi >= 0 ? hi + 1 : 1; i < g.length; i++) {
      const code = digits(g[i][1]);
      if (!/^\d{6,8}$/.test(code)) continue;
      bkk++;
      if (emp[code]) { emp[code].source = "BKK"; continue; }
      emp[code] = mk(code, join(g[i][4], g[i][5]), "", str(g[i][2]), "PSA", str(g[i][7]) || "Passenger Services Agent", "BKK", "ACTIVE", null, null, file);
    }
  }
  const list = Object.keys(emp).map(c => emp[c]);
  for (const e of list) {
    if (e.source !== "BKK" && e.pos_group === "Globlex") e.source = "GLOBEX";
    e.row_hash = hash([e.name_th, e.name_en, e.team, e.dept, e.position, e.pos_group, e.source, e.status, e.start_date, e.resign_date].join("|"));
  }

  // ---- upsert ----
  const old: Old[] = existing ? JSON.parse(existing) : [];
  const byCode: { [c: string]: Old } = {};
  for (const o of old) if (o && o.Title) byCode[String(o.Title)] = o;
  const ops: { method: string; id: number; row: Emp | null }[] = [];
  const counts = { total: list.length, active: 0, resigned: 0, psa: 0, ll: 0, bkk, globex: 0, created: 0, updated: 0, unchanged: 0, deleted: 0 };
  for (const e of list) {
    if (e.status === "ACTIVE") counts.active++; else counts.resigned++;
    if (e.status === "ACTIVE" && e.dept === "PSA") counts.psa++;
    if (e.status === "ACTIVE" && e.dept === "LL") counts.ll++;
    if (e.source === "GLOBEX") counts.globex++;
    const o = byCode[e.Title];
    if (!o) { ops.push({ method: "POST", id: 0, row: e }); counts.created++; }
    else if (o.row_hash !== e.row_hash) { ops.push({ method: "MERGE", id: o.ID, row: e }); counts.updated++; }
    else counts.unchanged++;
  }
  const dels = old.filter(o => o && o.Title && !emp[String(o.Title)]);
  if (old.length >= 20 && dels.length > old.length * MAX_DELETE_RATIO)
    return { status: "skipped", reason: "จะลบ " + dels.length + "/" + old.length + " คน (เกิน 50%) — หยุดไว้ก่อน ตรวจไฟล์ Master", counts, batches: [] as MBatch[] };
  for (const o of dels) { ops.push({ method: "DELETE", id: o.ID, row: null }); counts.deleted++; }

  return { status: "ok", reason: "", counts, batches: toBatches(site, ops) };
}

function mk(code: string, th: string, en: string, team: string, dept: string, pos: string, source: string, status: string, start: string | null, resign: string | null, file: string): Emp {
  return { Title: code, name_th: th, name_en: en, team, dept, position: pos, pos_group: dept === "LL" ? llGroup(pos) : posGroup(pos, team),
    source, status, start_date: start, resign_date: resign, master_file: file, row_hash: "" };
}

function toBatches(site: string, ops: { method: string; id: number; row: Emp | null }[]): MBatch[] {
  const CRLF = "\r\n", out: MBatch[] = [];
  const base = site + "/_api/web/lists/getbytitle('" + LIST_EMP + "')/items";
  for (let i = 0; i < ops.length; i += BATCH_M) {
    const id = "emp_" + (i / BATCH_M) + "_" + Math.floor(Math.random() * 1e9), b = "batch_" + id, c = "changeset_" + id;
    let body = "--" + b + CRLF + "Content-Type: multipart/mixed; boundary=" + c + CRLF + CRLF;
    const chunk = ops.slice(i, i + BATCH_M);
    for (const op of chunk) {
      body += "--" + c + CRLF + "Content-Type: application/http" + CRLF + "Content-Transfer-Encoding: binary" + CRLF + CRLF;
      if (op.method === "POST")
        body += "POST " + base + " HTTP/1.1" + CRLF + "Content-Type: application/json;odata=nometadata" + CRLF + "Accept: application/json;odata=nometadata" + CRLF + CRLF + JSON.stringify(op.row) + CRLF + CRLF;
      else if (op.method === "MERGE")
        body += "PATCH " + base + "(" + op.id + ") HTTP/1.1" + CRLF + "Content-Type: application/json;odata=nometadata" + CRLF + "IF-MATCH: *" + CRLF + CRLF + JSON.stringify(op.row) + CRLF + CRLF;
      else
        body += "DELETE " + base + "(" + op.id + ") HTTP/1.1" + CRLF + "IF-MATCH: *" + CRLF + CRLF;
    }
    body += "--" + c + "--" + CRLF + CRLF + "--" + b + "--" + CRLF;
    out.push({ list: LIST_EMP, boundary: b, body, n: chunk.length });
  }
  return out;
}

// ---------- หาชีต/คอลัมน์จากหัวตาราง ----------
const COLS: { k: string; re: RegExp; def: number }[] = [
  { k: "code", re: /รหัส|^EMP|^ID$|EMPLOYEE\s*ID|STAFF\s*ID/i, def: 1 },
  { k: "team", re: /^ทีม|^TEAM/i, def: 2 },
  { k: "fullTh", re: /ชื่อ\s*[-–]?\s*(นาม)?สกุล/, def: -1 },
  { k: "first", re: /^ชื่อ(\s*\(?ไทย\)?)?$|^ชื่อจริง/, def: 4 },
  { k: "last", re: /^(นาม)?สกุล/, def: 5 },
  { k: "dept", re: /แผนก|ฝ่าย|DEPART|^DEPT/i, def: 6 },
  { k: "pos", re: /ตำแหน่ง|POSITION/i, def: 7 },
  { k: "start", re: /เริ่มงาน|วันเริ่ม|START/i, def: 8 },
  { k: "nameEn", re: /^NAME$|FIRST\s*NAME/i, def: 10 },
  { k: "surEn", re: /^SURNAME$|LAST\s*NAME/i, def: 11 },
  { k: "resign", re: /พ้นสภาพ|วันลาออก|RESIGN/i, def: 12 },
  { k: "status", re: /สถานะ|STATUS/i, def: 13 },
];
function columnMap(g: CellM[][]): { header: number; c: { [k: string]: number } } {
  for (let h = 0; h < Math.min(10, g.length); h++) {
    const u = g[h].map(x => str(x));
    if (!(u.some(x => /รหัส|EMP|^ID$/i.test(x)) && u.some(x => /ชื่อ|NAME/i.test(x)))) continue;
    const c: { [k: string]: number } = {};
    for (const d of COLS) { c[d.k] = -1; for (let j = 0; j < u.length; j++) if (d.re.test(u[j]) && Object.keys(c).every(k => c[k] !== j)) { c[d.k] = j; break; } }
    if (c.code < 0) continue;
    return { header: h, c };
  }
  const c: { [k: string]: number } = {};
  for (const d of COLS) c[d.k] = d.def;
  return { header: 0, c };                                          // ไม่มีหัว → ตำแหน่งเดิมของ Total
}
function findEmployeeSheet(workbook: ExcelScript.Workbook): ExcelScript.Worksheet | undefined {
  for (const ws of workbook.getWorksheets()) {
    if (/BKK/i.test(ws.getName()) && /BATCH/i.test(ws.getName())) continue;
    const g = ws.getRange("A1:Z10").getValues();
    if (g.some(r => r.some(x => /รหัส/.test(str(x))) && r.some(x => /ชื่อ/.test(str(x))))) return ws;
  }
  return undefined;
}

// ---------- helpers (กติกาเดียวกับ RosterReader.gs rrPosGroup_ / rrLLPosGroup_) ----------
function posGroup(pos: string, team: string): string {
  const t = team.toUpperCase();
  if (t.indexOf("CREW") >= 0) return "Crewsign";
  if (t.indexOf("PORTER") >= 0) return "Porter";
  if (t.indexOf("ADMIN") >= 0 && t.indexOf("DOC") >= 0) return "AdminD";
  if (t.indexOf("GLOB") >= 0) return "Globlex";
  const c = pos.toUpperCase().replace(/ACT\.?\s*/g, "").trim();
  if (c.indexOf("DIRECTOR") >= 0) return "DIR";
  if (c.indexOf("ASSIST") >= 0 && c.indexOf("MANAGER") >= 0) return "Assist";
  if (c.indexOf("MANAGER") >= 0) return "MGR";
  if (c.indexOf("SUP") >= 0 || c === "PSS") return "PSS";
  if (c.indexOf("SNR") >= 0 || c.indexOf("SENIOR") >= 0) return "SNR";
  if (c.indexOf("ADMIN") >= 0) return "AdminD";
  if (c.indexOf("PORTER") >= 0) return "Porter";
  return "PSA";
}
function llGroup(pos: string): string {
  const u = pos.toUpperCase().replace(/ACT\.?\s*/g, "").trim();
  if (u.indexOf("PSS") === 0 || u.indexOf("SUPERVISOR") >= 0) return "PSS";
  if (u.indexOf("SNR") === 0 || u.indexOf("SENIOR") >= 0) return "SNR";
  if (u.indexOf("TRAINEE") >= 0) return "Trainee";
  if (u.indexOf("PORTER") >= 0) return "Porter";
  if (u.indexOf("ADMIN") >= 0) return "Admin";
  return "PSA";
}
function str(v: CellM): string { return v == null ? "" : String(v).trim(); }
function digits(v: CellM): string { return str(v).replace(/\.0*$/, "").replace(/\D/g, ""); }
function join(a: CellM, b: CellM): string { return (str(a) + " " + str(b)).trim(); }
function pad2(x: number): string { return (x < 10 ? "0" : "") + x; }
function isoToday(): string { const d = new Date(); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
// Excel date serial / "dd/mm/yyyy" / "yyyy-mm-dd" → yyyy-mm-dd (พ.ศ. → ค.ศ.) · อื่น ๆ = null
function toIso(v: CellM): string | null {
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
  }
  const s = str(v);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) { const y = +m[1] > 2400 ? +m[1] - 543 : +m[1]; return y + "-" + pad2(+m[2]) + "-" + pad2(+m[3]); }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) { const y = +m[3] > 2400 ? +m[3] - 543 : +m[3]; return y + "-" + pad2(+m[2]) + "-" + pad2(+m[1]); }
  return null;
}
function hash(s: string): string {                                    // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return ("0000000" + h.toString(16)).slice(-8);
}
