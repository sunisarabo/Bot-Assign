/*
 * import-roster.ts — Office Script: ไฟล์เวรรายวัน (.xlsx) → SharePoint Lists (PAS_Manpower · PAS_Duty · PAS_Assignment)
 *   ไซต์ /sites/0AAYJ05_KoLORUk9PVA · เรียกจาก Power Automate (Excel Online (Business) → Run script) · ไม่แก้ไฟล์ต้นทาง
 *
 * พารามิเตอร์
 *   filePath  = path เต็มของไฟล์ เช่น "Shared Documents/2025/09.SEP26/19SEP.xlsx"  (ใช้หาวันที่ — รองรับเดือนใหม่/ปีใหม่เอง)
 *   workDate  = "YYYY-MM-DD" (ไม่บังคับ — ใส่เมื่ออยากบังคับวันที่)
 *   siteUrl   = URL ไซต์ (ไม่บังคับ — ค่าเริ่มต้น SITE)
 *   holidays  = JSON วันหยุดประเพณีจาก List PAS_Holidays (ไม่บังคับ) → มาทำงานวันนั้น = OT นักขัต X1 เท่าชั่วโมงกะ
 *   schedule  = JSON ตารางบินวันนั้นจาก PAS_Flights [{flight_key, aircraft_type, sta, std, cancelled}] (ไม่บังคับ — เติม A/C TYPE/เวลาให้ SLA)
 *   pss       = JSON รหัสพนักงานตำแหน่ง PSS (หัวหน้า) จาก PAS_Employees (ไม่บังคับ — เครดิต SUP ผู้กำกับดูแล)
 *   dateOnly  = "1" → คืนแค่ work_date (อ่าน MANPOWER อย่างเดียว — เร็ว) ให้ flow ดึงตารางบินของวันนั้นก่อนรันจริง
 *   rules     = JSON กฎกำลังคนต่อสายการบินจาก PAS_SLARules [{Title, sup, ci, arr, gate, total}] (ไม่บังคับ — แทน STANDARD MANNING เดิม)
 *   → PAS_FlightSLA: ไฟลท์ทุกไฟลท์ของวัน + ต้องการ/มีจริงต่อเฟส + ขาด (พอร์ตจาก SLA.gs slaCollectFlights_)
 *
 * OT (ตรงกับระบบเดิม): ot_total = OT ปกติ + OT นักขัต · แถวซัพพอร์ต "ชื่อ (ทีม)" ไม่นับ OT
 *   PAS_Manpower = OT รายทีม/วัน (OT Dashboard) · PAS_OT_Person = OT รายคน/วัน เฉพาะคนที่มี OT (เตือนสัปดาห์/เดือน)
 *
 * ลำดับหาวันที่: workDate → ชื่อไฟล์ (+เดือน/ปีจากโฟลเดอร์แม่) → หัวชีต MANPOWER → (ไม่พบ = skipped)
 *   รองรับ: 19SEP · 19SEP26 · 19 SEP 2026 · 2026-09-19 · 20260919 · 19.09.26 · 19/09/2569 · 19 ก.ย. 69 · "19" (เดือน/ปีจากโฟลเดอร์)
 *   โฟลเดอร์เดือน: 09.SEP26 · SEP 2026 · SEP · 09 · ก.ย.69 · กันยายน 2569  · โฟลเดอร์ปี: 2026 / 2569
 *   ปีจากโฟลเดอร์เดือน (SEP26) ชนะโฟลเดอร์ปี (เช่น /2025/09.SEP26 → 2026) · ไม่มีปีเลย → เลือกปีที่ใกล้วันนี้ที่สุด (ข้ามธ.ค.→ม.ค. ถูก)
 *
 * คืนค่า: { status:"ok"|"skipped", reason, work_date, date_source, warnings[], counts{teams,duty,assignment,ot_people}, batches[{list,boundary,body,n}] }
 *   batches = เนื้อ SharePoint $batch (≤100 แถว/ก้อน) → flow ส่งด้วย "Send an HTTP request to SharePoint" ทีละก้อน
 *
 * layout แท็บทีม (0-based): 0=ID 2=NAME 3=SHIFT 4=IN 6=ชม. 12,15=OT 16=STATUS 17=REMARK · ไฟลท์เริ่มคอลัมน์ 19 ทีละ 4
 *   หัวไฟลท์ = แถวที่คอลัมน์ 18 ขึ้นต้น "FLIGHT" / "STA" / "OP"
 */
const SITE = "https://aotgath.sharepoint.com/sites/0AAYJ05_KoLORUk9PVA";
const BATCH_SIZE = 100;
const DEP_LEAD = 60, ARR_TAIL = 45, DEF_JOB = 45;
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const TH_FULL = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const TH_ABBR = ["มค", "กพ", "มีค", "เมย", "พค", "มิย", "กค", "สค", "กย", "ตค", "พย", "ธค"];

type Cell = string | number | boolean;
interface MpRow { Title: string; day_key: string; month_key: string; work_date: string; team: string; total: number; working: number; sick: number; annual: number; training: number; ot_hours: number; ot_hol_hours: number; ot_total: number; ot_people: number; ot_off_hours: number; is_holiday: boolean; util_pct: number; cnt_work: number; cnt_sick: number; cnt_vac: number; cnt_personal: number; cnt_training: number; cnt_off: number; cnt_ot_off: number; cnt_staff: number; mp_ot_hours: number }
interface DutyRow { Title: string; day_key: string; work_date: string; team: string; emp_code: string; emp_name: string; bucket: string; shift_code: string; shift_start: string; shift_hours: number; ot_hours: number; ot_hol_hours: number; is_support: boolean; duty_min: number; busy_min: number; util_pct: number; source_file: string }
interface AsgRow { Title: string; day_key: string; work_date: string; team: string; emp_code: string; emp_name: string; task: string; sta: string; std: string; counter_open: string; counter_close: string; win_lo: number; win_hi: number; is_flight: boolean }
interface OtRow { Title: string; day_key: string; month_key: string; week_key: string; emp_code: string; emp_name: string; team: string; ot_hours: number; ot_hol_hours: number; ot_total: number }
interface IssueRow { Title: string; day_key: string; month_key: string; category: string; team: string; who: string; detail: string }
interface Batch { list: string; boundary: string; body: string; n: number }
interface Result { status: string; reason: string; work_date: string; date_source: string; warnings: string[]; counts: { teams: number; duty: number; assignment: number; ot_people: number; issues: number; flights?: number; short?: number }; batches: Batch[] }
interface DatePick { iso: string; source: string }

function main(workbook: ExcelScript.Workbook, filePath?: string, workDate?: string, siteUrl?: string, holidays?: string, schedule?: string, pss?: string, rules?: string, dateOnly?: string): Result {
  const path = filePath || "";
  const warnings: string[] = [];
  const empty = (reason: string, iso: string, src: string): Result =>
    ({ status: "skipped", reason, work_date: iso, date_source: src, warnings, counts: { teams: 0, duty: 0, assignment: 0, ot_people: 0, issues: 0 }, batches: [] });

  const mp = workbook.getWorksheet("MANPOWER");
  const mv: Cell[][] = mp ? mp.getUsedRange().getValues() : [];
  const headerText = mv.slice(0, 6).map(r => r.join(" ")).join(" ");

  // ---- วันที่ ----
  let pick: DatePick | null = null;
  const forced = normDate(workDate || "");
  if (forced) pick = { iso: forced, source: "workDate" };
  if (!pick) pick = dateFromPath(path, new Date());
  const hdr = dateFromPath(headerText.replace(/\//g, "-"), new Date());   // หัว MANPOWER (ข้อความ ไม่ใช่ path)
  if (!pick && hdr) pick = { iso: hdr.iso, source: "MANPOWER header" };
  if (pick && hdr && hdr.iso !== pick.iso) warnings.push("วันที่หัว MANPOWER (" + hdr.iso + ") ไม่ตรงกับ " + pick.source + " (" + pick.iso + ")");

  if (dateOnly && pick) return { status: "date", reason: "", work_date: pick.iso, date_source: pick.source, warnings, counts: { teams: 0, duty: 0, assignment: 0, ot_people: 0, issues: 0 }, batches: [] };   // flow ขอแค่วันที่ (ไว้ดึงตารางบินของวันนั้นก่อน)

  // ---- ทีม ----
  const teams = readTeams(workbook, mv);
  if (!teams.length) return empty("ไม่ใช่ไฟล์เวร PSA (ไม่พบ Team (..) ใน MANPOWER และไม่พบแท็บที่มีหัว FLIGHT)", pick ? pick.iso : "", pick ? pick.source : "");
  if (!pick) return empty("หาวันที่ไม่ได้จาก path/ชื่อไฟล์/หัว MANPOWER — ตั้งชื่อไฟล์เช่น 19SEP.xlsx ในโฟลเดอร์ 09.SEP26 หรือส่ง workDate", "", "");

  const hol = holidaySet(holidays);
  const p = parseRoster(workbook, teams, pick.iso, baseName(path), !!hol[pick.iso]);
  if (hdr && hdr.iso !== pick.iso)
    addIssue(p.issues, pick.iso, "filedate", "MANPOWER", baseName(path), "วันที่หัวชีต MANPOWER = " + hdr.iso + " แต่ชื่อไฟล์/โฟลเดอร์ = " + pick.iso + " — ตรวจว่าวางไฟล์ถูกวัน หรือหัวชีตลืมเปลี่ยน");
  const site = (siteUrl || SITE).replace(/\/$/, "");
  const batches: Batch[] = [];
  addBatches(batches, site, "PAS_Manpower", p.manpower);
  addBatches(batches, site, "PAS_Duty", p.duty);
  addBatches(batches, site, "PAS_Assignment", p.assignment);
  addBatches(batches, site, "PAS_OT_Person", p.otPerson);
  const sla = computeSla(pick.iso, p.slaPeople, p.teamNames, parseSched(schedule), codeSet(pss), parseRules(rules));
  addBatches(batches, site, "PAS_DataIssue", p.issues);
  addBatches(batches, site, "PAS_FlightSLA", sla);
  return {
    status: "ok", reason: "", work_date: pick.iso, date_source: pick.source, warnings,
    counts: { teams: p.manpower.length, duty: p.duty.length, assignment: p.assignment.length, ot_people: p.otPerson.length, issues: p.issues.length, flights: sla.length, short: sla.filter(x => !x.ok && !x.no_time).length }, batches
  };
}

// ======================= อ่านไฟล์เวร =======================
interface TeamHead { code: string; total: number; working: number; sick: number; annual: number; training: number; mpOt?: number }

function readTeams(workbook: ExcelScript.Workbook, mv: Cell[][]): TeamHead[] {
  const teams: TeamHead[] = [];
  for (const r of mv) {
    const m = String(r[0] || "").match(/Team\s*\((.+?)\)/);
    if (m) teams.push({ code: m[1].trim(), total: n(r[1]), working: n(r[9]), sick: n(r[3]), annual: n(r[5]), training: n(r[8]), mpOt: n(r[10]) });
  }
  if (!teams.length) for (const ws of workbook.getWorksheets()) {
    if (findByS(ws.getRange("A1:AQ60").getValues(), "FLIGHT") >= 0)
      teams.push({ code: ws.getName(), total: 0, working: 0, sick: 0, annual: 0, training: 0 });
  }
  return teams;
}

function parseRoster(workbook: ExcelScript.Workbook, teams: TeamHead[], day: string, src: string, isHol: boolean) {
  const duty: DutyRow[] = [], assignment: AsgRow[] = [], manpower: MpRow[] = [], otPerson: OtRow[] = [];
  const month = day.slice(0, 7), week = mondayOf(day);
  const issues: IssueRow[] = [];
  const idTeams: { [emp: string]: { teams: string[]; name: string } } = {};
  const tabDates: { [team: string]: string } = {};
  const slaPeople: SlaPerson[] = [];
  for (const t of teams) {
    const ws = workbook.getWorksheet(t.code);
    let people = 0;
    if (!ws) addIssue(issues, day, "droptab", t.code, "ไม่พบแท็บ", "MANPOWER มีทีม " + t.code + " แต่ไม่มีแท็บชื่อนี้ — ทั้งทีมหายจากยอด/ไฟลท์ (ชื่อแท็บต้องตรงรหัสทีม)");
    let otSum = 0, holSum = 0, otOff = 0, otPpl = 0, uSum = 0, uN = 0;
    const cnt = { work: 0, sick: 0, vac: 0, personal: 0, training: 0, off: 0, otOff: 0, staff: 0 }, counted: { [e: string]: boolean } = {};
    if (ws) {
      const g = ws.getRange("A1:AQ300").getValues();
      tabDates[t.code] = sheetDate(ws.getRange("A1:T4").getTexts());
      const nameSeen: { [n: string]: boolean } = {};
      const fRow = findByS(g, "FLIGHT"), sRow = findByS(g, "STA"), oRow = findByS(g, "OP");
      const flights: { base: number; code: string; STA: string; STD: string; OP: string; CL: string }[] = [];
      if (fRow >= 0) for (let b = 19; b + 3 < g[fRow].length; b += 4) {
        const code = String(g[fRow][b] || "").trim();
        if (!code || !/\d|BRE?IF|GOM/i.test(code)) continue;
        flights.push({ base: b, code, STA: hhmm(sRow >= 0 ? g[sRow][b] : ""), STD: hhmm(sRow >= 0 ? g[sRow][b + 2] : ""), OP: hhmm(oRow >= 0 ? g[oRow][b] : ""), CL: hhmm(oRow >= 0 ? g[oRow][b + 2] : "") });
      }
      for (const f of flights)
        if (/\d/.test(f.code) && !f.STA && !f.STD && !f.OP && !f.CL)
          addIssue(issues, day, "flttime", t.code, f.code, "ไฟลท์ไม่มี STA/STD — เติมเวลาในชีต ไม่งั้นเช็ค SLA / หาคนช่วยไม่ได้");
      const seen: { [k: string]: number } = {};
      for (const row of g) {
        const id = row[0], name = String(row[2] || "").trim();
        if (typeof id !== "number" || !name || name.indexOf("Ex.") === 0) continue;
        const emp = String(id);
        people++;
        // แถวซัพพอร์ต "ชื่อ (WY)" = มาช่วยจากทีมอื่น → ไม่นับ OT ที่ทีมนี้ (นับที่ทีมต้นสังกัด) — เหมือน RosterReader
        const sup = name.match(/\(([A-Z0-9]{2,4})\)\s*$/i);
        const isSup = !!sup && sup[1].toUpperCase() !== t.code.toUpperCase();
        const ot = isSup ? 0 : n(row[12]) + n(row[15]);
        const bucket = bucketOf(String(row[16] || ""), String(row[17] || ""), ot);
        const ds = t2m(row[4]), hrs = n(row[6]);
        let de = (ds != null && hrs) ? ds + Math.round(hrs * 60) : null;
        if (ds != null && de != null && de <= ds) de += 1440;
        const dutyMin = (ds != null && de != null && isWork(bucket)) ? de - ds : 0;

        // ---- ตรวจข้อมูล (กติกาเดียวกับ rbDataCheckHtml) ----
        const nk = name.toUpperCase();
        if (nameSeen[nk]) addIssue(issues, day, "dupname", t.code, name, "ชื่อซ้ำในทีม (อาจกรอกซ้ำ 2 แถว)");
        nameSeen[nk] = true;
        if (!isSup && /^\d{6,8}$/.test(emp)) {
          const it = idTeams[emp] || (idTeams[emp] = { teams: [], name });
          if (it.teams.indexOf(t.code) < 0) it.teams.push(t.code);
        }
        const fltCells = flights.filter(f => /\d/.test(f.code) && [0, 1, 2, 3].some(k => String(row[f.base + k] == null ? "" : row[f.base + k]).trim() !== ""));
        if (!isSup && isWork(bucket) && ds == null && fltCells.length)
          addIssue(issues, day, "noshift", t.code, name, "มาทำงาน/มีไฟลท์ แต่อ่านเวลากะไม่ได้" + (String(row[3] || "").trim() ? " (รหัส " + String(row[3]).trim() + ")" : " (ไม่มีรหัสกะ)"));
        if (!isSup && bucket === "OFF" && fltCells.length)
          addIssue(issues, day, "offflt", t.code, name, "ชีตเขียนหยุด (OFF/X) แต่ถูกจัดลงไฟลท์ " + fltCells.map(f => f.code).join(", ") + " — ถ้ามาทำงานให้แก้เป็น Onduty · ถ้ามาช่วย OT ให้กรอกชั่วโมง OT");

        const iv: number[][] = [];
        const sp: SlaPerson = { team: t.code, emp, name, ds, de: de == null ? null : de, asg: [] };
        if (isWork(bucket)) slaPeople.push(sp);
        if (isWork(bucket)) for (const f of flights) {
          const cells = [0, 1, 2, 3].map(k => String(row[f.base + k] == null ? "" : row[f.base + k]).trim()).filter(x => x !== "");
          if (!cells.length) continue;
          const w = winOf(f);
          if (w) iv.push(w);
          sp.asg.push({ code: f.code, task: cells.filter(x => !/^\d{1,2}[:.]\d{2}$/.test(x)).join(" "), STA: f.STA, STD: f.STD, OP: f.OP, CL: f.CL });
          assignment.push({
            Title: f.code, day_key: day, work_date: day, team: t.code, emp_code: emp, emp_name: name,
            task: cells.join(" ").slice(0, 255), sta: f.STA, std: f.STD, counter_open: f.OP, counter_close: f.CL,
            win_lo: w ? w[0] : 0, win_hi: w ? w[1] : 0, is_flight: /\d/.test(f.code)
          });
        }
        const busy = mergeMin(dutyMin > 0 ? clampIv(iv, ds as number, de as number) : iv);
        const util = dutyMin > 0 ? Math.min(100, Math.round(busy / dutyMin * 100)) : 0;
        if (dutyMin > 0) { uSum += util; uN++; }
        // วันหยุดประเพณี: มาทำงาน = OT นักขัต X1 เท่าชั่วโมงกะ (ไม่นับอบรม/ซัพพอร์ต)
        const otHol = (isHol && !isSup && bucket === "WORKING" && hrs > 0) ? hrs : 0;
        if (!isSup && !counted[emp]) {                                // นับหัวรายวัน (1 คน/ทีม · ไม่นับซัพพอร์ต) — สรุปสัปดาห์
          counted[emp] = true;
          cnt.staff++;
          if (bucket === "OT_OFF") cnt.otOff++;
          if (bucket === "OFF") cnt.off++;
          if (isWork(bucket)) cnt.work++;
          else if (bucket === "SICK") cnt.sick++;
          else if (bucket === "VACATION") cnt.vac++;
          else if (bucket === "LEAVE") cnt.personal++;
          else if (bucket === "TRAINING") cnt.training++;
        }
        if (!isSup) {
          otSum += ot; holSum += otHol;
          if (bucket === "OT_OFF") otOff += ot;
          if (ot > 0) otPpl++;
          if (ot + otHol > 0) otPerson.push({
            Title: day + "|" + emp + "|" + t.code, day_key: day, month_key: month, week_key: week, emp_code: emp, emp_name: name,
            team: t.code, ot_hours: round1(ot), ot_hol_hours: round1(otHol), ot_total: round1(ot + otHol)
          });
        }
        const k = day + "|" + t.code + "|" + emp;
        seen[k] = (seen[k] || 0) + 1;
        if (seen[k] === 2) addIssue(issues, day, "dupblock", t.code, name + " (" + emp + ")", "รหัสนี้อยู่ในแท็บ 2 แถว/2 บล็อก — อาจมีตารางคนซ้อนซ้ำ · ลบบล็อกซ้ำเพื่อกันข้อมูลตกหล่น/นับซ้ำ");
        duty.push({
          Title: seen[k] > 1 ? k + "#" + seen[k] : k, day_key: day, work_date: day, team: t.code, emp_code: emp, emp_name: name,
          bucket, shift_code: String(row[3] || "").trim(), shift_start: ds != null ? m2hhmm(ds) : "",
          shift_hours: hrs, ot_hours: round1(ot), ot_hol_hours: round1(otHol), is_support: isSup, duty_min: dutyMin, busy_min: busy, util_pct: util, source_file: src
        });
      }
    }
    if (ws && people === 0)
      addIssue(issues, day, "droptab", t.code, "อ่านไม่ได้ทั้งแท็บ", "แท็บนี้ไม่มีแถวพนักงานที่อ่านได้ (คอลัมน์ A ต้องเป็นรหัสตัวเลข · C = ชื่อ) — ทั้งทีมหายจากยอด/ไฟลท์");
    manpower.push({
      Title: day + "|" + t.code, day_key: day, month_key: month, work_date: day, team: t.code, total: t.total, working: t.working,
      sick: t.sick, annual: t.annual, training: t.training, ot_hours: round1(otSum), ot_hol_hours: round1(holSum),
      ot_total: round1(otSum + holSum), ot_people: otPpl, ot_off_hours: round1(otOff), is_holiday: isHol, util_pct: uN ? Math.round(uSum / uN) : 0,
      cnt_work: cnt.work, cnt_sick: cnt.sick, cnt_vac: cnt.vac, cnt_personal: cnt.personal, cnt_training: cnt.training,
      cnt_off: cnt.off, cnt_ot_off: cnt.otOff, cnt_staff: cnt.staff, mp_ot_hours: round1(t.mpOt || 0)
    });
  }
  for (const emp of Object.keys(idTeams)) {
    const it = idTeams[emp];
    if (it.teams.length > 1) addIssue(issues, day, "dupteam", it.teams.join(" + "), it.name + " (" + emp + ")", "รหัสเดียวกันโผล่หลายทีม — นับซ้ำ · ถ้าไปช่วยให้ทำเป็นแถวซัพพอร์ต \"ชื่อ (ทีม)\" แทน");
  }
  // แท็บที่วันที่ (เช่น 29/JUN) ต่างจากทีมส่วนใหญ่ → อาจลืมอัปเดตแท็บ
  const dc: { [d: string]: number } = {};
  for (const tm of Object.keys(tabDates)) if (tabDates[tm]) dc[tabDates[tm]] = (dc[tabDates[tm]] || 0) + 1;
  const ds2 = Object.keys(dc);
  if (ds2.length > 1) {
    const maj = ds2.sort((a, b) => dc[b] - dc[a])[0];
    for (const tm of Object.keys(tabDates))
      if (tabDates[tm] && tabDates[tm] !== maj)
        addIssue(issues, day, "staledate", tm, "วันที่บนแท็บ = " + tabDates[tm], "แท็บนี้เป็นวันที่ " + tabDates[tm] + " แต่ทีมส่วนใหญ่เป็น " + maj + " — อาจลืมอัปเดตแท็บ (ข้อมูลทั้งทีมเป็นของวันเก่า)");
  }
  return { manpower, duty, assignment, otPerson, issues, slaPeople, teamNames: teams.map(x => x.code) };
}

// ======================= SharePoint $batch =======================
function addBatches(out: Batch[], site: string, list: string, rows: object[]) {
  const CRLF = "\r\n";
  const url = site + "/_api/web/lists/getbytitle('" + list + "')/items";
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const id = list + "_" + (i / BATCH_SIZE) + "_" + Math.floor(Math.random() * 1e9);
    const b = "batch_" + id, c = "changeset_" + id;
    let body = "--" + b + CRLF + "Content-Type: multipart/mixed; boundary=" + c + CRLF + CRLF;
    const chunk = rows.slice(i, i + BATCH_SIZE);
    for (const r of chunk) {
      body += "--" + c + CRLF + "Content-Type: application/http" + CRLF + "Content-Transfer-Encoding: binary" + CRLF + CRLF +
        "POST " + url + " HTTP/1.1" + CRLF + "Content-Type: application/json;odata=nometadata" + CRLF +
        "Accept: application/json;odata=nometadata" + CRLF + CRLF + JSON.stringify(r) + CRLF + CRLF;
    }
    body += "--" + c + "--" + CRLF + CRLF + "--" + b + "--" + CRLF;
    out.push({ list, boundary: b, body, n: chunk.length });
  }
}

// ======================= วันที่จาก path =======================
interface Parts { d: number; m: number; y: number }

function dateFromPath(path: string, today: Date): DatePick | null {
  const segs = path.split("/").map(s => s.trim()).filter(s => s !== "");
  if (!segs.length) return null;
  const file = segs[segs.length - 1].replace(/\.[a-z0-9]{2,5}$/i, "");
  const parents = segs.slice(0, -1).reverse();                    // ใกล้สุดก่อน

  const f = partsFromName(file);
  let d = f.d, m = f.m, y = f.y, src = "ชื่อไฟล์";
  if (!d) return null;
  for (const p of parents) {                                      // เดือน (+ปีที่ติดกับเดือน) จากโฟลเดอร์ใกล้สุด
    if (m && y) break;
    const fm = partsFromFolder(p);
    if (!m && fm.m) { m = fm.m; if (!y && fm.y) y = fm.y; src += " + โฟลเดอร์ " + p; }
    else if (m && !y && fm.m === m && fm.y) { y = fm.y; src += " + โฟลเดอร์ " + p; }
  }
  if (m && !y) for (const p of parents) {                         // ปีจากโฟลเดอร์ปี (2026 / 2569)
    const yy = p.match(/(?:^|\D)((?:20|25)\d{2})(?!\d)/);
    if (yy) { y = toCE(+yy[1]); src += " + โฟลเดอร์ปี " + p; break; }
  }
  if (!m) return null;
  if (!y) {                                                        // เดาปีที่ทำให้วันที่ใกล้วันนี้สุด
    const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    let best = 0, bestDiff = Infinity;
    for (const cy of [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1]) {
      const diff = Math.abs(Date.UTC(cy, m - 1, d) - t);
      if (diff < bestDiff) { bestDiff = diff; best = cy; }
    }
    y = best; src += " + ปีที่ใกล้วันนี้";
  }
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
  return { iso: y + "-" + pad(m) + "-" + pad(d), source: src };
}

function partsFromName(s: string): Parts {
  const u = s.toUpperCase();
  let r = u.match(/(?:^|\D)((?:20|25)\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?!\d)/);                  // 2026-09-19 / 20260919
  if (r && +r[2] >= 1 && +r[2] <= 12) return { y: toCE(+r[1]), m: +r[2], d: +r[3] };
  r = u.match(/(?:^|\D)(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?!\d)/);                       // 19.09.26 / 19/09/2569
  if (r && +r[2] >= 1 && +r[2] <= 12) return { d: +r[1], m: +r[2], y: yearTok(r[3]) };
  r = u.match(/(?:^|[^0-9])(\d{1,2})\s*[-_.]?\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?\s*[-_.]?\s*(\d{4}|\d{2}(?!\d))?/);
  if (r) return { d: +r[1], m: MON.indexOf(r[2]) + 1, y: r[3] ? yearTok(r[3]) : 0 };
  const th = thaiMonth(s);
  if (th.m) {
    const dd = s.slice(0, th.at).match(/(\d{1,2})\s*$/);
    const yy = s.slice(th.end).match(/^\s*(\d{4}|\d{2})(?!\d)/);
    if (dd) return { d: +dd[1], m: th.m, y: yy ? yearTok(yy[1]) : 0 };
  }
  r = u.match(/^\s*(\d{1,2})(?!\d)/);                                                            // "19" / "19 roster"
  if (r && +r[1] >= 1 && +r[1] <= 31) return { d: +r[1], m: 0, y: 0 };
  return { d: 0, m: 0, y: 0 };
}

function partsFromFolder(s: string): Parts {
  const u = s.toUpperCase();
  let r = u.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?\s*[-_.]?\s*(\d{4}|\d{2}(?!\d))?/);
  if (r) return { d: 0, m: MON.indexOf(r[1]) + 1, y: r[2] ? yearTok(r[2]) : 0 };
  const th = thaiMonth(s);
  if (th.m) { const yy = s.slice(th.end).match(/^\s*(\d{4}|\d{2})(?!\d)/); return { d: 0, m: th.m, y: yy ? yearTok(yy[1]) : 0 }; }
  r = u.match(/^\s*(\d{1,2})\s*(?:[._\- ]\s*((?:20|25)\d{2}|\d{2}))?\s*$/);                     // "09" / "09.26" / "09-2026"
  if (r && +r[1] >= 1 && +r[1] <= 12) return { d: 0, m: +r[1], y: r[2] ? yearTok(r[2]) : 0 };
  r = u.match(/^\s*((?:20|25)\d{2})\s*[._\-]\s*(\d{1,2})\s*$/);                                  // "2026-09"
  if (r && +r[2] >= 1 && +r[2] <= 12) return { d: 0, m: +r[2], y: toCE(+r[1]) };
  return { d: 0, m: 0, y: 0 };
}

function thaiMonth(s: string): { m: number; at: number; end: number } {
  for (let i = 0; i < 12; i++) { const k = s.indexOf(TH_FULL[i]); if (k >= 0) return { m: i + 1, at: k, end: k + TH_FULL[i].length }; }
  for (let i = 0; i < 12; i++) {                                   // ก.ย. / กย / ก.ย  (ไล่ยาวก่อน: มี.ค. ก่อน มค)
    const order = [2, 3, 5, 0, 1, 4, 6, 7, 8, 9, 10, 11][i];
    const pat = TH_ABBR[order].split("").join("\\.?\\s?") + "\\.?";
    const r = s.match(new RegExp(pat));
    if (r && r.index !== undefined) return { m: order + 1, at: r.index, end: r.index + r[0].length };
  }
  return { m: 0, at: -1, end: -1 };
}
function toCE(y: number): number { return y > 2400 ? y - 543 : y; }
// 2 หลัก: ≥60 = พ.ศ. (69 → 2026) · <60 = ค.ศ. (26 → 2026)
function yearTok(t: string): number { const v = +t; return t.length === 2 ? (v >= 60 ? 2500 + v - 543 : 2000 + v) : toCE(v); }
function normDate(s: string): string {
  const m = s.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return m ? m[1] + "-" + pad(+m[2]) + "-" + pad(+m[3]) : "";
}
function baseName(p: string): string { const s = p.split("/"); return s[s.length - 1] || ""; }


// ======================= Flights & SLA (พอร์ตจาก SLA.gs · slaCollectFlights_ / slaReq_ / slaPhasesOf_) =======================
// ตารางคัดจาก SLA.gs อัตโนมัติ: RQ=[SUP,CI,ARR,GATE,TTL] ต่อสาย · AC=ต่อชนิดเครื่อง · ALIAS · WIN=[ci,cc,post] (นาทีเทียบ STD) · DBREQ=สายที่ใช้ roles
const SLA_T: { RQ: { [a: string]: number[] }; AC: { [a: string]: (string | number)[][] }; ALIAS: { [a: string]: string }; WIN: { [a: string]: number[] }; DBREQ: { [a: string]: number[] } } = {"RQ":{"3K":[1,4,1,1,8],"3U":[1,4,1,1,8],"6B":[1,5,2,1,10],"6E":[1,5,1,1,9],"8L":[1,4,1,1,8],"8M":[1,3,1,1,7],"9C":[1,5,1,1,9],"9H":[1,4,1,1,8],"AF":[1,9,1,1,13],"AI":[1,6,1,1,9],"AK":[1,4,1,1,8],"AQ":[1,3,1,1,7],"AY":[1,5,1,1,9],"B2":[1,6,1,1,10],"BY":[1,5,2,1,10],"C6":[1,4,1,1,8],"CA":[1,6,1,1,10],"CX":[1,6,2,1,11],"CZ":[1,6,1,1,10],"DE":[1,6,2,1,11],"DK":[1,4,1,1,8],"DV":[1,4,1,1,8],"EK":[1,7,4,1,14],"EO":[1,6,1,1,10],"EY":[1,7,1,1,12],"FM":[1,4,1,1,8],"FY":[1,3,1,1,6],"G2":[1,6,1,1,10],"G8":[1,4,1,1,8],"G9":[1,4,1,1,8],"H4":[1,5,1,1,9],"HB":[1,3,1,1,7],"HH":[1,4,1,1,8],"HO":[1,4,1,1,8],"HU":[1,6,1,1,10],"HX":[1,5,1,1,9],"HY":[1,5,1,1,8],"IT":[1,4,1,1,7],"IX":[1,4,1,1,7],"JQ":[1,7,1,1,10],"KC":[1,5,1,1,9],"KE":[1,8,1,1,11],"KY":[1,3,1,1,7],"LJ":[1,4,1,1,8],"LO":[1,6,1,1,10],"LY":[1,7,4,1,14],"MH":[1,4,1,1,8],"MU":[1,4,1,1,8],"N0":[1,5,1,1,9],"N4":[1,6,1,1,10],"NO":[1,6,1,1,10],"OD":[1,4,1,1,7],"OM":[1,4,1,1,8],"OQ":[1,4,1,1,8],"OV":[1,4,1,1,8],"OZ":[1,6,1,1,10],"PG":[1,0,1,2,8],"PN":[1,4,1,1,8],"QP":[1,5,1,1,9],"QR":[1,11,3,1,17],"QZ":[1,4,1,1,8],"S7":[1,4,1,1,8],"SG":[1,4,1,1,7],"SQ":[1,4,1,1,8],"SU":[1,8,1,1,12],"SV":[1,7,2,1,12],"TK":[1,8,4,1,15],"TR":[1,5,1,1,10],"U6":[1,4,1,1,8],"UO":[1,4,2,1,8],"VJ":[1,4,1,1,8],"VN":[1,7,1,1,10],"W5":[1,7,2,1,12],"WK":[1,6,2,1,11],"WY":[1,7,1,1,11],"WZ":[1,6,1,1,10],"ZF":[1,6,1,1,10],"ZH":[1,4,1,1,8]},"AC":{"QR":[["B777",11,3,1,17],["B787",9,2,1,14]],"EY":[["B787-9",6,1,1,11],["B787-10",7,1,1,12],["A321Neo",5,1,1,11]],"KE":[["A333/B772/B787",7,1,1,10],["B773",8,1,1,11]],"SU":[["B777",8,1,1,12],["A333",7,1,1,11],["B737/A320/A321Neo",4,1,1,8]],"TR":[["A320",3,1,1,8],["A321",4,1,1,9],["B787",5,1,1,10]],"JQ":[["B787",7,1,1,10],["A321Neo",5,1,1,8]],"AK":[["A320",3,1,1,7],["A321",4,1,1,8]],"QZ":[["A320",3,1,1,7],["A321",4,1,1,8]],"PG":[["A319/320",0,1,2,8],["ATR",0,1,1,6]],"CX":[["A330",6,2,1,11],["A321NEO",5,2,1,10]],"KC":[["A320",4,1,1,8],["B737",5,1,1,9]],"6E":[["A321",5,1,1,9],["A320",4,1,1,8]],"CA":[["A320/B737",4,1,1,8],["A330",6,1,1,10]],"CZ":[["A320",4,1,1,8],["A321",4,1,1,8],["A330",6,1,1,10]],"HU":[["B737",4,1,1,8],["A330",6,1,1,10]],"SV":[["B789",6,2,1,11],["B78X",7,2,1,12]],"VN":[["A320/A321",5,1,1,8],["B787/A350",7,1,1,10]]},"ALIAS":{"3K":"JQ","GX":"CA","KX":"CA","8H":"CA","BK":"CA","PVT":"PRIVATE"},"WIN":{"SQ":[-240,-40,30],"CX":[-240,-60,30],"LY":[-240,-60,30],"QR":[-240,-45,30],"MH":[-240,-60,30],"DE":[-240,-45,30],"PG":[-45,-15,20],"AK":[-180,-60,20],"QZ":[-180,-60,20],"SU":[-180,-40,30],"B2":[-180,-40,30],"W5":[-180,-40,30],"3U":[-180,-60,30],"CA":[-180,-50,30],"MU":[-180,-50,30],"CZ":[-180,-45,30],"FM":[-180,-50,30],"HO":[-180,-45,30],"HU":[-180,-50,30],"AQ":[-180,-45,30],"HX":[-240,-50,30],"EY":[-180,-60,45],"AY":[-180,-60,30],"DV":[-180,-60,30],"KE":[-240,-45,30],"KC":[-240,-45,30],"OZ":[-180,-45,30],"NO":[-180,-45,30],"AF":[-240,-45,30],"LJ":[-180,-45,20],"OV":[-180,-45,20],"WY":[-180,-60,20],"G9":[-180,-60,20],"DK":[-180,-60,20],"9C":[-180,-45,20],"EK":[-240,-60,30],"UO":[-180,-45,20],"FY":[-144,-45,20],"6B":[-180,-45,20],"BY":[-180,-45,20],"AI":[-180,-45,20],"IX":[-180,-45,20],"JQ":[-180,-60,20],"IT":[-180,-45,20],"N0":[-180,-45,20],"TK":[-180,-60,30],"VJ":[-180,-45,20],"OD":[-180,-45,20],"SG":[-180,-45,20],"HY":[-180,-45,20],"TR":[-150,-60,20],"6E":[-180,-45,20],"QP":[-180,-45,20],"SV":[-240,-45,30],"WK":[-198,-45,30],"KA":[-180,-45,20],"ZF":[-180,-45,20],"HH":[-180,-45,20],"LO":[-180,-45,20],"EO":[-180,-45,20],"S7":[-180,-45,20],"8L":[-180,-45,20],"8M":[-180,-45,20],"9H":[-180,-45,20],"C6":[-180,-45,20],"G2":[-180,-45,20],"H4":[-180,-45,20],"HB":[-180,-45,20],"KY":[-180,-45,20],"N4":[-180,-45,20],"OM":[-180,-45,20],"OQ":[-180,-45,20],"PN":[-180,-45,20],"VN":[-180,-45,20],"WZ":[-180,-45,20],"ZH":[-180,-45,20],"PRIVATE":[-60,-20,20],"CHARTER":[-120,-30,20],"DEFAULT":[-180,-45,20]},"DBREQ":{"SQ":[1,6,0,6,13],"CX":[1,7,0,7,15],"LY":[1,8,0,4,13],"QR":[1,12,3,4,20],"MH":[1,4,1,3,9],"DE":[1,5,1,4,11],"PG":[1,0,2,7,9],"AK":[1,3,1,3,8],"QZ":[1,3,1,3,8],"SU":[1,16,1,5,23],"B2":[1,7,0,0,8],"W5":[1,7,0,0,8],"3U":[1,4,1,5,11],"CA":[1,6,1,4,12],"MU":[1,5,1,4,11],"CZ":[1,4,1,4,10],"FM":[1,5,1,4,11],"HO":[1,4,2,3,10],"HU":[1,4,1,4,10],"AQ":[1,4,1,3,9],"HX":[1,5,1,4,11],"EY":[1,4,1,5,11],"AY":[1,4,1,3,9],"DV":[1,4,1,3,9],"KE":[1,5,1,1,8],"KC":[1,6,1,1,9],"OZ":[1,4,1,1,7],"NO":[1,4,1,1,7],"AF":[1,5,2,1,9],"LJ":[1,4,1,1,7],"OV":[1,4,1,1,7],"WY":[1,6,1,6,15],"G9":[1,4,1,0,6],"DK":[1,4,1,0,6],"9C":[1,4,1,1,7],"EK":[1,6,4,5,16],"UO":[1,4,2,3,10],"FY":[1,3,1,3,8],"6B":[1,4,1,3,9],"BY":[1,4,1,3,9],"AI":[1,3,2,5,12],"IX":[1,4,0,0,5],"JQ":[1,5,3,6,15],"IT":[1,4,1,2,8],"N0":[1,4,1,2,8],"TK":[1,3,2,4,11],"VJ":[1,2,1,1,5],"OD":[1,1,1,1,5],"SG":[1,4,1,2,8],"HY":[1,4,1,2,8],"TR":[1,5,1,3,10],"6E":[1,5,1,0,7],"QP":[1,5,1,0,7],"SV":[1,7,2,3,14],"WK":[1,7,2,3,14],"KA":[1,5,1,3,10],"ZF":[1,5,1,3,10],"HH":[1,4,1,2,8],"LO":[1,4,1,2,8],"EO":[1,4,1,2,8],"S7":[1,5,1,3,10],"8L":[1,5,1,1,8],"8M":[1,4,1,1,7],"9H":[1,5,1,1,8],"C6":[1,5,1,1,8],"G2":[1,7,1,1,10],"H4":[1,6,1,1,9],"HB":[1,4,1,1,7],"KY":[1,4,1,1,7],"N4":[1,7,1,1,10],"OM":[1,5,1,1,8],"OQ":[1,5,1,1,8],"PN":[1,5,1,1,8],"VN":[1,7,1,1,10],"WZ":[1,7,1,1,10],"ZH":[1,5,1,1,8],"PRIVATE":[1,1,0,1,3],"CHARTER":[1,2,1,1,5],"DEFAULT":[1,4,1,2,8]}};
interface SlaAsg { code: string; task: string; STA: string; STD: string; OP: string; CL: string }
interface SlaPerson { team: string; emp: string; name: string; ds: number | null; de: number | null; asg: SlaAsg[] }
interface SchedRow { ac: string; sta: string; std: string; cancelled: boolean }
interface SlaRow {
  Title: string; day_key: string; month_key: string; flight: string; flight_key: string; airline: string; ac: string; sta: string; std: string;
  team_list: string; req_sup: number; req_ci: number; req_gate: number; req_arr: number; req_total: number;
  as_sup: number; as_ci: number; as_gate: number; as_arr: number; as_total: number;
  short_sup: number; short_ci: number; short_gate: number; short_arr: number; short_total: number; short_text: string;
  ok: boolean; no_time: boolean; fragment: boolean; ferry: boolean; sched_cancelled: boolean; unassigned: boolean; redist: string; staff_text: string
}
type Req = { SUP: number; CI: number; GATE: number; ARR: number; total: number };

function computeSla(day: string, people: SlaPerson[], teamNames: string[], sched: { [k: string]: SchedRow }, pss: { [e: string]: boolean }, rules: { [a: string]: number[] }): SlaRow[] {
  const flights: { [k: string]: { flight: string; airline: string; teams: { [t: string]: boolean }; STA: string; STD: string; OP: string; CL: string; AC: string;
    as: Req; staff: string[] } } = {};
  const teamSups: { [t: string]: number[][] } = {}, teamCounter: { [t: string]: number[][] } = {}, airCnt: { [a: string]: { [t: string]: number } } = {};
  for (const p of people) {
    if (skipTeam(p.team)) continue;
    if (pss[p.emp] && p.ds != null && p.de != null) (teamSups[p.team] = teamSups[p.team] || []).push([p.ds, p.de]);
    if (p.asg.some(a => /^\s*(COUNTER\b|CT\s?\d)/i.test(a.code)) && p.ds != null && p.de != null) (teamCounter[p.team] = teamCounter[p.team] || []).push([p.ds, p.de]);
    for (const a of p.asg) {
      const raw = a.code.trim();
      if (!isFlightName(raw)) continue;
      const al = airlineOf(raw);
      if (al && al !== "DEFAULT") { const c = airCnt[al] = airCnt[al] || {}; c[p.team] = (c[p.team] || 0) + 1; }
      const key = flightKeyOf(raw);
      if (!key || /SUU?PP?ORT/i.test(key)) continue;
      const f = flights[key] = flights[key] || { flight: raw, airline: airlineOf(key), teams: {}, STA: a.STA, STD: a.STD, OP: a.OP, CL: a.CL, AC: "", as: { SUP: 0, CI: 0, GATE: 0, ARR: 0, total: 0 }, staff: [] };
      f.teams[p.team] = true;
      if (!f.STA && a.STA) f.STA = a.STA; if (!f.STD && a.STD) f.STD = a.STD; if (!f.OP && a.OP) f.OP = a.OP; if (!f.CL && a.CL) f.CL = a.CL;
      const phs = phasesOf(a.task);
      if (!phs.length) { f.staff.push(p.name + " (" + p.team + ") " + a.task + " [เทรน]"); continue; }
      for (const ph of phs) (f.as as { [k: string]: number })[ph]++;
      f.as.total++;
      f.staff.push(p.name + " (" + p.team + ") " + (a.task || "CI") + " → " + phs.join("/"));
    }
  }
  // ไฟลท์ในตารางบินที่ "ยังไม่มีใครถูกจัด" แต่สายนั้นทีมเราทำวันนี้ → เพิ่มเป็นไฟลท์ขาดทั้งไฟลท์ (หน้าเดิมไม่แสดง — เพิ่มใหม่)
  for (const k of Object.keys(sched)) {
    const w = sched[k], al = airlineOf(k);
    if (flights[k] || w.cancelled || !airCnt[al]) continue;
    flights[k] = { flight: k, airline: al, teams: {}, STA: w.sta, STD: w.std, OP: "", CL: "", AC: "", as: { SUP: 0, CI: 0, GATE: 0, ARR: 0, total: 0 }, staff: [] };
    (flights[k] as { unassigned?: boolean }).unassigned = true;
  }
  const homeTeamOf = (airline: string): string => {
    const a = airline.toUpperCase(); if (!a) return "";
    for (const t of teamNames) if (t.toUpperCase() === a) return t;
    for (const t of teamNames) if (t.toUpperCase().split(/[^A-Z0-9]+/).indexOf(a) >= 0) return t;
    let best = "", bn = -1;
    for (const t of Object.keys(airCnt[a] || {})) if (airCnt[a][t] > bn) { bn = airCnt[a][t]; best = t; }
    return best;
  };
  const rows: SlaRow[] = [];
  for (const key of Object.keys(flights)) {
    const f = flights[key];
    const w = sched[key];
    let cancelled = false;
    if (w) { if (!f.AC && w.ac) f.AC = w.ac; if (!f.STA && w.sta) f.STA = w.sta; if (!f.STD && w.std) f.STD = w.std; cancelled = !!w.cancelled; }
    const req = slaReq(f.airline, f.AC, rules);
    const akNum = f.airline === "AK" ? +((f.flight.match(/\d{3,4}/) || ["0"])[0]) : 0;
    const ferry = akNum >= 1000;
    if (ferry) { req.CI = 0; req.ARR = 0; req.GATE = 0; req.total = req.SUP; }
    const home = homeTeamOf(f.airline);
    const dep = realMin(f.STD), arr0 = realMin(f.STA);
    let hasDep = dep != null, hasArr = arr0 != null;
    if (hasArr && hasDep && arr0 === dep) hasArr = false;              // STA=STD = RON (ขาออกอย่างเดียว)
    const noTime = !hasDep && !hasArr;
    if (!noTime) {
      let extra = Math.max(0, req.total - (req.SUP + req.CI + req.GATE + req.ARR));
      if (!hasDep) { req.CI = 0; req.GATE = 0; extra = 0; }
      if (!hasArr) req.ARR = 0;
      req.total = req.SUP + req.CI + req.GATE + req.ARR + extra;
    }
    const as = f.as;
    if (req.SUP > 0 && as.SUP === 0) {                                // เครดิตหัวหน้าทีมที่ทำงานคาบช่วงไฟลท์
      let sw = phaseWin(f.airline, f.STA, f.STD, "SUP"); const sm = dep != null ? dep : arr0;
      if (!sw && sm != null) sw = [sm - 30, sm + 30];
      if (sw && Object.keys(f.teams).some(t => (teamSups[t] || []).some(x => x[0] <= (sw as number[])[1] && x[1] >= (sw as number[])[0]))) as.SUP = req.SUP;
    }
    if (req.CI > 0 && as.CI < req.CI && home && teamCounter[home]) {   // เครดิต common check-in ของทีมเจ้าของ
      const ciw = phaseWin(f.airline, f.STA, f.STD, "CI");
      if (ciw) { const nC = teamCounter[home].filter(x => x[0] <= ciw[1] && x[1] >= ciw[0]).length; if (nC > 0) as.CI = Math.min(req.CI, as.CI + nC); }
    }
    const short: { [ph: string]: number } = {};
    for (const ph of ["SUP", "CI", "GATE", "ARR"]) { const d = (req as { [k: string]: number })[ph] - (as as { [k: string]: number })[ph]; if (d > 0) short[ph] = d; }
    const redist: string[] = [];
    let ramp = Math.max(0, as.GATE - req.GATE) + Math.max(0, as.ARR - req.ARR);
    for (const ph of ["ARR", "GATE"]) if (short[ph] && ramp > 0) { const use = Math.min(short[ph], ramp); short[ph] -= use; ramp -= use; redist.push(ph); if (short[ph] <= 0) delete short[ph]; }
    let shortTotal = Math.max(0, req.total - as.total);
    if (shortTotal === 0) for (const ph of ["CI", "GATE", "ARR"]) if (short[ph]) { redist.push(ph); delete short[ph]; }
    if (Object.keys(short).length === 0) shortTotal = 0;
    const ok = Object.keys(short).length === 0 && shortTotal === 0;
    if (home) f.teams[home] = true;
    const TH: { [k: string]: string } = { SUP: "SUP", CI: "Check-in", GATE: "Gate", ARR: "Arrival" };
    const parts = ["SUP", "CI", "GATE", "ARR"].filter(ph => short[ph]).map(ph => TH[ph] + " ขาด " + short[ph]);
    rows.push({
      Title: day + "|" + key, day_key: day, month_key: day.slice(0, 7), flight: f.flight, flight_key: key, airline: f.airline,
      ac: f.AC, sta: f.STA, std: f.STD, team_list: home || Object.keys(f.teams).join(","),
      req_sup: req.SUP, req_ci: req.CI, req_gate: req.GATE, req_arr: req.ARR, req_total: req.total,
      as_sup: as.SUP, as_ci: as.CI, as_gate: as.GATE, as_arr: as.ARR, as_total: as.total,
      short_sup: short.SUP || 0, short_ci: short.CI || 0, short_gate: short.GATE || 0, short_arr: short.ARR || 0, short_total: shortTotal,
      short_text: parts.length ? parts.join(" · ") : (shortTotal ? "ขาดรวม " + shortTotal : ""),
      ok, no_time: noTime, fragment: false, ferry, sched_cancelled: cancelled,
      unassigned: !!(f as { unassigned?: boolean }).unassigned, redist: redist.join(","), staff_text: f.staff.join("\n").slice(0, 4000)
    });
  }
  // เศษขา: ไฟลท์ไม่มีเวลาที่เลขไฟลท์ทุกตัวไปซ้ำกับไฟลท์ที่มีเวลา → ซ่อนได้
  const timed: { [n: number]: boolean } = {};
  for (const r of rows) if (!r.no_time) for (const n of (r.flight.match(/\d+/g) || [])) timed[+n] = true;
  for (const r of rows) if (r.no_time) { const nums = (r.flight.match(/\d+/g) || []).map(Number); r.fragment = nums.length > 0 && nums.every(n => timed[n]); }
  return rows.sort((a, b) => (a.std || a.sta || "zz") < (b.std || b.sta || "zz") ? -1 : 1);
}
function skipTeam(team: string): boolean { const t = team.toUpperCase(); return t.indexOf("PORTER") >= 0 || t.indexOf("CREWSIGN") >= 0 || t.indexOf("CREW SIGN") >= 0 || (t.indexOf("ADMIN") >= 0 && t.indexOf("DOC") >= 0); }
function isFlightName(name: string): boolean {
  const s = name.trim().toUpperCase(); if (!s) return false;
  if (/^(COUNTER|GATE|CHECK|ZONE|BELT|PIER|STBY|STAND|POOL|OFFICE|BRIEF|NIL|OFF\b|LP\s+(MORNING|AFTERNOON|NIGHT|DAY))/.test(s)) return false;
  return /^(?:[A-Z][A-Z0-9]|[0-9][A-Z])\s*\d{2,4}/.test(s);
}
function airlineOf(flight: string): string { const s = flight.trim().toUpperCase(); const m = s.match(/^([0-9A-Z]{2})\s*\d/); if (m) return m[1]; const m2 = s.match(/([A-Z]{1,3})\s*\d/); return m2 ? m2[1] : "DEFAULT"; }
function flightKeyOf(raw: string): string {
  const s = raw.trim().toUpperCase(), air = airlineOf(s);
  const rest = air && air !== "DEFAULT" ? s.replace(new RegExp("^" + air + "\\s*"), "") : s;
  const m = rest.match(/\d+/);
  return m ? air + String(parseInt(m[0], 10)) : s.replace(/[\s.\/]+/g, "");
}
function phasesOf(task: string): string[] {
  const u = task.toUpperCase();
  if (!u) return ["CI"];
  if (/TRAINING|LOAD CONTROL|IN.?HOUSE|MEETING|E-?LEARN|SEMINAR/.test(u)) return [];
  const p: { [k: string]: boolean } = {};
  if (/\bSUP\b|SPVR|\bSOD\b|\bSM\b|\bFC\b|\bCF\b|FLT\s*CTRL|FLIGHT\s*CONTROL/.test(u)) p.SUP = true;
  if (/\bARR\b|ARRIVAL|MEET|\bAC\b|\bRF\b|ESCORT|BIR|CIQ|IMMIG/.test(u)) p.ARR = true;
  if (/\bG[ABCKM]?\b|GATE|BOARD|BGO|BOCO|MAAS|PFD|GBD|DEPART|(^|[\s\/])D\b|(^|[\s\/])I\b/.test(u)) p.GATE = true;
  if (/\bCT\d|\bCT\b|\bC\d|^C\b|\bY\d?\b|\bJ\d?\b|\bW\d|\bB\d|\bF\d|WEB|KIOSK|\bKSK\b|BAG\s?DROP|PRIO|PSM|\bPSC\b|\bSD\b|CHECK|CKIN|CREW|\bCS\b|\bFR\b|COUNTER|\bIPAD\b|WEL\s*G(?:ST|UEST)|WELCOME\s*G/.test(u)) p.CI = true;
  if (/\bNO\s*-?\s*GATE\b|NON\s*-?\s*GATE|\bNO\s*GT\b|งดเกท|ไม่\s*(?:ต้อง)?\s*(?:ไป|ขึ้น)?\s*เกท/.test(u)) delete p.GATE;
  const k = Object.keys(p);
  return k.length ? k : ["CI"];
}
function slaReq(airline: string, ac: string, rules: { [a: string]: number[] }): Req {
  const c = airline.toUpperCase(), al = SLA_T.ALIAS[c];
  if (ac && SLA_T.AC[c]) { const pk = acPick(SLA_T.AC[c], ac); if (pk) return { SUP: 1, CI: +pk[1], ARR: +pk[2], GATE: +pk[3], total: +pk[4] }; }
  const ro = rules[c] || (al ? rules[al] : undefined);
  if (ro) return { SUP: ro[0] || 1, CI: ro[1], ARR: ro[2], GATE: ro[3], total: ro[4] };
  const rq = SLA_T.RQ[c] || (al ? SLA_T.RQ[al] : undefined);
  if (rq) return { SUP: 1, CI: rq[1], ARR: rq[2], GATE: rq[3], total: rq[4] };
  const db = SLA_T.DBREQ[c] || (al ? SLA_T.DBREQ[al] : undefined) || SLA_T.DBREQ.DEFAULT;
  return { SUP: 1, CI: db[1], ARR: db[2], GATE: db[3], total: db[4] };
}
function acModel(s: string): string { return s.toUpperCase().replace(/\([^)]*\)/g, "").split(/\s+-\s+/)[0].replace(/\s+/g, ""); }
function acToks(s: string, fam: boolean): string[] {
  const out: string[] = []; let last = "";
  for (let x of acModel(s).split("/")) {
    x = x.replace(/NEO$/, "");
    const m = x.match(/^([AB])?(\d.*)$/);
    if (m) { const L = m[1] || last; if (m[1]) last = m[1]; const tok = L + m[2]; out.push(tok); if (fam && /^B78[0-9X]$/.test(tok)) out.push("B787"); }
    else if (x) out.push(x);
  }
  return out;
}
function acPick(rows: (string | number)[][], ac: string): (string | number)[] | null {
  for (const fam of [false, true]) {
    const q = acToks(ac, fam); if (!q.length) continue;
    for (const r of rows) { const f = acToks(String(r[0]), fam);
      for (const Q of q) for (const F of f) if (Q && F && (Q === F || Q.indexOf(F) === 0 || F.indexOf(Q) === 0)) return r; }
  }
  return null;
}
function realMin(x: string): number | null { const m = String(x || "").match(/(\d{1,2}):(\d{2})/); const v = m ? (+m[1]) * 60 + (+m[2]) : 0; return v ? v : null; }
function phaseWin(airline: string, STA: string, STD: string, ph: string): number[] | null {
  const c = airline.toUpperCase();
  const w = SLA_T.WIN[c] || (SLA_T.ALIAS[c] ? SLA_T.WIN[SLA_T.ALIAS[c]] : undefined) || SLA_T.WIN.DEFAULT;
  const std = realMin(STD), sta = realMin(STA), post = w[2];
  if (ph === "CI") return std != null ? [std + w[0], std + w[1]] : null;
  if (ph === "SUP") return std != null ? [std + w[0], std + post] : (sta != null ? [sta - 20, sta + post] : null);
  return null;
}
function parseSched(json?: string): { [k: string]: SchedRow } {
  const out: { [k: string]: SchedRow } = {};
  if (!json) return out;
  const arr: { flight_key?: string; flight_no?: string; aircraft_type?: string; sta?: string; std?: string; cancelled?: boolean }[] = JSON.parse(json);
  for (const r of arr) {
    const k = r.flight_key || (r.flight_no ? flightKeyOf(r.flight_no) : "");
    if (k && !out[k]) out[k] = { ac: r.aircraft_type || "", sta: r.sta || "", std: r.std || "", cancelled: !!r.cancelled };
  }
  return out;
}
function codeSet(json?: string): { [k: string]: boolean } {
  const out: { [k: string]: boolean } = {};
  if (!json) return out;
  const arr: (string | { Title?: string; emp_code?: string })[] = JSON.parse(json);
  for (const x of arr) { const k = typeof x === "string" ? x : (x.Title || x.emp_code || ""); if (k) out[String(k)] = true; }
  return out;
}
function parseRules(json?: string): { [a: string]: number[] } {
  const out: { [a: string]: number[] } = {};
  if (!json) return out;
  const arr: { Title?: string; sup?: number; ci?: number; arr?: number; gate?: number; total?: number }[] = JSON.parse(json);
  for (const r of arr) if (r.Title && r.ci != null) out[String(r.Title).toUpperCase()] = [r.sup || 1, +(r.ci || 0), +(r.arr || 0), +(r.gate || 0), +(r.total || 0)];
  return out;
}

// ======================= ตรวจข้อมูล =======================
function addIssue(out: IssueRow[], day: string, category: string, team: string, who: string, detail: string) {
  out.push({ Title: day + "|" + category + "|" + (out.length + 1), day_key: day, month_key: day.slice(0, 7), category, team, who: who.slice(0, 255), detail: detail.slice(0, 255) });
}
// วันที่ที่พิมพ์บนแท็บ (4 แถวแรก) เช่น "29/JUN" → "29/JUN" — เหมือน rrSheetDate_
function sheetDate(t: string[][]): string {
  for (const r of t) for (const c of r) {
    const m = String(c || "").match(/(\d{1,2})\s*\/\s*([A-Za-z]{3,4})/);
    if (m) return m[1].replace(/^0/, "") + "/" + m[2].toUpperCase();
  }
  return "";
}

// ======================= OT helpers =======================
// วันจันทร์ของสัปดาห์ (สัปดาห์ จ.–อา. เหมือนเกณฑ์ OT เดิม) → "YYYY-MM-DD"
function mondayOf(iso: string): string {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
}
// วันหยุดจาก List PAS_Holidays (flow ส่ง JSON: ["2026-10-13", …] หรือ [{"day_key":"2026-10-13"}, …])
function holidaySet(json?: string): { [k: string]: boolean } {
  const out: { [k: string]: boolean } = {};
  if (!json) return out;
  const arr: (string | { day_key?: string })[] = JSON.parse(json);
  for (const x of arr) { const k = typeof x === "string" ? x : (x.day_key || ""); if (k) out[k.slice(0, 10)] = true; }
  return out;
}

// ======================= helpers =======================
function n(v: Cell): number { return typeof v === "number" ? v : 0; }
function round1(x: number): number { return Math.round(x * 10) / 10; }
function pad(x: number): string { return (x < 10 ? "0" : "") + x; }
function m2hhmm(m: number): string { m = ((m % 1440) + 1440) % 1440; return pad(Math.floor(m / 60)) + ":" + pad(m % 60); }
function t2m(v: Cell): number | null {
  if (typeof v === "number") return Math.round((v - Math.floor(v)) * 1440);   // Excel time serial
  const m = String(v || "").match(/(\d{1,2})[:.](\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : null;
}
function hhmm(v: Cell): string { const m = t2m(v); return m == null || (typeof v === "number" && v === 0) ? "" : m2hhmm(m); }
function isWork(b: string): boolean { return b === "WORKING" || b === "OT_OFF"; }
function bucketOf(status: string, remark: string, ot: number): string {
  const txt = (remark || status).toUpperCase().trim();
  if (txt.indexOf("SICK") >= 0 || txt === "SL" || txt === "MC" || txt.indexOf("ป่วย") >= 0) return "SICK";
  // ลากิจ/ลาคลอด (BL/ML/PL) แยกจากพักร้อน — เหมือน rbWkAcc_ (สรุปสัปดาห์: แวค vs กิจ)
  if (/(^|[^A-Z])(BL|ML|PL)([^A-Z]|$)|LEAVE|PERSONAL|BUSINESS|MATERN|กิจ|คลอด/.test(txt)) return "LEAVE";
  if (txt.indexOf("VAC") >= 0 || ["AL", "VL"].indexOf(txt) >= 0 || txt.indexOf("พักร้อน") >= 0) return "VACATION";
  if (txt.indexOf("TRAIN") >= 0) return "TRAINING";
  if (txt.indexOf("OFF") === 0 || txt === "X") return ot > 0 ? "OT_OFF" : "OFF";
  return "WORKING";
}
function findByS(g: Cell[][], label: string): number {
  for (let i = 0; i < g.length; i++) { const s = String(g[i][18] || "").toUpperCase().trim(); if (s.indexOf(label) === 0) return i; }
  return -1;
}
function winOf(a: { STA: string; STD: string; OP: string; CL: string }): number[] | null {
  const op = t2m(a.OP), cl = t2m(a.CL), sta = t2m(a.STA), std = t2m(a.STD);
  if (op != null && cl != null) return [op, cl < op ? cl + 1440 : cl];
  if (std != null) return [Math.max(0, std - DEP_LEAD), std];
  if (sta != null) return [sta, sta + ARR_TAIL];
  if (op != null) return [op, op + DEF_JOB];
  return null;
}
function mergeMin(iv: number[][]): number {
  if (!iv.length) return 0;
  iv = iv.slice().sort((a, b) => a[0] - b[0]);
  let tot = 0, lo = iv[0][0], hi = iv[0][1];
  for (let i = 1; i < iv.length; i++) { if (iv[i][0] <= hi) hi = Math.max(hi, iv[i][1]); else { tot += hi - lo; lo = iv[i][0]; hi = iv[i][1]; } }
  return tot + (hi - lo);
}
// ช่วงงานที่ตัดกับกะ (รองรับกะข้ามเที่ยงคืน: ลองเลื่อนช่วงงาน +1440)
function clampIv(iv: number[][], lo: number, hi: number): number[][] {
  const o: number[][] = [];
  for (const s of iv) for (const sh of [0, 1440]) { const a = Math.max(s[0] + sh, lo), b = Math.min(s[1] + sh, hi); if (b > a) o.push([a, b]); }
  return o;
}
