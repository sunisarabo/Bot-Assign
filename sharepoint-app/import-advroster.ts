// ⚠️ ไฟล์นี้สร้างอัตโนมัติจาก import-roster.ts ด้วย `node build.js` — อย่าแก้ตรงนี้ (แก้ที่ import-roster.ts แล้ว build ใหม่)
// Office Script: จัดล่วงหน้า — อ่านไฟล์ ROSTER ล่วงหน้า + ไฟลท์ (PAS_Flights) + พนักงาน (PAS_Employees) → PAS_AdvPlan / PAS_AdvRoster (ดู FLOW-advance.md)
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
 *   posg      = JSON ตำแหน่งพนักงาน [{Title, pos_group}] จาก PAS_Employees (ไม่บังคับ — ใช้คัดคนช่วย SUP = Sup/Snr และเรียง Agent ก่อน)
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
interface MpRow { Title: string; day_key: string; month_key: string; work_date: string; team: string; total: number; working: number; sick: number; annual: number; training: number; ot_hours: number; ot_hol_hours: number; ot_total: number; ot_people: number; ot_off_hours: number; is_holiday: boolean; util_pct: number; cnt_work: number; cnt_sick: number; cnt_vac: number; cnt_personal: number; cnt_training: number; cnt_off: number; cnt_ot_off: number; cnt_staff: number; mp_ot_hours: number; ot_pre_people?: number; ot_pre_hours?: number; ot_post_people?: number; ot_post_hours?: number }
interface DutyRow { Title: string; day_key: string; work_date: string; team: string; emp_code: string; emp_name: string; bucket: string; shift_code: string; shift_start: string; shift_end?: string; shift_hours: number; ot_hours: number; ot_hol_hours: number; ot_type?: string; ot_time?: string; is_support: boolean;
  ac_status?: string; ac_flights?: string; ac_job?: string; ac_zones?: string; ac_support?: number; ac_uncovered?: string; ac_gaps?: string; ac_gaps_raw?: string; ac_ot_verdict?: string; ac_issue?: string; duty_min: number; busy_min: number; util_pct: number; source_file: string }
interface AsgRow { Title: string; day_key: string; work_date: string; team: string; emp_code: string; emp_name: string; task: string; sta: string; std: string; counter_open: string; counter_close: string; win_lo: number; win_hi: number; is_flight: boolean }
interface OtRow { Title: string; day_key: string; month_key: string; week_key: string; emp_code: string; emp_name: string; team: string; ot_hours: number; ot_hol_hours: number; ot_total: number }
interface IssueRow { Title: string; day_key: string; month_key: string; category: string; team: string; who: string; detail: string }
interface Batch { list: string; boundary: string; body: string; n: number }
interface Result { status: string; reason: string; work_date: string; date_source: string; warnings: string[]; counts: { teams: number; duty: number; assignment: number; ot_people: number; issues: number; flights?: number; short?: number; support?: number; auto?: number }; batches: Batch[] }
interface DatePick { iso: string; source: string }

function rosterMain(workbook: ExcelScript.Workbook, filePath?: string, workDate?: string, siteUrl?: string, holidays?: string, schedule?: string, pss?: string, rules?: string, dateOnly?: string, posg?: string): Result {
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
  const pg = posGroups(posg);
  const pssSet = codeSet(pss); for (const e of Object.keys(pg)) if (pg[e] === "PSS") pssSet[e] = true;
  const slaR = computeSla(pick.iso, p.slaPeople, p.teamNames, parseSched(schedule), pssSet, parseRules(rules));
  const sla = slaR.rows;
  const support = supportRows(pick.iso, slaR.flights, p.acRecs, pg);
  const auto = autoPlanRows(pick.iso, slaR.flights, p.acRecs, pg);
  addBatches(batches, site, "PAS_DataIssue", p.issues);
  addBatches(batches, site, "PAS_FlightSLA", sla);
  addBatches(batches, site, "PAS_Support", support);
  addBatches(batches, site, "PAS_AutoPlan", auto);
  // สรุปรายวัน 1 แถว — กราฟ OT เทียบจำนวนไฟลท์ (ไฟลท์ = จากไฟล์ assignment แบบเดียวกับหน้าไฟลท์สัปดาห์)
  const live = sla.filter(x => !x.sched_cancelled && !x.unassigned && !(x.no_time && x.fragment));
  const sumMp = (f: (m: MpRow) => number) => round1(p.manpower.reduce((s, m) => s + f(m), 0));
  addBatches(batches, site, "PAS_DayStats", [{ Title: pick.iso, day_key: pick.iso, month_key: pick.iso.slice(0, 7),
    flights: live.length, flights_short: live.filter(x => !x.ok && !x.no_time).length, people_req: live.reduce((s, x) => s + x.req_sup + Math.max(x.req_ci, x.req_gate) + x.req_arr, 0),
    working: sumMp(m => m.cnt_work), ot_people: sumMp(m => m.ot_people), ot_hours: sumMp(m => m.ot_hours), ot_total: sumMp(m => m.ot_total), is_holiday: !!hol[pick.iso] }]);
  return {
    status: "ok", reason: "", work_date: pick.iso, date_source: pick.source, warnings,
    counts: { teams: p.manpower.length, duty: p.duty.length, assignment: p.assignment.length, ot_people: p.otPerson.length, issues: p.issues.length, flights: sla.length, short: sla.filter(x => !x.ok && !x.no_time).length, support: support.length, auto: auto.length }, batches
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
  const acRecs: { rec: AcRec; row: DutyRow }[] = [];
  for (const t of teams) {
    const ws = workbook.getWorksheet(t.code);
    let people = 0;
    if (!ws) addIssue(issues, day, "droptab", t.code, "ไม่พบแท็บ", "MANPOWER มีทีม " + t.code + " แต่ไม่มีแท็บชื่อนี้ — ทั้งทีมหายจากยอด/ไฟลท์ (ชื่อแท็บต้องตรงรหัสทีม)");
    let otSum = 0, holSum = 0, otOff = 0, otPpl = 0, uSum = 0, uN = 0;
    const cnt = { work: 0, sick: 0, vac: 0, personal: 0, training: 0, off: 0, otOff: 0, staff: 0, preP: 0, preH: 0, postP: 0, postH: 0 }, counted: { [e: string]: boolean } = {};
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
      // ตรวจ "ทีมยังลง assignment ไม่ครบ" (เหมือน apTeamsNotFilled_ ของเดิม): ลงแล้ว = มีสถานะ หรือมีงานในคอลัมน์ไฟลท์ · ทีมสแตนด์บายมีกะก็พอ
      const fillCheck = !/PORTER|CREWSIGN|ADMIN\s*DOC/i.test(t.code), standby = /CHARTER|\bZF\b|PVT|PVTLP|\bLP\b|STBY|STAND ?BY|FLOAT/i.test(t.code);
      let fillPeople = 0, filled = 0;
      for (const row of g) {
        const fid = String(row[0] == null ? "" : row[0]).replace(/\D/g, "");
        if (!fillCheck || fid.length < 6 || fid.length > 8 || !String(row[2] || "").trim()) continue;
        fillPeople++;
        const hasJob = row.slice(19).some(c => String(c == null ? "" : c).trim() !== "");
        if (String(row[16] || "").trim() || hasJob || (standby && String(row[3] || "").trim())) filled++;
      }
      if (fillPeople > 0 && filled < fillPeople)
        addIssue(issues, day, "notfilled", t.code, "ลง " + filled + "/" + fillPeople, "ยังลง assignment ไม่ครบ — ค้าง " + (fillPeople - filled) + " คน (ไม่มีสถานะและไม่มีงาน)");
      for (const row of g) {
        const id = row[0], name = String(row[2] || "").trim();
        if (typeof id !== "number" || !name || name.indexOf("Ex.") === 0) continue;
        const emp = String(id);
        people++;
        // แถวซัพพอร์ต "ชื่อ (WY)" = มาช่วยจากทีมอื่น → ไม่นับ OT ที่ทีมนี้ (นับที่ทีมต้นสังกัด) — เหมือน RosterReader
        const sup = name.match(/\(([A-Z0-9]{2,4})\)\s*$/i);
        const isSup = !!sup && sup[1].toUpperCase() !== t.code.toUpperCase();
        const og1 = otGroup(row[10], row[11], row[12]), og2 = otGroup(row[13], row[14], row[15]);
        const ot = isSup ? 0 : round1((og1 ? og1.h : 0) + (og2 ? og2.h : 0));
        const bucket = bucketOf(String(row[16] || ""), String(row[17] || ""), ot);
        const ds = t2m(row[4]), hrs = n(row[6]);
        // เวลาเลิกกะ (F) + ช่วง OT 2 กลุ่ม (K/L ชม.M · N/O ชม.P) — เหมือน rrRangeCells_/rrReadOtGroup_ ของเดิม
        const seCell = timeOnly(row[5]);
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
        // ---- ประเภท OT (ก่อน/หลังกะ) — rrOtType_ ----
        const ssA = ds, seA = ds != null ? (seCell != null ? seCell : (hrs ? ds + Math.round(hrs * 60) : null)) : null;
        const spans: { a: number | null; b: number | null; type: string }[] = [];
        if (og1 && og1.a != null) spans.push({ a: og1.a, b: og1.b, type: og2 ? "PRE" : "" });
        if (og2 && og2.a != null) spans.push({ a: og2.a, b: og2.b, type: "POST" });
        const prim = spans.length ? [spans[spans.length - 1].a, spans[spans.length - 1].b] : [null, null];
        const otType = ot > 0 ? (og2 ? "POST" : otTypeOf([ssA, seA], prim, bucket === "OT_OFF")) : "";
        if (!isSup && ot > 0 && bucket !== "OT_OFF") { if (otType === "PRE") { cnt.preP++; cnt.preH += ot; } else { cnt.postP++; cnt.postH += ot; } }
        const k = day + "|" + t.code + "|" + emp;
        seen[k] = (seen[k] || 0) + 1;
        if (seen[k] === 2) addIssue(issues, day, "dupblock", t.code, name + " (" + emp + ")", "รหัสนี้อยู่ในแท็บ 2 แถว/2 บล็อก — อาจมีตารางคนซ้อนซ้ำ · ลบบล็อกซ้ำเพื่อกันข้อมูลตกหล่น/นับซ้ำ");
        duty.push({
          Title: seen[k] > 1 ? k + "#" + seen[k] : k, day_key: day, work_date: day, team: t.code, emp_code: emp, emp_name: name,
          bucket, shift_code: String(row[3] || "").trim(), shift_start: ds != null ? m2hhmm(ds) : "",
          shift_end: seA != null ? m2hhmm(seA) : "", shift_hours: hrs, ot_hours: round1(ot), ot_hol_hours: round1(otHol),
          ot_type: bucket === "OT_OFF" && ot > 0 ? "OFF" : otType, ot_time: spans.length ? fmtRange(spans[0].a, spans[0].b) : "", is_support: isSup, duty_min: dutyMin, busy_min: busy, util_pct: util, source_file: src
        });
        if (isWork(bucket)) acRecs.push({ row: duty[duty.length - 1], rec: {
          team: t.code, name, emp, hrs, bucket, ss: ssA, se: seA, ot, otType, otSpans: spans, otTime: spans.length ? fmtRange(spans[0].a, spans[0].b) : "",
          shiftCode: String(row[3] || "").trim(),
          asg: flights.map(f => ({ f, cells: [0, 1, 2, 3].map(k2 => String(row[f.base + k2] == null ? "" : row[f.base + k2]).trim()).filter(x => x !== "") }))
            .filter(x => x.cells.length).map(x => ({ flight: x.f.code, task: x.cells.filter(c => !/^\d{1,2}[:.]\d{2}$/.test(c)).join(" "), STA: x.f.STA, STD: x.f.STD, OP: x.f.OP, CL: x.f.CL })) } });
      }
    }
    if (ws && people === 0)
      addIssue(issues, day, "droptab", t.code, "อ่านไม่ได้ทั้งแท็บ", "แท็บนี้ไม่มีแถวพนักงานที่อ่านได้ (คอลัมน์ A ต้องเป็นรหัสตัวเลข · C = ชื่อ) — ทั้งทีมหายจากยอด/ไฟลท์");
    manpower.push({
      Title: day + "|" + t.code, day_key: day, month_key: month, work_date: day, team: t.code, total: t.total, working: t.working,
      sick: t.sick, annual: t.annual, training: t.training, ot_hours: round1(otSum), ot_hol_hours: round1(holSum),
      ot_total: round1(otSum + holSum), ot_people: otPpl, ot_off_hours: round1(otOff), is_holiday: isHol, util_pct: uN ? Math.round(uSum / uN) : 0,
      cnt_work: cnt.work, cnt_sick: cnt.sick, cnt_vac: cnt.vac, cnt_personal: cnt.personal, cnt_training: cnt.training,
      cnt_off: cnt.off, cnt_ot_off: cnt.otOff, cnt_staff: cnt.staff, mp_ot_hours: round1(t.mpOt || 0),
      ot_pre_people: cnt.preP, ot_pre_hours: round1(cnt.preH), ot_post_people: cnt.postP, ot_post_hours: round1(cnt.postH)
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
  // ---- ตรวจ Assign รายคน (AssignCheck.gs acAnalyze_) → เก็บในแถว PAS_Duty ----
  const owner = acOwnerTeams(acRecs.map(x => x.rec));
  for (const x of acRecs) {
    const a = acAnalyzeRec(x.rec, owner);
    x.row.ac_status = a.status; x.row.ac_flights = a.flights; x.row.ac_job = a.job.slice(0, 4000); x.row.ac_zones = a.zones;
    x.row.ac_support = a.support; x.row.ac_uncovered = a.uncovered.slice(0, 255); x.row.ac_gaps = a.gaps.slice(0, 255);
    x.row.ac_gaps_raw = a.gapsRaw.slice(0, 255); x.row.ac_ot_verdict = a.otVerdict; x.row.ac_issue = a.issue.slice(0, 4000);
  }
  return { manpower, duty, assignment, otPerson, issues, slaPeople, teamNames: teams.map(x => x.code), acRecs: acRecs.map(x => x.rec) };
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
// ตารางคัดจาก SLA.gs อัตโนมัติ: RQ=[SUP,CI,ARR,GATE,TTL] ต่อสาย · AC=ต่อชนิดเครื่อง · ALIAS · WIN=[ci,cc,post,brief,ccMissing] (นาทีเทียบ STD) · DBREQ=สายที่ใช้ roles
const SLA_T: { RQ: { [a: string]: number[] }; AC: { [a: string]: (string | number)[][] }; ALIAS: { [a: string]: string }; WIN: { [a: string]: number[] }; DBREQ: { [a: string]: number[] }; SYS: { [a: string]: string }; SUPOK: { [a: string]: string[] }; CIINTEAM: string[] } = {"RQ":{"3K":[1,4,1,1,8],"3U":[1,4,1,1,8],"6B":[1,5,2,1,10],"6E":[1,5,1,1,9],"8L":[1,4,1,1,8],"8M":[1,3,1,1,7],"9C":[1,5,1,1,9],"9H":[1,4,1,1,8],"AF":[1,9,1,1,13],"AI":[1,6,1,1,9],"AK":[1,4,1,1,8],"AQ":[1,3,1,1,7],"AY":[1,5,1,1,9],"B2":[1,6,1,1,10],"BY":[1,5,2,1,10],"C6":[1,4,1,1,8],"CA":[1,6,1,1,10],"CX":[1,6,2,1,11],"CZ":[1,6,1,1,10],"DE":[1,6,2,1,11],"DK":[1,4,1,1,8],"DV":[1,4,1,1,8],"EK":[1,7,4,1,14],"EO":[1,6,1,1,10],"EY":[1,7,1,1,12],"FM":[1,4,1,1,8],"FY":[1,3,1,1,6],"G2":[1,6,1,1,10],"G8":[1,4,1,1,8],"G9":[1,4,1,1,8],"H4":[1,5,1,1,9],"HB":[1,3,1,1,7],"HH":[1,4,1,1,8],"HO":[1,4,1,1,8],"HU":[1,6,1,1,10],"HX":[1,5,1,1,9],"HY":[1,5,1,1,8],"IT":[1,4,1,1,7],"IX":[1,4,1,1,7],"JQ":[1,7,1,1,10],"KC":[1,5,1,1,9],"KE":[1,8,1,1,11],"KY":[1,3,1,1,7],"LJ":[1,4,1,1,8],"LO":[1,6,1,1,10],"LY":[1,7,4,1,14],"MH":[1,4,1,1,8],"MU":[1,4,1,1,8],"N0":[1,5,1,1,9],"N4":[1,6,1,1,10],"NO":[1,6,1,1,10],"OD":[1,4,1,1,7],"OM":[1,4,1,1,8],"OQ":[1,4,1,1,8],"OV":[1,4,1,1,8],"OZ":[1,6,1,1,10],"PG":[1,0,1,2,8],"PN":[1,4,1,1,8],"QP":[1,5,1,1,9],"QR":[1,11,3,1,17],"QZ":[1,4,1,1,8],"S7":[1,4,1,1,8],"SG":[1,4,1,1,7],"SQ":[1,4,1,1,8],"SU":[1,8,1,1,12],"SV":[1,7,2,1,12],"TK":[1,8,4,1,15],"TR":[1,5,1,1,10],"U6":[1,4,1,1,8],"UO":[1,4,2,1,8],"VJ":[1,4,1,1,8],"VN":[1,7,1,1,10],"W5":[1,7,2,1,12],"WK":[1,6,2,1,11],"WY":[1,7,1,1,11],"WZ":[1,6,1,1,10],"ZF":[1,6,1,1,10],"ZH":[1,4,1,1,8]},"AC":{"QR":[["B777",11,3,1,17],["B787",9,2,1,14]],"EY":[["B787-9",6,1,1,11],["B787-10",7,1,1,12],["A321Neo",5,1,1,11]],"KE":[["A333/B772/B787",7,1,1,10],["B773",8,1,1,11]],"SU":[["B777",8,1,1,12],["A333",7,1,1,11],["B737/A320/A321Neo",4,1,1,8]],"TR":[["A320",3,1,1,8],["A321",4,1,1,9],["B787",5,1,1,10]],"JQ":[["B787",7,1,1,10],["A321Neo",5,1,1,8]],"AK":[["A320",3,1,1,7],["A321",4,1,1,8]],"QZ":[["A320",3,1,1,7],["A321",4,1,1,8]],"PG":[["A319/320",0,1,2,8],["ATR",0,1,1,6]],"CX":[["A330",6,2,1,11],["A321NEO",5,2,1,10]],"KC":[["A320",4,1,1,8],["B737",5,1,1,9]],"6E":[["A321",5,1,1,9],["A320",4,1,1,8]],"CA":[["A320/B737",4,1,1,8],["A330",6,1,1,10]],"CZ":[["A320",4,1,1,8],["A321",4,1,1,8],["A330",6,1,1,10]],"HU":[["B737",4,1,1,8],["A330",6,1,1,10]],"SV":[["B789",6,2,1,11],["B78X",7,2,1,12]],"VN":[["A320/A321",5,1,1,8],["B787/A350",7,1,1,10]]},"ALIAS":{"3K":"JQ","GX":"CA","KX":"CA","8H":"CA","BK":"CA","PVT":"PRIVATE"},"WIN":{"SQ":[-240,-40,30,60,0],"CX":[-240,-60,30,60,0],"LY":[-240,-60,30,60,0],"QR":[-240,-45,30,60,0],"MH":[-240,-60,30,60,0],"DE":[-240,-45,30,60,0],"PG":[-45,-15,20,60,0],"AK":[-180,-60,20,60,0],"QZ":[-180,-60,20,60,0],"SU":[-180,-40,30,60,0],"B2":[-180,-40,30,60,0],"W5":[-180,-40,30,60,0],"3U":[-180,-60,30,60,0],"CA":[-180,-50,30,60,0],"MU":[-180,-50,30,60,0],"CZ":[-180,-45,30,60,0],"FM":[-180,-50,30,60,0],"HO":[-180,-45,30,60,0],"HU":[-180,-50,30,60,0],"AQ":[-180,-45,30,60,0],"HX":[-240,-50,30,60,0],"EY":[-180,-60,45,60,0],"AY":[-180,-60,30,60,0],"DV":[-180,-60,30,60,0],"KE":[-240,-45,30,60,0],"KC":[-240,-45,30,60,0],"OZ":[-180,-45,30,60,0],"NO":[-180,-45,30,60,0],"AF":[-240,-45,30,60,0],"LJ":[-180,-45,20,60,0],"OV":[-180,-45,20,60,0],"WY":[-180,-60,20,60,0],"G9":[-180,-60,20,60,0],"DK":[-180,-60,20,60,0],"9C":[-180,-45,20,60,0],"EK":[-240,-60,30,60,0],"UO":[-180,-45,20,60,0],"FY":[-144,-45,20,60,0],"6B":[-180,-45,20,60,0],"BY":[-180,-45,20,60,0],"AI":[-180,-45,20,60,0],"IX":[-180,-45,20,60,0],"JQ":[-180,-60,20,60,0],"IT":[-180,-45,20,60,0],"N0":[-180,-45,20,60,0],"TK":[-180,-60,30,60,0],"VJ":[-180,-45,20,60,0],"OD":[-180,-45,20,60,0],"SG":[-180,-45,20,60,0],"HY":[-180,-45,20,60,0],"TR":[-150,-60,20,60,0],"6E":[-180,-45,20,60,0],"QP":[-180,-45,20,60,0],"SV":[-240,-45,30,60,0],"WK":[-198,-45,30,60,0],"KA":[-180,-45,20,60,0],"ZF":[-180,-45,20,60,0],"HH":[-180,-45,20,60,0],"LO":[-180,-45,20,60,0],"EO":[-180,-45,20,60,0],"S7":[-180,-45,20,60,0],"8L":[-180,-45,20,60,0],"8M":[-180,-45,20,60,0],"9H":[-180,-45,20,60,0],"C6":[-180,-45,20,60,0],"G2":[-180,-45,20,60,0],"H4":[-180,-45,20,60,0],"HB":[-180,-45,20,60,0],"KY":[-180,-45,20,60,0],"N4":[-180,-45,20,60,0],"OM":[-180,-45,20,60,0],"OQ":[-180,-45,20,60,0],"PN":[-180,-45,20,60,0],"VN":[-180,-45,20,60,0],"WZ":[-180,-45,20,60,0],"ZH":[-180,-45,20,60,0],"PRIVATE":[-60,-20,20,20,0],"CHARTER":[-120,-30,20,30,0],"DEFAULT":[-180,-45,20,60,0]},"DBREQ":{"SQ":[1,6,0,6,13],"CX":[1,7,0,7,15],"LY":[1,8,0,4,13],"QR":[1,12,3,4,20],"MH":[1,4,1,3,9],"DE":[1,5,1,4,11],"PG":[1,0,2,7,9],"AK":[1,3,1,3,8],"QZ":[1,3,1,3,8],"SU":[1,16,1,5,23],"B2":[1,7,0,0,8],"W5":[1,7,0,0,8],"3U":[1,4,1,5,11],"CA":[1,6,1,4,12],"MU":[1,5,1,4,11],"CZ":[1,4,1,4,10],"FM":[1,5,1,4,11],"HO":[1,4,2,3,10],"HU":[1,4,1,4,10],"AQ":[1,4,1,3,9],"HX":[1,5,1,4,11],"EY":[1,4,1,5,11],"AY":[1,4,1,3,9],"DV":[1,4,1,3,9],"KE":[1,5,1,1,8],"KC":[1,6,1,1,9],"OZ":[1,4,1,1,7],"NO":[1,4,1,1,7],"AF":[1,5,2,1,9],"LJ":[1,4,1,1,7],"OV":[1,4,1,1,7],"WY":[1,6,1,6,15],"G9":[1,4,1,0,6],"DK":[1,4,1,0,6],"9C":[1,4,1,1,7],"EK":[1,6,4,5,16],"UO":[1,4,2,3,10],"FY":[1,3,1,3,8],"6B":[1,4,1,3,9],"BY":[1,4,1,3,9],"AI":[1,3,2,5,12],"IX":[1,4,0,0,5],"JQ":[1,5,3,6,15],"IT":[1,4,1,2,8],"N0":[1,4,1,2,8],"TK":[1,3,2,4,11],"VJ":[1,2,1,1,5],"OD":[1,1,1,1,5],"SG":[1,4,1,2,8],"HY":[1,4,1,2,8],"TR":[1,5,1,3,10],"6E":[1,5,1,0,7],"QP":[1,5,1,0,7],"SV":[1,7,2,3,14],"WK":[1,7,2,3,14],"KA":[1,5,1,3,10],"ZF":[1,5,1,3,10],"HH":[1,4,1,2,8],"LO":[1,4,1,2,8],"EO":[1,4,1,2,8],"S7":[1,5,1,3,10],"8L":[1,5,1,1,8],"8M":[1,4,1,1,7],"9H":[1,5,1,1,8],"C6":[1,5,1,1,8],"G2":[1,7,1,1,10],"H4":[1,6,1,1,9],"HB":[1,4,1,1,7],"KY":[1,4,1,1,7],"N4":[1,7,1,1,10],"OM":[1,5,1,1,8],"OQ":[1,5,1,1,8],"PN":[1,5,1,1,8],"VN":[1,7,1,1,10],"WZ":[1,7,1,1,10],"ZH":[1,5,1,1,8],"PRIVATE":[1,1,0,1,3],"CHARTER":[1,2,1,1,5],"DEFAULT":[1,4,1,2,8]},"SYS":{"3K":"Gonow","3U":"Angel Lite","6B":"iPort","6E":"Gonow","8H":"TravelSky","8L":"TravelSky","8M":"iPort","9C":"TravelSky","9H":"TravelSky","AF":"Altea","AI":"Altea","AK":"Gonow","AQ":"TravelSky","AY":"Altea","B2":"ASTRA","BK":"TravelSky","BY":"iPort","C6":"iPort","CA":"TravelSky","CX":"Altea","CZ":"TravelSky","DE":"Altea","DK":"Altea","DV":"TWD","EK":"AS Connect","EO":"Lydia DCS","EY":"Altea","FM":"TravelSky","FY":"Gonow","G2":"iPort","G8":"Gonow","G9":"Altea","GX":"TravelSky","H4":"iPort","HB":"TravelSky","HH":"iPort","HO":"TravelSky","HU":"TravelSky","HX":"iPort","HY":"Altea","IT":"iPort","IX":"Gonow","JQ":"Gonow","KA":"iPort","KC":"Altea","KE":"Altea","KX":"TravelSky","KY":"TravelSky","LJ":"iFlyRes","LO":"iPort","LY":"Altea","MH":"Altea","MU":"TravelSky","N0":"Gonow","N4":"Lydia DCS","NO":"iPort","OD":"Sabre","OM":"iPort","OQ":"TravelSky","OV":"iPort","OZ":"Altea","PG":"Altea","PN":"TravelSky","QP":"Gonow","QR":"Altea","QZ":"Gonow","S7":"TWD","SG":"Gonow","SQ":"Altea","SU":"ASTRA","SV":"Altea","TK":"TOYA","TR":"Gonow","U6":"Gonow","UO":"Gonow","VJ":"iPort","VN":"Altea","W5":"AVIA","WK":"Altea","WY":"Sabre","WZ":"ASTRA","ZF":"ASTRA","ZH":"TravelSky"},"SUPOK":{"AK":["ARR","GATE"],"QZ":["ARR","GATE"],"8M":["ARR","GATE"],"ZF":["CI","ARR","GATE"],"LO":["CI","ARR","GATE"],"N4":["ARR","GATE"],"HH":["CI","ARR","GATE"],"EO":["ARR","GATE"],"S7":["ARR","GATE"],"CZ":["ARR","GATE"],"MU":["GATE"],"FM":["GATE"],"3U":["GATE"],"CA":["ARR","GATE"],"HO":["ARR","GATE"],"HX":["ARR","GATE"],"HU":["GATE"],"6B":["ARR","GATE"],"BY":["ARR","GATE"],"UO":[],"EK":[],"FY":[],"EY":["ARR","GATE"],"AY":["ARR","GATE"],"DV":["CI","ARR","GATE"],"AI":["ARR","GATE"],"IX":["ARR","GATE"],"JQ":["ARR","GATE"],"IT":["CI","ARR","GATE"],"KC":["ARR","GATE"],"OZ":[],"KE":[],"LJ":["ARR"],"NO":["ARR","GATE"],"OV":["ARR","GATE"],"PG":["ARR","GATE"],"PRIVATE":["ARR"],"QR":[],"DE":["ARR","GATE"],"MH":["ARR","GATE"],"OM":["ARR","GATE"],"SQ":["ARR","GATE"],"CX":["ARR","GATE"],"LY":["CI","ARR","GATE"],"SU":["ARR","GATE"],"W5":["ARR","GATE"],"B2":[],"TK":[],"HY":["ARR","GATE"],"OD":["ARR","GATE"],"VJ":["ARR","GATE"],"SG":["ARR","GATE"],"TR":["ARR","GATE"],"6E":["ARR","GATE"],"QP":["ARR","GATE"],"WK":["ARR","GATE"],"SV":["ARR","GATE"],"G9":["ARR","GATE"],"WY":["ARR","GATE"],"9C":["ARR","GATE"],"DK":["CI","ARR","GATE"],"3K":[],"8L":["SUP","CI","GATE","ARR"],"9H":["SUP","CI","GATE","ARR"],"AF":["GATE"],"AQ":["SUP","CI","GATE","ARR"],"C6":[],"G2":["SUP","CI","GATE","ARR"],"G8":[],"HB":[],"KY":["SUP","CI","GATE","ARR"],"N0":[],"OQ":["SUP","CI","GATE","ARR"],"PN":["SUP","CI","GATE","ARR"],"U6":[],"VN":["ARR","GATE"],"WZ":["SUP","CI","GATE","ARR"],"ZH":["SUP","CI","GATE","ARR"]},"CIINTEAM":["EY","QR","EK"]};
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

interface SlaFlight { key: string; flight: string; airline: string; STA: string; STD: string; teams: { [t: string]: boolean }; short: { [ph: string]: number }; ok: boolean; noTime: boolean; teamList: string; req: Req }
function computeSla(day: string, people: SlaPerson[], teamNames: string[], sched: { [k: string]: SchedRow }, pss: { [e: string]: boolean }, rules: { [a: string]: number[] }): { rows: SlaRow[]; flights: SlaFlight[] } {
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
  const fl: SlaFlight[] = [];
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
    fl.push({ key, flight: f.flight, airline: f.airline, STA: f.STA, STD: f.STD, teams: f.teams, short, ok, noTime, teamList: home || Object.keys(f.teams).join(","), req });
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
  const byKey: { [k: string]: SlaRow } = {};
  for (const r of rows) byKey[r.flight_key] = r;
  const cmp = (x: string, y: string) => x < y ? -1 : x > y ? 1 : 0;
  rows.sort((a, b) => cmp(a.std || a.sta || "zz", b.std || b.sta || "zz"));
  const flOut = fl.filter(x => !(byKey[x.key].no_time && byKey[x.key].fragment)).sort((a, b) => cmp(a.STD || a.STA || "zz", b.STD || b.STA || "zz"));
  return { rows, flights: flOut };
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


// ======================= ตรวจ Assign (พอร์ตจาก AssignCheck.gs · acAnalyze_ / acAnalyzeRecord_ / acFlightWin_ / acDuty_) =======================
const AC_COVER_TOL = 60, AC_GAP_MIN = 180, AC_EDGE_MIN = 240, AC_WIN_MAX = 14 * 60;
interface AcAsg { flight: string; task: string; STA: string; STD: string; OP: string; CL: string }
interface AcRec { team: string; name: string; emp?: string; hrs?: number; bucket: string; ss: number | null; se: number | null; ot: number; otType: string;
  otSpans: { a: number | null; b: number | null; type: string }[]; otTime: string; shiftCode: string; asg: AcAsg[] }
interface AcRes { status: string; flights: string; job: string; zones: string; support: number; uncovered: string; gaps: string; gapsRaw: string; otVerdict: string; issue: string }

function acOwnerTeams(recs: AcRec[]): { [al: string]: string } {
  const cnt: { [al: string]: { [t: string]: number } } = {};
  for (const r of recs) {
    if (skipTeam(r.team)) continue;
    for (const a of r.asg) { if (!isFlightName(a.flight)) continue; const al = airlineOf(a.flight); const c = cnt[al] = cnt[al] || {}; c[r.team] = (c[r.team] || 0) + 1; }
  }
  const owner: { [al: string]: string } = {};
  for (const al of Object.keys(cnt)) { let best = "", bn = -1; for (const t of Object.keys(cnt[al])) if (cnt[al][t] > bn) { bn = cnt[al][t]; best = t; } owner[al] = best; }
  return owner;
}
function acMinS(s: string): number | null { const m = String(s == null ? "" : s).match(/(\d{1,2}):(\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : null; }
function acNZ(s: string): number | null { const v = acMinS(s); return v ? v : null; }                  // 00:00 = placeholder → null
function fmtMin(m: number | null): string { if (m == null) return ""; const x = ((Math.round(m) % 1440) + 1440) % 1440; return p2t(Math.floor(x / 60)) + ":" + p2t(x % 60); }
function p2t(x: number): string { return (x < 10 ? "0" : "") + x; }
function fmtRange(a: number | null, b: number | null): string { return a != null && b != null ? fmtMin(a) + "-" + fmtMin(b) : ""; }
function acIsActivity(s: string): boolean {
  const u = String(s || "").toUpperCase(); if (!u) return false;
  return /TRAIN|\bOJT\b|\bBRIEF|RECURRENT|WORKSHOP|ORIENTATION|SEMINAR|MEETING|E-?LEARNING|\bLMS\b|\bEXAM\b|\bCOURSE\b|TOWN\s?HALL|\bGOM\b|ACCESSOR|MANDATORY|IN.?HOUSE|อบรม|เทรน|บรีฟ|ประชุม|สัมมนา|กิจกรรม|สอนงาน|ทดสอบ|\bสอบ\b/.test(u);
}
function acIsCoverWork(s: string): boolean { return /^LP\s+(MORNING|AFTERNOON|EVENING|NIGHT)\b/i.test(s) || /^Counter\s+[A-Z]{0,2}\d/i.test(s) || /CHECK[- ]?IN\s*COMMON/i.test(s); }
function acIsJunk(s: string): boolean { const x = String(s || "").trim(); if (!x) return true; return /^[ADOC]\s*:\s*\d/i.test(x) || /^\d{1,2}[:.]\d{2}$/.test(x) || /^\d{1,2}\s+[A-Z]{3}\s*\d{0,4}$/i.test(x); }
function acActCell(v: string): number | null {
  const s = String(v == null ? "" : v).replace(/^\s*[ADOC]\s*[:：]?\s*/i, "").trim();
  const m = s.match(/(\d{1,2})[:.\-](\d{2})/); if (m && +m[1] < 24 && +m[2] < 60) return (+m[1]) * 60 + (+m[2]);
  const h = s.match(/^(\d{3,4})$/); if (h) { const mn = +h[1].slice(-2), hh = +h[1].slice(0, -2); if (hh < 24 && mn < 60) return hh * 60 + mn; }
  return null;
}
function acActTok(t: string): number | null {
  const mm = t.match(/^(\d{1,2})[:.](\d{2})$/); if (mm) return (+mm[1] < 24 && +mm[2] < 60) ? (+mm[1]) * 60 + (+mm[2]) : null;
  const hm = t.match(/^(\d{3,4})$/); if (hm) { const mn = +hm[1].slice(-2), hh = +hm[1].slice(0, -2); return (hh < 24 && mn < 60) ? hh * 60 + mn : null; }
  const ho = t.match(/^(\d{1,2})$/); if (ho) return +ho[1] < 24 ? (+ho[1]) * 60 : null;
  return null;
}
function acDb(flight: string): { ci: number; cc: number; post: number; brief: number } {
  const c = airlineOf(flight), al = SLA_T.ALIAS[c];
  const w = SLA_T.WIN[c] || (al ? SLA_T.WIN[al] : undefined) || SLA_T.WIN.DEFAULT;
  return { ci: w[0] || -180, cc: w[4] ? -60 : w[1], post: w[2], brief: w[3] || 60 };
}
function acDocDeadline(task: string, sta: number | null, std: number | null): number[] | null {
  const t = String(task || "").toUpperCase();
  if (/\bDE-?BRIEF\b/.test(t)) return std == null ? null : [std, std + 60];
  if (/\bMANIFEST\b|\bMNF\b|STAFF\s*LIST|\bSTAFFLIST\b/.test(t)) { const base = sta != null ? sta : std; if (base == null) return null; const dl = base - 60; return [dl - 60, dl]; }
  return null;
}
function acFlightWin(a: AcAsg): number[] | null {
  if (acIsJunk(a.flight)) return null;
  const atxt = (a.task || "") + " " + (a.flight || "");
  if (acIsActivity(atxt)) {
    const ts0 = acActCell(a.STA) || acActCell(a.OP), te0 = acActCell(a.STD) || acActCell(a.CL);
    if (ts0 != null && te0 != null) return [ts0, te0 <= ts0 ? te0 + 1440 : te0];
    const rg = atxt.match(/(\d{1,2}[:.]\d{2}|\d{3,4}|\d{1,2})\s*[-–]\s*(\d{1,2}[:.]\d{2}|\d{3,4}|\d{1,2})/);
    if (rg) { const alo = acActTok(rg[1]); let ahi = acActTok(rg[2]); if (alo != null && ahi != null) { if (ahi <= alo) ahi += 1440; return [alo, ahi]; } }
  }
  const sta = acNZ(a.STA), op = acNZ(a.OP), cl = acNZ(a.CL), std = acNZ(a.STD);
  const docWin = acDocDeadline(a.task, sta, std); if (docWin) return docWin;
  if (sta != null && std != null && !isFlightName(a.flight)) { let lw2 = std; if (lw2 <= sta) lw2 += 1440; return [sta, lw2]; }
  const db = acDb(a.flight), brief = db.brief, ci = db.ci, post = db.post;
  if (std != null && airlineOf(a.flight) === "EY" && !acIsActivity(atxt)) {
    const eop = op != null ? op : std + ci; const elo = eop - brief; let ehi = std + post; if (ehi <= elo) ehi += 1440; return [elo, ehi];
  }
  const tsk = String(a.task || "");
  const hasRelEnd = /\bGK\b|\bFR\b|FLIGHT\s*RELEASE/i.test(tsk), isCrewSign = /\bCS\b|CREW\s*SIGN|\bCRW\b/i.test(tsk);
  const hasSeat = /\bCF\b|\bCT\d|\bCT\b|\bC\b|\bY\d?\b|\bJ\d?\b|\bW\d|\bB\d|\bF\d|WEB|KIOSK|\bKSK\b|BAG\s?DROP|\bPRIO\b|COUNTER|WEL\s*G/i.test(tsk);
  const hasBoard = /\bGATE\b|\bG[ABCM]\b|\bG\b|BOARD|\bGM\b/i.test(tsk);
  if (isCrewSign && !hasRelEnd && !hasSeat && !hasBoard && (op != null || std != null || sta != null)) {
    const opR = op != null ? op : (std != null ? std + ci : (sta as number)); const rlo = opR + 120;
    let rhi = std != null ? std + post : (sta != null ? sta + post : rlo + 60); if (rhi <= rlo) rhi += 1440; if (rhi - rlo < 30) rhi = rlo + 30; return [rlo, rhi];
  }
  if (hasRelEnd && (op != null || std != null || sta != null)) {
    const fo = op != null ? op : (std != null ? std + ci : (sta as number));
    let fhi = std != null ? std + post : (sta != null ? sta + post : fo + 60); if (fhi <= fo) fhi += 1440; if (fhi - fo < 30) fhi = fo + 30; return [fo, fhi];
  }
  const phs = phasesOf(a.task);
  const onlyAG = phs.length > 0 && phs.every(x => x === "GATE" || x === "ARR");
  if (onlyAG && (sta != null || std != null)) {
    const hasArr = phs.indexOf("ARR") >= 0, hasGate = phs.indexOf("GATE") >= 0;
    let glo: number, ghi: number;
    if (hasArr && !hasGate) { glo = sta != null ? sta - 30 : (std as number) - 90; ghi = sta != null ? sta + post : (std as number) + post; }
    else if (hasGate && !hasArr) { glo = std != null ? std - 90 : (sta as number) - 30; ghi = std != null ? std + post : (sta as number) + post; }
    else {
      const tgap = sta != null && std != null ? ((std - sta + 1440) % 1440) : 0;
      if (sta != null && std != null && tgap <= 180) { glo = sta - 30; ghi = std + post; }
      else { glo = std != null ? std - 90 : (sta as number) - 30; ghi = std != null ? std + post : (sta as number) + post; }
    }
    if (ghi <= glo) ghi += 1440; return [glo, ghi];
  }
  const ciOnly = phs.length > 0 && phs.every(x => x === "CI");
  const noCounter = op == null && cl == null;
  let lo: number | null = null, hi: number | null;
  if (ciOnly && std != null && !hasRelEnd && !noCounter) hi = cl != null ? cl : std + db.cc;
  else hi = std != null ? std + post : null;
  const ciOpen = op != null ? op : (std != null ? std + ci : null);
  if (op != null) lo = op - brief;
  else if (noCounter && sta != null) lo = sta;
  else if (ciOpen != null) lo = ciOpen - brief;
  if (!ciOnly && cl != null && hi != null && cl + post < hi && (ciOpen == null || cl > ciOpen) && phs.indexOf("GATE") < 0 && !hasRelEnd) hi = cl + post;
  if (hi == null && sta != null) { lo = sta - brief; hi = sta + post; }
  if (lo == null || hi == null) {
    const ts = [sta, op, cl, std].filter(x => x) as number[]; if (!ts.length) return null;
    lo = Math.min(...ts) - brief; hi = Math.max(...ts);
  }
  if (hi <= lo) hi += 1440;
  return [lo, hi];
}
function acFlightWins(a: AcAsg): { lo: number; hi: number; sub: boolean }[] {
  const base = acFlightWin(a); if (!base) return [];
  if (base[1] - base[0] > AC_WIN_MAX) return [];
  const phs = phasesOf(a.task);
  if (phs.length < 2 || phs.indexOf("ARR") < 0 || (phs.indexOf("CI") < 0 && phs.indexOf("GATE") < 0)) return [{ lo: base[0], hi: base[1], sub: false }];
  const sta = acMinS(a.STA), std = acMinS(a.STD);
  if (!sta || !std) return [{ lo: base[0], hi: base[1], sub: false }];
  let gap = std - sta; if (gap < 0) gap += 1440;
  if (gap <= 180) return [{ lo: base[0], hi: base[1], sub: false }];
  const post = acDb(a.flight).post;
  return [{ lo: base[0], hi: base[1], sub: false }, { lo: sta - 30, hi: sta + post, sub: true }];
}
function alignTo(a: number, b: number, rs: number, re: number): number[] {
  if (b <= a) b += 1440;
  let bestK = 0, bestGap = Infinity;
  for (let k = -2; k <= 2; k++) { const aa = a + 1440 * k, bb = b + 1440 * k; const gap = aa > re ? aa - re : (bb < rs ? rs - bb : 0); if (gap < bestGap) { bestGap = gap; bestK = k; } }
  return [a + 1440 * bestK, b + 1440 * bestK];
}
// rrOtType_: OT ก่อน/หลังกะ จากเวลาจริง (ไม่มีเวลา → หลังกะ)
function otTypeOf(srng: (number | null)[], orng: (number | null)[], isOff: boolean): string {
  if (isOff) return "POST";
  const si = srng[0]; let so = srng[1], oi = orng[0], oo = orng[1];
  if (oi == null) return "POST";
  if (oo == null) return si != null && oi < si ? "PRE" : "POST";
  if (so != null && si != null && so <= si) so += 1440;
  if (oo != null && oo <= oi) oo += 1440;
  if (si == null || so == null) return si != null && oi < si ? "PRE" : "POST";
  const al = alignTo(oi, oo as number, si, so); oi = al[0]; oo = al[1];
  return (oo as number) <= si + 30 ? "PRE" : "POST";
}
function acDuty(r: AcRec): { ss: number | null; se: number | null; ds: number | null; de: number | null; otSegs: number[][] } {
  let ss = r.ss, se = r.se;
  if (ss != null && se != null && se <= ss) se += 1440;
  const spans = r.otSpans.filter(sp => sp.a != null);
  let ds = ss, de = se; const otSegs: number[][] = [];
  if (r.bucket === "OT_OFF") {
    if (spans.length) { const a0 = spans[0].a as number; let b0 = spans[0].b; if (b0 != null && b0 <= a0) b0 += 1440; ds = a0; de = b0; if (ds != null && de != null) otSegs.push([ds, de]); }
    else { ds = null; de = null; }
  } else if (spans.length) {
    for (const sp of spans) {
      const oi = sp.a as number; const oo = sp.b == null ? oi : sp.b;
      let a = oi, b = oo; if (b <= a) b += 1440;
      const t = otTypeOf([ss, se], [oi, oo], false);
      if (t === "PRE") { while (ss != null && b - ss > 720) { a -= 1440; b -= 1440; } while (ss != null && ss - b > 720) { a += 1440; b += 1440; } }
      else { while (se != null && a - se > 720) { a -= 1440; b -= 1440; } while (se != null && ss != null && se - a > 720 && b <= ss) { a += 1440; b += 1440; } }
      otSegs.push([a, b]);
      ds = ds == null ? a : Math.min(ds, a); de = de == null ? b : Math.max(de, b);
    }
  } else if (r.ot > 0 && ss != null && se != null) {
    if (r.otType === "PRE") { ds = ss - Math.round(r.ot * 60); otSegs.push([ds, ss]); }
    else { de = se + Math.round(r.ot * 60); otSegs.push([se, de]); }
  }
  return { ss, se, ds, de, otSegs };
}
function acAnalyzeRec(r: AcRec, owner: { [al: string]: string }): AcRes {
  const isDoc = r.team.toUpperCase().indexOf("ADMIN") >= 0 && r.team.toUpperCase().indexOf("DOC") >= 0;
  const d = acDuty(r);
  const reliable = d.ss != null || (r.bucket === "OT_OFF" && d.ds != null);
  let hasWindow = reliable && d.ds != null && d.de != null;
  const shiftStr = r.bucket === "OT_OFF" ? "OFF" : (d.ss != null && d.se != null ? fmtMin(d.ss) + "–" + fmtMin(d.se) : (r.shiftCode || "-"));
  const wins: { flight: string; lo: number; hi: number; coverable: boolean; zone: boolean; sov: boolean }[] = [];
  let actN = 0;
  for (const a of r.asg) {
    if (!a.flight) continue;
    const isAct = acIsActivity(a.task) || acIsActivity(a.flight);
    const ws = acFlightWins(a);
    if (!ws.length) { if (isAct) actN++; continue; }
    for (const wn of ws) {
      let lo = wn.lo, hi = wn.hi;
      if (d.ds != null && d.de != null) { const fa = alignTo(lo, hi, d.ds, d.de); lo = fa[0]; hi = fa[1]; }
      else if (d.ds != null && lo < d.ds - 720) { lo += 1440; hi += 1440; }
      const isZone = acIsCoverWork(a.flight);
      wins.push({ flight: a.flight, lo, hi, coverable: (isFlightName(a.flight) || isZone) && !isAct && !wn.sub && !isDoc, zone: isZone, sov: /\bSOD\b|SPVR|SUPERVIS|\bSOV\b/i.test(a.task) });
    }
  }
  if (r.bucket === "OT_OFF" && wins.length) {
    for (const w of wins) { if (d.ds == null || w.lo < d.ds) d.ds = w.lo; if (d.de == null || w.hi > d.de) d.de = w.hi; }
    hasWindow = d.ds != null && d.de != null;
  }
  const res: AcRes = { status: "ok", flights: "", job: "", zones: "0/0/0", support: 0, uncovered: "", gaps: "", gapsRaw: "", otVerdict: "", issue: "" };
  if (!hasWindow) { res.status = "nowin"; res.flights = "ไม่มีเวลากะ"; res.issue = "ไม่มีเวลากะระบุ — ตรวจครอบคลุมไม่ได้"; return res; }
  let sovN = 0; for (const w of wins) if (w.coverable && w.sov) sovN++;
  const sovMulti = sovN >= 2;
  let flightN = 0, coveredN = 0; const uncovered: string[] = [];
  const ds = d.ds as number, de = d.de as number;
  for (const w of wins) {
    if (!w.coverable) continue;
    flightN++;
    const overlaps = w.hi > ds && w.lo < de;
    if (w.lo >= ds - AC_COVER_TOL && w.hi <= de + AC_COVER_TOL) coveredN++;
    else if (w.zone && overlaps) coveredN++;
    else if (w.sov && sovMulti) coveredN++;
    else if (overlaps) coveredN++;
    else uncovered.push(w.flight + " (" + fmtMin(w.lo) + "–" + fmtMin(w.hi) + ")");
  }
  const gaps: { a: number; b: number; kind: string }[] = [];
  if (wins.length) {
    const iv = wins.map(w => [Math.max(w.lo, ds), Math.min(w.hi, de)]).filter(w => w[1] > w[0]).sort((a, b) => a[0] - b[0]);
    const merged: number[][] = [];
    for (const w of iv) { const last = merged[merged.length - 1]; if (last && w[0] <= last[1]) last[1] = Math.max(last[1], w[1]); else merged.push([w[0], w[1]]); }
    if (merged.length) {
      if (merged[0][0] - ds >= AC_EDGE_MIN) gaps.push({ a: ds, b: merged[0][0], kind: "edge" });
      for (let i = 0; i < merged.length - 1; i++) if (merged[i + 1][0] - merged[i][1] >= AC_GAP_MIN) gaps.push({ a: merged[i][1], b: merged[i + 1][0], kind: "mid" });
      if (de - merged[merged.length - 1][1] >= AC_EDGE_MIN) gaps.push({ a: merged[merged.length - 1][1], b: de, kind: "edge" });
    }
  }
  const issues: string[] = [];
  if (uncovered.length) {
    res.status = "bad"; issues.push("ไฟลท์นอกเวลางาน: " + uncovered.join(", "));
    res.otVerdict = r.ot > 0 ? "🔴 OT ไม่พอครอบคลุมไฟลท์" : "🔴 ควรให้ OT/Re-Sked";
  } else if (r.ot > 0 && r.bucket !== "OT_OFF") {
    let justified = flightN === 0;
    for (const w of wins) {
      if (r.otType === "PRE" && d.ss != null && w.lo < d.ss) justified = true;
      if (r.otType !== "PRE" && d.se != null && w.hi > d.se) justified = true;
    }
    if (!justified && flightN > 0) { res.status = "warn"; res.otVerdict = "🟡 OT อาจเกินจำเป็น (ไฟลท์อยู่ในเวลากะ)"; issues.push(res.otVerdict); }
    else res.otVerdict = "🟢 OT เหมาะสม";
  } else if (r.bucket === "OT_OFF") res.otVerdict = "🟢 OT OFF (เข้าช่วยวันหยุด)";
  if (gaps.length) {
    if (res.status === "ok") res.status = "warn";
    issues.push("ช่วงว่าง " + gaps.map(g => fmtMin(g.a) + "–" + fmtMin(g.b) + " (" + Math.round((g.b - g.a) / 6) / 10 + "h" + (g.kind === "mid" ? " ระหว่างไฟลท์" : "") + ")").join(", "));
  }
  // รายการงาน + โซน (ในกะ / OT / นอกกะ) + ซัพพอร์ตข้ามทีม
  const zc = { shift: 0, ot: 0, out: 0 }; let nSup = 0;
  const skipT = skipTeam(r.team);
  const jobs = r.asg.filter(x => x.flight && !acIsJunk(x.flight)).map(x => {
    let w = acFlightWin(x); if (w && w[1] - w[0] > AC_WIN_MAX) w = null;
    const tm = w ? " " + fmtMin(w[0]) + "–" + fmtMin(w[1]) : " (ไม่มีเวลา)";
    const jb = x.task ? " [" + x.task.replace(/\s+/g, " ").trim() + "]" : "";
    const ow = isFlightName(x.flight) ? owner[airlineOf(x.flight)] : "";
    const sup = !skipT && ow && ow !== r.team ? " ซัพพอร์ต" : ""; if (sup) nSup++;
    const z = !acIsActivity(x.task) && !acIsActivity(x.flight) ? acJobZone(w, d) : "";
    if (z === "shift") zc.shift++; else if (z && z.indexOf("ot") === 0) zc.ot++; else if (z === "out") zc.out++;
    const zm = z === "out" ? "🟥นอกกะ" : z === "ot-pre" ? "🟧OTก่อนกะ" : z === "ot-post" ? "🟧OTหลังกะ" : z === "shift" ? "🟩" : "";
    return x.flight + jb + tm + sup + (zm ? " " + zm : "");
  });
  res.job = jobs.join(", "); res.zones = zc.shift + "/" + zc.ot + "/" + zc.out; res.support = nSup;
  res.flights = flightN ? coveredN + "/" + flightN + " ครอบคลุม" : (wins.length ? wins.length + " เคาน์เตอร์/งาน" : "ไม่มี");
  res.uncovered = uncovered.join("; ");
  res.gaps = gaps.map(g => fmtMin(g.a) + "–" + fmtMin(g.b)).join(", ");
  res.gapsRaw = gaps.map(g => g.a + "~" + g.b).join(",");
  res.issue = issues.join(" · ");
  void actN;
  return res;
}
function acJobZone(w: number[] | null, d: { ss: number | null; se: number | null; ds: number | null; de: number | null; otSegs: number[][] }): string {
  if (!w || d.ds == null || d.de == null) return "";
  let lo = w[0], hi = w[1];
  let overlaps = hi > d.ds && lo < d.de;
  if (!overlaps && hi + 1440 > d.ds && lo + 1440 < d.de) { lo += 1440; hi += 1440; overlaps = true; }
  if (!overlaps) return "out";
  const ov = (a0: number, b0: number, a1: number, b1: number) => Math.max(0, Math.min(b0, b1) - Math.max(a0, a1));
  const inShift = d.ss != null && d.se != null ? ov(lo, hi, d.ss, d.se) : 0;
  let inOt = 0, otType = "";
  for (const sg of d.otSegs) { const o = ov(lo, hi, sg[0], sg[1]); if (o > inOt) { inOt = o; otType = d.se != null && sg[0] >= d.se - 1 ? "post" : "pre"; } }
  return inOt > inShift && inOt > 0 ? "ot-" + otType : "shift";
}
// เวลาจากเซลล์: "06:00"/"0600"/เศษวันของ Excel (0–1) → นาที · ค่าอื่น (เช่น ชม. 9) → null
function timeOnly(v: Cell): number | null {
  if (typeof v === "number") return v > 0 && v < 1 ? Math.round(v * 1440) % 1440 : null;
  const s = String(v || "").trim(); let m = s.match(/^(\d{1,2})[:.](\d{2})/); if (m) return (+m[1]) * 60 + (+m[2]);
  m = s.match(/^(\d{2})(\d{2})$/); return m ? (+m[1]) * 60 + (+m[2]) : null;
}
// กลุ่ม OT: IN, OUT, ชม.รวม → {a,b,h} · IN=OUT = ไม่มี OT (placeholder) · ไม่มีชม. แต่มีช่วง → คิดจากช่วง
function otGroup(vin: Cell, vout: Cell, vtot: Cell): { a: number | null; b: number | null; h: number } | null {
  let a = timeOnly(vin), b = timeOnly(vout);
  if (a != null && b != null && a === b) { a = null; b = null; }
  let h = typeof vtot === "number" ? (vtot > 0 && vtot < 1 ? Math.round(vtot * 24 * 10) / 10 : vtot) : (() => { const s = String(vtot || ""); const mm = s.match(/^(\d+):(\d{2})/); return mm ? (+mm[1]) + (+mm[2]) / 60 : (parseFloat(s) || 0); })();
  if (!(h > 0) && a != null && b != null) { let bb = b; if (bb <= a) bb += 1440; h = Math.round((bb - a) / 60 * 10) / 10; }
  if (!(h > 0) && a == null) return null;
  return { a, b, h: h > 0 ? h : 0 };
}


// ======================= Support / เติมคน (พอร์ตจาก SLA.gs · slaSupportRows_ / slaSupportPool_ / slaCandidates_ / slaOtherCands_) =======================
const SLA_TRANSIT_MIN = 55, SLA_REST_MIN = 60, SLA_MAX_CAND = 24, WH_SHIFT_MIN = 7, WH_SHIFT_MAX = 12, WH_DAY_HIGH = 14;
interface PoolP { name: string; emp: string; team: string; posGroup: string; off: boolean; otoff: boolean; rest: boolean; float: boolean; ds: number; de: number;
  busy: number[][]; hold: number[][]; sys: { [s: string]: boolean }; nflt: number; shiftDisp: string; otDisp: string; hrs: number; hlevel: string; htxt: string; flts: string[]; plan: number }
interface SupportRow { Title: string; day_key: string; month_key: string; flight: string; airline: string; system: string; team: string; std: string;
  phase: string; short_n: number; win: string; win_fb: boolean; no_flight_time: boolean; need_sys: string; block: string; n_cand: number;
  picks: string; cands_json: string; others_json: string }
function sysNorm(s: string): string { return String(s || "").toLowerCase().replace(/[\s.]+/g, ""); }
function sysOf(airline: string): string { return SLA_T.SYS[airline.toUpperCase()] || ""; }
function needSys(airline: string, ph: string): string { if (ph !== "CI" && ph !== "SUP") return ""; const s = sysOf(airline); return s && sysNorm(s) !== "iport" ? s : ""; }
function isFloatTeam(team: string): boolean { return /PVT|PRIVATE|\bLP\b|FLOAT|STBY|STAND ?BY|CHARTER|\bZF\b/.test(team.toUpperCase()); }
function canSupport(airline: string, ph: string): { ok: boolean; reason: string } {
  const a = airline.toUpperCase(), al = SLA_T.ALIAS[a];
  const c = SLA_T.SUPOK[a] || (al ? SLA_T.SUPOK[al] : undefined);
  if (!c) return { ok: true, reason: "" };
  if (!c.length) return { ok: false, reason: "ไม่รับซัพพอร์ต (ใช้คนทีมตัวเอง)" };
  if (c.indexOf(ph) < 0) return { ok: false, reason: "รับซัพพอร์ตเฉพาะ " + c.filter(x => x !== "SUP").join("/") };
  return { ok: true, reason: "" };
}
function hoursStat(r: AcRec): { level: string; txt: string } {
  let sh = Math.round((r.hrs || 0) * 10) / 10; const o = Math.round(r.ot * 10) / 10; let total: number;
  if (r.bucket === "OT_OFF") { sh = 0; total = o; } else total = Math.round((sh + o) * 10) / 10;
  let level = "ok", txt = "";
  if (sh > 0 && sh < WH_SHIFT_MIN) { level = "short"; txt = "กะ " + sh + "ช <" + WH_SHIFT_MIN; }
  else if (sh > WH_SHIFT_MAX) { level = "over"; txt = "กะ " + sh + "ช >" + WH_SHIFT_MAX; }
  let contig = total;
  if (r.ss != null) {
    const iv: number[][] = [];
    if ((r.hrs || 0) > 0) iv.push([r.ss, r.ss + (r.hrs || 0) * 60]);
    for (const sp of r.otSpans) if (sp.a != null && sp.b != null) { let b = sp.b; if (b <= sp.a) b += 1440; iv.push([sp.a, b]); }
    if (!iv.length) contig = 0;
    else {
      iv.sort((x, y) => x[0] - y[0]);
      let maxLen = 0, a = iv[0][0], b = iv[0][1];
      for (let i = 1; i < iv.length; i++) { if (iv[i][0] <= b + 30) b = Math.max(b, iv[i][1]); else { if (b - a > maxLen) maxLen = b - a; a = iv[i][0]; b = iv[i][1]; } }
      if (b - a > maxLen) maxLen = b - a;
      contig = Math.round(maxLen / 60 * 10) / 10;
    }
  }
  if (contig > WH_DAY_HIGH) { level = "high"; txt = "ต่อเนื่อง " + contig + "ช (พักไม่พอ)"; }
  return { level, txt };
}
function phaseWinFull(airline: string, STA: string, STD: string, ph: string): number[] | null {
  const c = airline.toUpperCase(), al = SLA_T.ALIAS[c];
  const w = SLA_T.WIN[c] || (al ? SLA_T.WIN[al] : undefined) || SLA_T.WIN.DEFAULT;
  const std = realMin(STD), sta = realMin(STA), post = w[2];
  if (ph === "CI") return std != null ? [std + w[0], std + w[1]] : null;
  if (ph === "GATE") { const gs = sta != null ? sta - 30 : (std != null ? std - 90 : null); const ge = std != null ? std + post : (sta != null ? sta + post : null); return gs != null && ge != null ? [gs, ge] : null; }
  if (ph === "ARR") { const as = sta != null ? sta - 30 : null; const ae = std != null ? std + post : (sta != null ? sta + post : null); return as != null && ae != null ? [as, ae] : null; }
  if (ph === "SUP") return std != null ? [std + w[0], std + post] : (sta != null ? [sta - 20, sta + post] : null);
  return null;
}
function phaseWinFb(airline: string, STA: string, STD: string, ph: string): { win: number[] | null; fb: boolean; noTime: boolean } {
  const w = phaseWinFull(airline, STA, STD, ph); if (w) return { win: w, fb: false, noTime: false };
  const std = realMin(STD), sta = realMin(STA); let lo: number | null = null, hi: number | null = null;
  if (std != null && sta != null) { lo = Math.min(sta, std) - 30; hi = Math.max(sta, std) + 30; }
  else if (std != null) { lo = std - 180; hi = std + 30; }
  else if (sta != null) { lo = sta - 30; hi = sta + 120; }
  if (lo != null && hi != null) return { win: [lo, hi], fb: true, noTime: false };
  return { win: null, fb: false, noTime: true };
}
function transitBuf(busy: number[][], winStart: number): number {
  const prior = busy.filter(b => b[1] <= winStart + 10).sort((a, b) => b[1] - a[1]);
  let n = 0, ref = winStart;
  for (const b of prior) { if (ref - b[1] <= SLA_REST_MIN) { n++; ref = b[0]; } else break; }
  return n >= 2 ? SLA_REST_MIN : SLA_TRANSIT_MIN;
}
function freeIn(p: PoolP, win: number[]): boolean {
  if (!(p.ds <= win[0] + 30 && p.de >= win[1] - 30)) return false;
  const buf = transitBuf(p.busy, win[0]);
  for (const b of p.busy) if (win[0] < b[1] + buf && win[1] > b[0] - buf) return false;
  for (const h of p.hold) if (win[0] < h[1] + buf && win[1] > h[0] - buf) return false;
  return true;
}
function supportPool(recs: AcRec[], pg: { [e: string]: string }): PoolP[] {
  const sys: { [t: string]: { [s: string]: boolean } } = {};
  for (const r of recs) for (const a of r.asg) {
    if (!isFlightName(a.flight) || phasesOf(a.task).indexOf("CI") < 0) continue;
    const s = sysOf(airlineOf(a.flight)); if (s) (sys[r.team] = sys[r.team] || {})[sysNorm(s)] = true;
  }
  for (const r of recs) if (/CHARTER|\bZF\b/i.test(r.team)) (sys[r.team] = sys[r.team] || {}).astra = true;
  const pool: PoolP[] = [];
  for (const r of recs) {
    if (skipTeam(r.team)) continue;
    const d = acDuty(r);
    if (d.ds == null || d.de == null) continue;
    const busy: number[][] = []; for (const a of r.asg) { const w = acFlightWin(a); if (w) busy.push(w); }
    const flts = r.asg.filter(a => isFlightName(a.flight)).map(a => {
      const w = acFlightWin(a);
      return a.flight + (w ? " " + fmtMin(w[0]) + "-" + fmtMin(w[1]) : ((a.STA || a.STD) ? " " + (a.STA || "–") + "-" + (a.STD || "–") : ((a.OP || a.CL) ? " " + (a.OP || "–") + "-" + (a.CL || "–") : "")));
    });
    const otoff = r.bucket === "OT_OFF", hs = hoursStat(r);
    const st = r.ss != null && r.se != null ? fmtMin(r.ss) + "-" + fmtMin(r.se) : "";
    pool.push({ name: r.name, emp: r.emp || "", team: r.team, posGroup: pg[r.emp || ""] || "", off: false, otoff, rest: otoff, float: isFloatTeam(r.team),
      ds: d.ds, de: d.de, busy, hold: [], sys: sys[r.team] || {}, nflt: flts.length,
      shiftDisp: otoff ? "OFF (มา OT)" : (st && st !== r.shiftCode ? (r.shiftCode ? r.shiftCode + " " + st : st) : (r.shiftCode || st || "-")),
      otDisp: r.ot > 0 ? r.ot + "h " + (otoff ? "OFF" : (r.otType === "PRE" ? "ก่อนกะ" : "หลังกะ")) + (r.otTime ? " " + r.otTime : "") : "-",
      hrs: Math.round(((r.hrs || 0) + r.ot) * 10) / 10, hlevel: hs.level, htxt: hs.txt, flts, plan: 0 });
  }
  return pool;
}
function candidates(f: SlaFlight, ph: string, pool: PoolP[], max: number, win: number[]): PoolP[] {
  if (ph === "CI" && SLA_T.CIINTEAM.indexOf(f.airline.toUpperCase()) >= 0) return [];
  const nn = needSys(f.airline, ph) ? sysNorm(needSys(f.airline, ph)) : "";
  const c = pool.filter(p => !f.teams[p.team] && !(nn && !p.sys[nn]) && !(ph === "SUP" && p.posGroup !== "PSS" && p.posGroup !== "SNR") && freeIn(p, win));
  const ovh = (x: PoolP) => x.hlevel === "over" || x.hlevel === "high" ? 1 : 0, rst = (x: PoolP) => x.rest ? 1 : 0;
  const fit = (x: PoolP) => Math.max(0, win[0] - x.ds) + Math.max(0, x.de - win[1]);
  const astra = ph === "CI" && nn === "astra", chF = (x: PoolP) => astra && /CHARTER|\bZF\b/i.test(x.team) ? 0 : 1;
  const PRI: { [k: string]: number } = { PSA: 0, SNR: 1, PSS: 2 }, pri = (x: PoolP) => PRI[x.posGroup] == null ? 3 : PRI[x.posGroup];
  const tc = (a: string, b: string) => a.localeCompare(b);
  c.sort((a, b) => rst(a) - rst(b) || (a.off ? 1 : 0) - (b.off ? 1 : 0) || ovh(a) - ovh(b) || chF(a) - chF(b) || fit(a) - fit(b) || a.nflt - b.nflt ||
    (ph === "SUP" ? (a.posGroup === "PSS" ? 0 : 1) - (b.posGroup === "PSS" ? 0 : 1) : pri(a) - pri(b)) || (a.float ? 0 : 1) - (b.float ? 0 : 1) || tc(a.team, b.team));
  return max ? c.slice(0, max) : c;
}
function otherCands(f: SlaFlight, ph: string, pool: PoolP[], max: number, exclude: string[], win: number[]): PoolP[] {
  if (ph === "CI" && SLA_T.CIINTEAM.indexOf(f.airline.toUpperCase()) >= 0) return [];
  const ex: { [n: string]: boolean } = {}; for (const n of exclude) ex[n] = true;
  const c = pool.filter(p => !ex[p.name] && !f.teams[p.team] && freeIn(p, win));
  const PRI: { [k: string]: number } = { PSA: 0, SNR: 1, PSS: 2 }, pri = (x: PoolP) => PRI[x.posGroup] == null ? 3 : PRI[x.posGroup];
  const fit = (x: PoolP) => Math.max(0, win[0] - x.ds) + Math.max(0, x.de - win[1]);
  c.sort((a, b) => (a.rest ? 1 : 0) - (b.rest ? 1 : 0) || (a.off ? 1 : 0) - (b.off ? 1 : 0) || fit(a) - fit(b) || a.nflt - b.nflt || pri(a) - pri(b) || (a.float ? 0 : 1) - (b.float ? 0 : 1));
  return max ? c.slice(0, max) : c;
}
function candView(c: PoolP): (string | number | boolean)[] {
  const pos = c.posGroup === "PSS" ? "Sup" : c.posGroup === "SNR" ? "Snr" : c.posGroup === "PSA" ? "Agent" : (c.posGroup || "-");
  return [c.name, pos, c.team, c.off, c.rest, c.shiftDisp, c.otDisp, c.hrs, c.hlevel, c.htxt, c.nflt, c.flts.join(" · ")];
}
function supportRows(day: string, flights: SlaFlight[], recs: AcRec[], pg: { [e: string]: string }): SupportRow[] {
  const pool = supportPool(recs, pg), out: SupportRow[] = [];
  const LB: { [k: string]: string } = { SUP: "SUP", CI: "Check-in", GATE: "Gate", ARR: "Arrival" };
  for (const f of flights) {
    if (f.ok || f.noTime) continue;
    for (const ph of ["SUP", "CI", "GATE", "ARR"]) {
      const n = f.short[ph]; if (!n) continue;
      const elig = canSupport(f.airline, ph), fbw = phaseWinFb(f.airline, f.STA, f.STD, ph), rwin = fbw.win;
      const cands = elig.ok && rwin ? candidates(f, ph, pool, SLA_MAX_CAND, rwin) : [];
      if (rwin) for (const c of cands.slice(0, n)) c.hold.push(rwin);
      const others = elig.ok && rwin ? otherCands(f, ph, pool, SLA_MAX_CAND, cands.map(c => c.name), rwin) : [];
      const picks = cands.slice(0, n).map(c => c.name + " / " + c.team);
      out.push({ Title: day + "|" + f.key + "|" + ph, day_key: day, month_key: day.slice(0, 7), flight: f.flight, airline: f.airline, system: sysOf(f.airline),
        team: f.teamList, std: f.STD || f.STA || "", phase: LB[ph], short_n: n, win: rwin ? fmtMin(rwin[0]) + "-" + fmtMin(rwin[1]) : "",
        win_fb: fbw.fb, no_flight_time: fbw.noTime, need_sys: needSys(f.airline, ph), block: elig.ok ? "" : elig.reason, n_cand: cands.length,
        picks: picks.join("\n"), cands_json: JSON.stringify(cands.map(candView)), others_json: JSON.stringify(others.map(candView)) });
    }
  }
  return out;
}
// ======================= Auto Assign (พอร์ตจาก AutoPlan.gs · apFillGaps_ / apReplan_) =======================
// FILL = เติมจาก Assign เดิม (คนว่างข้ามทีมมาเสริมไฟลท์ที่ขาด) · AUTO = จัดเวรใหม่ทั้งหมดตาม SLA · SUM = จำนวนคนในแผน AUTO · BENCH = คนพัก/สำรองในแผน AUTO
// (common check-in ของเดิมปิดอยู่ — AP_COMMON_CI = [] — จึงไม่พอร์ต)
const AP_TOL = 30, AP_PHASES = ["SUP", "CI", "ARR", "GATE"];
const AP_LB: { [k: string]: string } = { SUP: "SUP", CI: "Check-in", GATE: "Gate", ARR: "Arrival" };
interface ApRow { Title: string; day_key: string; month_key: string; kind: string; flight: string; airline: string; system: string; team: string; sta: string; std: string; seq: number;
  phase?: string; need_n?: number; base_n?: number; remain?: number; win?: string; need_sys?: string; block?: string; people_json?: string;
  req_sup?: number; req_ci?: number; req_gate?: number; req_arr?: number; short_sup?: number; short_ci?: number; short_gate?: number; short_arr?: number;
  sup_json?: string; ci_json?: string; gate_json?: string; arr_json?: string; tot_req?: number; tot_asg?: number; ok?: boolean;
  person?: string; pos?: string; shift?: string }
function apFree(p: PoolP, win: number[] | null): boolean {
  if (!win) return true;
  if (!(p.ds <= win[0] + AP_TOL && p.de >= win[1] - AP_TOL)) return false;
  const buf = transitBuf(p.busy, win[0]);
  for (const b of p.busy) if (win[0] < b[1] + buf && win[1] > b[0] - buf) return false;
  return true;
}
function apEligible(p: PoolP, f: SlaFlight, ph: string, win: number[] | null, sameTeamOk: boolean): boolean {
  const own = !!f.teams[p.team];
  if (!sameTeamOk && own) return false;                                   // โหมดเติม = ข้ามทีมเท่านั้น
  if (!sameTeamOk && !win) return false;                                  // ไม่มีเวลาไฟลท์ → ไม่เสนอคนข้ามทีม
  if (!own && !canSupport(f.airline, ph).ok) return false;                // สาย/เฟสนี้ไม่รับคนข้ามทีม
  const ns = needSys(f.airline, ph);
  if (ns && !p.sys[sysNorm(ns)]) return false;                            // CI/SUP ต้องรู้ระบบ (ยกเว้น iPort)
  if (ph === "SUP" && p.posGroup !== "PSS") return false;
  return apFree(p, win);
}
function apScore(p: PoolP, ph: string, home: string): number {
  let s = 0;
  if (ph === "SUP") s += p.posGroup === "PSS" ? 0 : 6;
  else if (ph === "CI") s += p.posGroup === "PSA" ? 0 : (p.posGroup === "SNR" ? 1 : 3);
  else s += p.posGroup === "PSA" ? 0 : (p.posGroup === "SNR" ? 1 : 2);
  if (home && p.team === home) s -= 3;
  return s + p.plan * 2;
}
function apPick(pool: PoolP[], f: SlaFlight, ph: string, win: number[] | null, sameTeamOk: boolean, home: string): PoolP | null {
  let best: PoolP | null = null, bs = 1e9;
  for (const p of pool) { if (!apEligible(p, f, ph, win, sameTeamOk)) continue; const sc = apScore(p, ph, home); if (sc < bs) { bs = sc; best = p; } }
  if (best) { if (win && ph !== "SUP") best.busy.push([win[0], win[1]]); best.plan++; }   // SUP คุมหลายไฟลท์ได้ → ไม่ล็อกเวลา
  return best;
}
function posShort(g: string): string { return g === "PSS" ? "Sup" : g === "SNR" ? "Snr" : g === "PSA" ? "Agent" : (g || "-"); }
// [ชื่อ, ตำแหน่ง, ทีม, กะ, OT, ชม.รวม, จำนวนงานเดิม, ไฟลท์เดิม]
function apView(p: PoolP): (string | number)[] { return [p.name, posShort(p.posGroup), p.team, p.shiftDisp, p.otDisp, p.hrs, p.nflt, p.flts.join(" · ")]; }
function apFillGaps(flights: SlaFlight[], pool: PoolP[]): ApRow[] {
  const out: ApRow[] = [];
  for (const f of flights) {
    if (f.ok) continue;
    for (const ph of AP_PHASES) {
      const need = f.short[ph] || 0; if (!need) continue;
      const sup = canSupport(f.airline, ph), win = phaseWinFull(f.airline, f.STA, f.STD, ph);
      const picked: PoolP[] = [];
      if (sup.ok) for (let k = 0; k < need; k++) { const p = apPick(pool, f, ph, win, false, ""); if (!p) break; picked.push(p); }
      out.push({ Title: "", day_key: "", month_key: "", kind: "FILL", flight: f.flight, airline: f.airline, system: sysOf(f.airline), team: f.teamList,
        sta: f.STA, std: f.STD || f.STA || "", seq: 0, phase: AP_LB[ph], need_n: need, base_n: need, remain: need - picked.length,
        win: win ? fmtMin(win[0]) + "-" + fmtMin(win[1]) : "", need_sys: needSys(f.airline, ph), block: sup.ok ? "" : sup.reason,
        people_json: JSON.stringify(picked.map(apView)) });
    }
  }
  return out;
}
function apReplan(flights: SlaFlight[], pool: PoolP[], owner: { [al: string]: string }): ApRow[] {
  for (const p of pool) { p.busy = []; p.plan = 0; }                     // จัดใหม่ → ล้างงานเดิมทั้งหมด
  const out: ApRow[] = [];
  for (const f of flights) {
    const home = owner[f.airline] || (f.teamList || "").split(",")[0] || "";
    const pr: { [k: string]: number } = { SUP: f.req.SUP, CI: f.req.CI, ARR: f.req.ARR, GATE: f.req.GATE };
    const extra = Math.max(0, (f.req.total || 0) - (f.req.SUP + f.req.CI + f.req.ARR + f.req.GATE));
    if (f.req.CI === 0) pr.GATE += extra;                                 // สายไม่มีเช็คอิน (PG) → ส่วนเกิน = Gate agent
    if (!AP_PHASES.some(ph => pr[ph] > 0)) continue;
    const asg: { [k: string]: PoolP[] } = { SUP: [], CI: [], ARR: [], GATE: [] }, sx: { [k: string]: number } = {};
    for (const ph of AP_PHASES) {
      if (!pr[ph]) continue;
      const win = phaseWinFull(f.airline, f.STA, f.STD, ph);
      for (let k = 0; k < pr[ph]; k++) {
        if (ph === "GATE" && f.req.CI > 0 && asg.CI[k]) { asg.GATE.push(asg.CI[k]); continue; }   // คนเช็คอินเดินต่อไปเกท
        const p = apPick(pool, f, ph, win, true, home);
        if (p) asg[ph].push(p); else { sx[ph] = pr[ph] - k; break; }
      }
    }
    const js = (a: PoolP[]) => JSON.stringify(a.map(apView));
    out.push({ Title: "", day_key: "", month_key: "", kind: "AUTO", flight: f.flight, airline: f.airline, system: sysOf(f.airline), team: home,
      sta: f.STA, std: f.STD, seq: 0, req_sup: pr.SUP, req_ci: pr.CI, req_gate: pr.GATE, req_arr: pr.ARR,
      short_sup: sx.SUP || 0, short_ci: sx.CI || 0, short_gate: sx.GATE || 0, short_arr: sx.ARR || 0,
      sup_json: js(asg.SUP), ci_json: js(asg.CI), gate_json: js(asg.GATE), arr_json: js(asg.ARR),
      tot_req: pr.SUP + pr.CI + pr.ARR + pr.GATE, tot_asg: asg.SUP.length + asg.CI.length + asg.ARR.length + asg.GATE.length, ok: Object.keys(sx).length === 0 });
  }
  const nAsg = pool.filter(p => p.plan > 0).length;
  out.push({ Title: "", day_key: "", month_key: "", kind: "SUM", flight: "", airline: "", system: "", team: "", sta: "", std: "", seq: 0, tot_req: pool.length, tot_asg: nAsg });   // คนทั้งพูล / คนที่ถูกจัด
  for (const p of pool) if (p.plan === 0)
    out.push({ Title: "", day_key: "", month_key: "", kind: "BENCH", flight: "", airline: "", system: "", team: p.team, sta: "", std: "", seq: 0,
      person: p.name, pos: posShort(p.posGroup), shift: p.shiftDisp });
  return out;
}
function autoPlanRows(day: string, flights: SlaFlight[], recs: AcRec[], pg: { [e: string]: string }): ApRow[] {
  const rows = apFillGaps(flights, supportPool(recs, pg)).concat(apReplan(flights, supportPool(recs, pg), acOwnerTeams(recs)));
  rows.forEach((r, i) => { r.seq = i + 1; r.Title = day + "|" + r.kind + "|" + (i + 1); r.day_key = day; r.month_key = day.slice(0, 7); });
  return rows;
}

// ======================= จัดล่วงหน้า (พอร์ตจาก AdvancePlan.gs · advPlan_) =======================
// ใช้ในสคริปต์ import-advroster.ts (สร้างจากไฟล์นี้ด้วย build.js — แก้ที่นี่ที่เดียว)
// พูลคน = ROSTER ล่วงหน้า (บล็อกหน้างาน: TIME|CODE ต่อวัน) · ไฟลท์ = PAS_Flights · ทีม/ตำแหน่ง/สถานะ = PAS_Employees
const SLA_ROLES_T: { [a: string]: number[] } = {"3K":[1,1,4,1,0,1,3,1,0,8],"3U":[1,1,4,1,0,1,4,1,0,8],"6B":[1,1,5,2,0,1,4,1,0,10],"6E":[1,1,5,1,0,1,4,1,1,9],"8L":[1,1,4,1,0,1,4,1,0,8],"8M":[1,1,3,1,0,1,4,1,0,7],"9C":[1,1,5,1,0,1,4,1,0,9],"9H":[1,1,4,1,0,1,4,1,0,8],"AF":[1,1,9,1,0,1,4,1,0,13],"AI":[1,0,6,1,0,1,4,1,0,9],"AK":[1,1,4,1,0,1,3,1,0,8],"AQ":[1,1,3,1,0,1,4,1,0,7],"AY":[1,1,5,1,0,1,4,1,0,9],"B2":[1,1,6,1,0,1,4,1,0,10],"BY":[1,1,5,2,0,1,4,1,0,10],"C6":[1,1,4,1,0,1,3,1,0,8],"CA":[1,1,6,1,0,1,4,1,0,10],"CX":[1,1,6,2,0,1,5,1,0,11],"CZ":[1,1,6,1,0,1,4,1,0,10],"DE":[1,1,6,2,0,1,5,1,0,11],"DK":[1,1,4,1,0,1,4,1,0,8],"DV":[1,1,4,1,0,1,4,1,0,8],"EK":[1,1,7,4,0,1,4,1,0,14],"EO":[1,1,6,1,0,1,5,1,0,10],"EY":[1,1,7,1,1,1,5,1,0,12],"FM":[1,1,4,1,0,1,4,1,0,8],"FY":[1,0,3,1,0,1,3,1,0,6],"G2":[1,1,6,1,0,1,4,1,0,10],"G8":[1,1,4,1,0,1,3,1,0,8],"G9":[1,1,4,1,0,1,3,1,0,8],"H4":[1,1,5,1,0,1,4,1,0,9],"HB":[1,1,3,1,0,1,3,1,0,7],"HH":[1,1,4,1,0,1,4,1,0,8],"HO":[1,1,4,1,0,1,4,1,0,8],"HU":[1,1,6,1,0,1,4,1,0,10],"HX":[1,1,5,1,0,1,4,1,0,9],"HY":[1,0,5,1,0,1,4,1,0,8],"IT":[1,0,4,1,0,1,3,1,0,7],"IX":[1,0,4,1,0,1,3,1,0,7],"JQ":[1,0,7,1,0,1,7,2,0,10],"KC":[1,1,5,1,0,1,3,1,0,9],"KE":[1,0,8,1,0,1,3,1,0,11],"KY":[1,1,3,1,0,1,4,1,0,7],"LJ":[1,1,4,1,0,1,3,1,0,8],"LO":[1,1,6,1,0,1,4,1,0,10],"LY":[1,1,7,4,0,1,8,1,0,14],"MH":[1,1,4,1,0,1,3,1,0,8],"MU":[1,1,4,1,0,1,4,1,0,8],"N0":[1,1,5,1,0,1,4,1,0,9],"N4":[1,1,6,1,0,1,5,1,0,10],"NO":[1,1,6,1,0,1,5,1,0,10],"OD":[1,0,4,1,0,1,4,1,0,7],"OM":[1,1,4,1,0,1,4,1,0,8],"OQ":[1,1,4,1,0,1,4,1,0,8],"OV":[1,1,4,1,0,1,3,1,0,8],"OZ":[1,1,6,1,0,1,4,1,0,10],"PG":[1,0,0,1,0,2,4,0,0,8],"PN":[1,1,4,1,0,1,4,1,0,8],"QP":[1,1,5,1,0,1,4,1,0,9],"QR":[1,1,11,3,0,1,5,1,0,17],"QZ":[1,1,4,1,0,1,3,1,0,8],"S7":[1,1,4,1,0,1,4,1,0,8],"SG":[1,0,4,1,0,1,4,1,0,7],"SQ":[1,1,4,1,0,1,4,1,0,8],"SU":[1,1,8,1,0,1,5,1,0,12],"SV":[1,1,7,2,0,1,5,1,0,12],"TK":[1,1,8,4,0,1,4,1,0,15],"TR":[1,1,5,1,1,1,5,1,0,10],"U6":[1,1,4,1,0,1,4,1,0,8],"UO":[1,0,4,2,0,1,2,1,0,8],"VJ":[1,1,4,1,0,1,4,1,0,8],"VN":[1,0,7,1,0,1,5,1,0,10],"W5":[1,1,7,2,0,1,5,1,0,12],"WK":[1,1,6,2,0,1,4,1,0,11],"WY":[2,0,7,1,0,1,5,1,0,11],"WZ":[1,1,6,1,0,1,5,1,0,10],"ZF":[1,1,6,1,0,1,4,1,0,10],"ZH":[1,1,4,1,0,1,4,1,0,8]};
const ADV_TEAMS: { name: string; airlines: string[]; sys?: string[] }[] = [
  { name: "JQ", airlines: ["AI", "IX", "JQ", "IT"] }, { name: "AK", airlines: ["AK", "QZ", "8M"] }, { name: "SQ", airlines: ["SQ", "CX", "LY"] },
  { name: "ZF", airlines: ["ZF", "LO", "HH", "EO", "N4", "G2", "H4", "S7", "C6", "WZ", "HB"] }, { name: "EK", airlines: ["UO", "EK", "FY", "6B", "BY"] },
  { name: "QR", airlines: ["QR", "MH", "DE", "OM"] }, { name: "CHN", airlines: ["CA", "3U", "MU", "FM", "HU", "HO", "HX", "AQ", "CZ", "ZH", "PN", "9H", "OQ", "BK", "GX"] },
  { name: "KE", airlines: ["KC", "KE", "OZ", "NO", "AF", "LJ", "OV"] }, { name: "PVT", airlines: [], sys: ["Gonow", "ASTRA", "TWD", "iPort", "TravelSky", "Angel Lite"] },
  { name: "TR", airlines: ["TR", "6E", "QP", "3K"] }, { name: "PG", airlines: ["PG"] }, { name: "SU", airlines: ["SU", "W5", "B2"] },
  { name: "TK", airlines: ["OD", "VJ", "SG", "HY", "TK", "N0", "VN"] }, { name: "EY", airlines: ["EY", "DV", "AY"] }, { name: "WY/WK", airlines: ["WY", "G9", "9C", "DK", "SV", "WK", "KA"] },
];
const ADV_ROLES: { k: string; lb: string; win: string; sys: boolean; pos: string; sc: string; fromCI?: boolean }[] = [
  { k: "SUP", lb: "SUP", win: "CI", sys: true, pos: "PSS", sc: "SUP" }, { k: "FC", lb: "FC", win: "CI", sys: true, pos: "SNR", sc: "SUP" },
  { k: "CI", lb: "Check-in", win: "CI", sys: true, pos: "", sc: "CI" }, { k: "ARR", lb: "Arrival", win: "ARR", sys: false, pos: "", sc: "ARR" },
  { k: "STB", lb: "Standby", win: "", sys: false, pos: "", sc: "ARR" }, { k: "GM", lb: "Gate Monitor", win: "GATE", sys: false, pos: "", sc: "GATE" },
  { k: "GA", lb: "Gate Agent", win: "GATE", sys: false, pos: "", sc: "GATE", fromCI: true },
];
const AP_OT_MAX = 240;
interface AdvP extends PoolP { id: string; teamIdx: number }
interface AdvEmp { team: string; pos: string; name: string; active: boolean }
interface AdvFront { id: string; name: string; pos: string; team: string; range: string; off: boolean }
interface AdvFlt { flight: string; airline: string; STA: string; STD: string; AC: string; system: string; home: { [i: number]: boolean }; teamName: string; roles: { [k: string]: number } }
interface AdvPlanRow { Title: string; day_key: string; month_key: string; kind: string; seq: number; flight: string; airline: string; system: string; team: string; sta: string; std: string; counter: string;
  [k: string]: string | number | boolean }
interface AdvRosRow { Title: string; day_key: string; month_key: string; emp_code: string; emp_name: string; pos: string; team: string; shift: string; ds_min: number; de_min: number; n_jobs: number; jobs: string }

function advTeamIdxOf(teamStr: string): number {
  const t = teamStr.toUpperCase();
  if (/\bVIP\b|PRIVATE|\bPVT\b|\bLP\b/.test(t)) return ADV_TEAMS.findIndex(x => x.name === "PVT");
  const as = t.split(/[\/,\s]+/).filter(a => a.length >= 2 && a.length <= 3 && /[A-Z]/.test(a));
  let best = -1, bestN = 0;
  ADV_TEAMS.forEach((tm, i) => { let n = 0; for (const a of as) if (tm.airlines.indexOf(a) >= 0) n++; if (n > bestN) { bestN = n; best = i; } });
  return best;
}
function advAirlineTeams(airline: string): number[] { const out: number[] = []; ADV_TEAMS.forEach((t, i) => { if (t.airlines.indexOf(airline) >= 0) out.push(i); }); return out; }
function posGroupOf(pos: string): string {
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
function rangeStr(s: string): (number | null)[] {
  const m = s.match(/(\d{1,2}):?(\d{2})?\s*[-–]\s*(\d{1,2}):?(\d{2})?/);
  return m ? [(+m[1]) * 60 + (m[2] ? +m[2] : 0), (+m[3]) * 60 + (m[4] ? +m[4] : 0)] : [null, null];
}
// ---- ROSTER บล็อกหน้างาน: แถวหัว = คอลัมน์ "…TIME" ตามด้วย "…CODE" (เลขวันในหัวหรือแถวเหนือ) · แถวคน = ID 6–8 หลักที่คอลัมน์ C ----
const ADV_EN_MON: { [m: string]: number } = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
function advHdrDay(s: string): number | null { const m = s.match(/\d{1,2}/); return m ? +m[0] : null; }
function advBlockAirlines(s: string): string[] {
  const m = s.match(/\d{4}\s*\/?\s*(.+)$/);
  const tail = (m ? m[1] : s).replace(/\/(NO|POS|ID|NAME)\s*$/i, "");
  return (tail.match(/[A-Z0-9]{2,3}/g) || []).filter(c => !/^\d+$/.test(c));
}
function advScanFrontline(data: string[][], m: number, d: number, out: AdvFront[]) {
  let cur: { timeCol: number; airlines: string[] } | null = null;
  for (let i = 0; i < data.length; i++) {
    const row = data[i].map(x => String(x == null ? "" : x).trim());
    const timeCols: number[] = [];
    for (let c = 0; c < row.length; c++) if (/(^|\/)TIME$/i.test(row[c]) && /(^|\/)CODE$/i.test(row[c + 1] || "")) timeCols.push(c);
    if (timeCols.length) {
      let title = "";
      for (let t = 0; t < Math.min(6, row.length); t++) if (/\d{4}/.test(row[t])) { title = row[t]; break; }
      const mm = title.match(/[A-Za-z]{3,}/), blkMon = mm ? ADV_EN_MON[mm[0].slice(0, 3).toUpperCase()] : undefined;
      cur = null;
      if (blkMon == null || blkMon === m) {
        for (const col of timeCols) {
          let day = advHdrDay(row[col]);
          for (let up = 1; up <= 3 && day == null; up++) if (i - up >= 0) day = advHdrDay(String(data[i - up][col] == null ? "" : data[i - up][col]));
          if (day === d) { cur = { timeCol: col, airlines: advBlockAirlines(title) }; break; }
        }
      }
      continue;
    }
    if (!cur) continue;
    const id = (row[2] || "").replace(/\D/g, "");
    if (id.length < 6 || id.length > 8) continue;
    const rng = row[cur.timeCol] || "";
    out.push({ id, name: ((row[3] || "") + " " + (row[4] || "")).trim(), pos: row[1] || "", team: cur.airlines.join("/"), range: rng,
      off: /^(OFF|X|VL|SL|VAC|ลา|พักร้อน)/i.test(rng) || !rng || /^\s*-\s*$/.test(rng) });
  }
}
function advBuildPool(front: AdvFront[], emp: { [id: string]: AdvEmp }): AdvP[] {
  const pool: AdvP[] = [], seen: { [id: string]: boolean } = {};
  for (const p of front) {
    if (p.off || seen[p.id]) continue;
    const rr = rangeStr(p.range); if (rr[0] == null || rr[1] == null) continue;
    const ds = rr[0]; let de = rr[1]; if (de <= ds) de += 1440;
    const e: AdvEmp | undefined = emp[p.id];
    if (e && e.active === false) continue;
    seen[p.id] = true;
    const tstr = (e && e.team) || p.team || "", ti = advTeamIdxOf(tstr);
    const airlines = ti >= 0 ? ADV_TEAMS[ti].airlines : [], sys: { [s: string]: boolean } = {};
    for (const a of airlines) { const s = sysOf(a); if (s) sys[sysNorm(s)] = true; }
    if (ti >= 0) for (const s of ADV_TEAMS[ti].sys || []) sys[sysNorm(s)] = true;
    const pos = p.pos || (e ? e.pos : "") || "";
    pool.push({ id: p.id, emp: p.id, name: (e && e.name) || p.name, team: ti >= 0 ? ADV_TEAMS[ti].name : (tstr.toUpperCase() || "-"), teamIdx: ti, posGroup: posGroupOf(pos),
      off: false, otoff: false, rest: false, float: false, ds, de, busy: [], hold: [], sys, nflt: 0, plan: 0,
      shiftDisp: fmtMin(ds) + "-" + fmtMin(de), otDisp: "-", hrs: Math.round((de - ds) / 6) / 10, hlevel: "ok", htxt: "", flts: [] });
  }
  return pool;
}
function slaRoles(airline: string, ac: string, rules: { [a: string]: number[] }): { [k: string]: number } {
  const c = airline.toUpperCase(), al = SLA_T.ALIAS[c], r = SLA_ROLES_T[c] || (al ? SLA_ROLES_T[al] : undefined);
  if (!r) { const q = slaReq(airline, ac, rules); return { SUP: 1, FC: 1, CI: q.CI, ARR: q.ARR, STB: 0, GM: 1, GA: Math.max(0, (q.total || 0) - 4 - q.CI - q.ARR), sep: 0, total: q.total }; }
  const out: { [k: string]: number } = { SUP: r[0], FC: r[1], CI: r[2], ARR: r[3], STB: r[4], GM: r[5], GA: r[6], sep: r[8] ? 1 : 0, total: r[9] };
  if (ac) { const dd = slaReq(airline, ac, rules).CI - slaReq(airline, "", rules).CI; if (dd) { out.CI = Math.max(0, out.CI + dd); out.total = Math.max(0, out.total + dd); } }
  return out;
}
function advPosOK(p: AdvP, rule: string): boolean { return rule === "PSS" ? p.posGroup === "PSS" : rule === "SNR" ? (p.posGroup === "PSS" || p.posGroup === "SNR") : true; }
function advPickSlot(pool: AdvP[], f: AdvFlt, role: { k: string; lb: string; sys: boolean; pos: string; sc: string }, win: number[] | null, used: { [id: string]: boolean }): AdvP | null {
  const ns = role.sys ? needSys(f.airline, "CI") : "", nn = ns ? sysNorm(ns) : "";
  let best: AdvP | null = null, bs = 1e9;
  for (const p of pool) {
    if (used[p.id]) continue;
    if (nn && !p.sys[nn]) continue;
    if (!advPosOK(p, role.pos)) continue;
    if (!apFree(p, win)) continue;
    const sc = apScore(p, role.sc, "") + (f.home[p.teamIdx] ? 0 : 1e6);     // ทีมเจ้าของไฟลท์ก่อน แล้วค่อยข้ามทีม
    if (sc < bs) { bs = sc; best = p; }
  }
  if (best) { if (win) best.busy.push([win[0], win[1]]); best.plan++; best.nflt = best.plan; best.flts.push(f.flight + " " + role.lb); used[best.id] = true; }
  return best;
}
function advOtCands(pool: AdvP[], win: number[] | null, need: number): (string | number)[][] {
  if (!win) return [];
  const lo = win[0], hi = win[1], out: { v: (string | number)[]; ot: number; plan: number }[] = [];
  for (const p of pool) {
    if (p.ds <= lo + AP_TOL && p.de >= hi - AP_TOL) continue;
    if (p.busy.some(b => lo < b[1] && hi > b[0])) continue;
    let ot = 0, kind = "";
    if (p.ds <= lo + AP_TOL && p.de < hi) { ot = hi - p.de; kind = "ต่อหลังกะ"; }
    else if (p.de >= hi - AP_TOL && p.ds > lo) { ot = p.ds - lo; kind = "เข้าก่อนกะ"; }
    else continue;
    if (ot > 0 && ot <= AP_OT_MAX) out.push({ v: [p.name, posShort(p.posGroup), p.team, p.shiftDisp, Math.round(ot / 6) / 10, kind], ot: Math.round(ot / 6) / 10, plan: p.plan });
  }
  out.sort((a, b) => a.ot - b.ot || a.plan - b.plan);
  return out.slice(0, Math.max((need || 1) * 2, 3)).map(x => x.v);
}
interface AdvFltIn { day_key?: string; flight_no?: string; sta?: string; std?: string; aircraft_type?: string; ac_raw?: string; cancelled?: boolean }
/** วางแผน 1 วัน → แถว PAS_AdvPlan (FLIGHT ต่อไฟลท์ + SUM) และ PAS_AdvRoster (คนในพูล + งานที่ได้) */
function advPlanDay(day: string, front: AdvFront[], emp: { [id: string]: AdvEmp }, fl: AdvFltIn[], rules: { [a: string]: number[] }): { plan: AdvPlanRow[]; ros: AdvRosRow[] } {
  const pool = advBuildPool(front, emp);
  const flights: AdvFlt[] = [];
  for (const r of fl) {
    if (r.cancelled) continue;
    const flight = String(r.flight_no || "").replace(/\s+/g, ""); if (!isFlightName(flight)) continue;
    const airline = airlineOf(flight), ac = String(r.aircraft_type || r.ac_raw || ""), home: { [i: number]: boolean } = {};
    const tis = advAirlineTeams(airline); for (const i of tis) home[i] = true;
    flights.push({ flight, airline, STA: String(r.sta || ""), STD: String(r.std || ""), AC: ac, system: sysOf(airline), home, teamName: tis.map(i => ADV_TEAMS[i].name).join(" / "), roles: slaRoles(airline, ac, rules) });
  }
  const cmp = (x: string, y: string) => x < y ? -1 : x > y ? 1 : 0;
  flights.sort((a, b) => cmp(a.STD || a.STA || "zz", b.STD || b.STA || "zz"));
  const planned: { f: AdvFlt; asg: { [k: string]: AdvP[] }; sx: { [k: string]: number }; win: { [k: string]: number[] | null } }[] = [];
  for (const f of flights) {
    const asg: { [k: string]: AdvP[] } = {}, sx: { [k: string]: number } = {}, win: { [k: string]: number[] | null } = {}, used: { [id: string]: boolean } = {};
    for (const role of ADV_ROLES) {
      const need = f.roles[role.k] || 0; asg[role.k] = [];
      if (!need) continue;
      win[role.k] = role.win ? phaseWinFull(f.airline, f.STA, f.STD, role.win) : null;
      if (role.fromCI && !f.roles.sep) {                                 // Gate Agent = คนเช็คอินเดินต่อไปเกท
        asg[role.k] = (asg.CI || []).slice(0, need);
        if (asg[role.k].length < need) sx[role.k] = need - asg[role.k].length;
        continue;
      }
      for (let k = 0; k < need; k++) { const p = advPickSlot(pool, f, role, win[role.k], used); if (p) asg[role.k].push(p); else { sx[role.k] = need - k; break; } }
    }
    planned.push({ f, asg, sx, win });
  }
  const view = (p: AdvP) => [p.name, posShort(p.posGroup), p.team, p.shiftDisp];
  const plan: AdvPlanRow[] = [];
  let nShort = 0;
  for (const x of planned) {
    const f = x.f, ciw = phaseWinFull(f.airline, f.STA, f.STD, "CI");
    const row: AdvPlanRow = { Title: "", day_key: day, month_key: day.slice(0, 7), kind: "FLIGHT", seq: 0, flight: f.flight, airline: f.airline, system: f.system, team: f.teamName,
      sta: f.STA, std: f.STD, counter: ciw ? fmtMin(ciw[0]) + "-" + fmtMin(ciw[1]) : "" };
    const ot: { [k: string]: (string | number)[][] } = {};
    let req = 0, have = 0;
    for (const role of ADV_ROLES) {
      const k = role.k.toLowerCase(), need = f.roles[role.k] || 0;
      row["req_" + k] = need; row["short_" + k] = x.sx[role.k] || 0; row["a_" + k] = JSON.stringify(x.asg[role.k].map(view));
      req += need; have += x.asg[role.k].length;
      if (x.sx[role.k]) ot[role.k] = advOtCands(pool, x.win[role.k] || null, x.sx[role.k]);
    }
    row.tot_req = req; row.tot_asg = have; row.ok = Object.keys(x.sx).length === 0; row.ot_json = JSON.stringify(ot);
    if (!row.ok) nShort++;
    plan.push(row);
  }
  plan.push({ Title: "", day_key: day, month_key: day.slice(0, 7), kind: "SUM", seq: 0, flight: "", airline: "", system: "", team: "", sta: "", std: "", counter: "",
    n_people: pool.length, n_assigned: pool.filter(p => p.plan > 0).length, n_flights: planned.length, n_short: nShort });
  plan.forEach((r, i) => { r.seq = i + 1; r.Title = day + "|" + r.kind + "|" + (i + 1); });
  const ros: AdvRosRow[] = pool.map(p => ({ Title: day + "|" + p.id, day_key: day, month_key: day.slice(0, 7), emp_code: p.id, emp_name: p.name, pos: posShort(p.posGroup), team: p.team,
    shift: p.shiftDisp, ds_min: p.ds, de_min: p.de, n_jobs: p.plan, jobs: p.flts.join(" · ").slice(0, 255) }));
  return { plan, ros };
}
function advEmpMap(json?: string): { [id: string]: AdvEmp } {
  const out: { [id: string]: AdvEmp } = {};
  if (!json) return out;
  const arr: { Title?: string; team?: string; position?: string; name_en?: string; name_th?: string; status?: string }[] = JSON.parse(json);
  for (const r of arr) {
    const id = String(r.Title || "").replace(/\D/g, ""); if (id.length < 6) continue;
    out[id] = { team: String(r.team || ""), pos: String(r.position || ""), name: String(r.name_en || r.name_th || ""), active: !/resign|terminat|inactive|พ้น|ลาออก/i.test(String(r.status || "")) };
  }
  return out;
}
interface AdvResult { status: string; reason: string; from: string; to: string; days: string[]; counts: { [k: string]: number }; batches: Batch[] }
/** main ของ import-advroster.ts: workbook = ไฟล์ ROSTER ล่วงหน้า · fromDay/toDay = ช่วงวัน (YYYY-MM-DD) · flights = PAS_Flights · emps = PAS_Employees */
function main(workbook: ExcelScript.Workbook, fromDay?: string, toDay?: string, flights?: string, emps?: string, rules?: string, siteUrl?: string): AdvResult {
  const from = normDate(fromDay || ""), to = normDate(toDay || "") || from;
  if (!from) return { status: "skipped", reason: "ต้องส่ง fromDay (YYYY-MM-DD)", from, to, days: [], counts: {}, batches: [] };
  const sheets = workbook.getWorksheets().map(ws => { const r = ws.getUsedRange(); return r ? r.getTexts() : []; });
  const emp = advEmpMap(emps), rl = parseRules(rules);
  const fl: AdvFltIn[] = flights ? JSON.parse(flights) : [];
  const byDay: { [d: string]: AdvFltIn[] } = {};
  for (const f of fl) { const d = String(f.day_key || ""); (byDay[d] = byDay[d] || []).push(f); }
  const days: string[] = [];
  for (let t = new Date(from + "T00:00:00Z"); t.getTime() <= new Date(to + "T00:00:00Z").getTime() && days.length < 31; t.setUTCDate(t.getUTCDate() + 1)) days.push(t.toISOString().slice(0, 10));
  let plan: AdvPlanRow[] = [], ros: AdvRosRow[] = [];
  const counts: { [k: string]: number } = { days: days.length, people: 0, flights: 0, short: 0, no_roster: 0, no_flights: 0 };
  for (const d of days) {
    const front: AdvFront[] = [];
    for (const data of sheets) advScanFrontline(data, +d.slice(5, 7), +d.slice(8, 10), front);
    if (!front.length) counts.no_roster++;
    if (!(byDay[d] || []).length) counts.no_flights++;
    const r = advPlanDay(d, front, emp, byDay[d] || [], rl);
    plan = plan.concat(r.plan); ros = ros.concat(r.ros);
    const s = r.plan[r.plan.length - 1]; counts.people += +s.n_people; counts.flights += +s.n_flights; counts.short += +s.n_short;
  }
  const site = (siteUrl || SITE).replace(/\/$/, ""), batches: Batch[] = [];
  addBatches(batches, site, "PAS_AdvPlan", plan);
  addBatches(batches, site, "PAS_AdvRoster", ros);
  return { status: "ok", reason: "", from, to, days, counts, batches };
}

function posGroups(json?: string): { [e: string]: string } {
  const out: { [e: string]: string } = {};
  if (!json) return out;
  const arr: { Title?: string; pos_group?: string }[] = JSON.parse(json);
  for (const r of arr) if (r.Title) out[String(r.Title)] = String(r.pos_group || "");
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
