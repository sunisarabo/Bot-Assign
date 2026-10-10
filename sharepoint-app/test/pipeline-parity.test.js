// ขั้นหลังอ่านไฟล์ (rbLoadResLLraw_): แท็บ COUNTER → เวลาเคาน์เตอร์ + เพดานเช็คอิน · รหัสซ้ำหลายทีม → ต้นสังกัด (master ก่อน)
// · แถวซัพไม่มีทีม → หาจากเวรวันนั้น / รายชื่อพนักงาน — เทียบกับ WebDashboard.gs + LLReader.gs + SLA.gs
const vm = require("vm"), fs = require("fs"), path = require("path");
const M = require(process.argv[2]), X = require("./fakexl.js");
const ROOT = path.join(__dirname, "..", "..");
const W = X.W, blank = () => Array(W).fill("");
const P = o => { const r = blank(); r[0] = o.id == null ? "" : o.id; r[1] = o.pos || "PSA"; r[2] = o.name; r[3] = o.code || ""; r[16] = o.st == null ? "Onduty" : o.st;
  (o.jobs || []).forEach(([i, t]) => r[19 + i * 4] = t); return r; };
const team = (flights, people) => { const top = blank(); top[0] = "TEAM"; top[4] = "10/OCT"; return [top].concat(X.header(flights)).concat(people.map(P)); };
const T = {
  SQ: team([{ code: "SQ726/SQ725", sta: "08:35", std: "09:25" }, { code: "SQ728/727", sta: "10:50", std: "11:40" }], [
    { id: 2100960, pos: "Sup", name: "INDIA", code: "F9", jobs: [[0, "SOD"]] },
    { id: 2101243, name: "BRAVO", code: "E9", jobs: [[0, "C1"], [1, "C1"]] },
    { id: 2101244, name: "CHARLIE", code: "E9", jobs: [[0, "C2"], [1, "C2"]] },
    { id: 2101245, name: "DELTA", code: "E9", jobs: [[0, "C3"]] },
    { id: 2201494, name: "MIKE", code: "", st: "", jobs: [[1, "GA"]] },            // รหัสซ้ำกับ CHARTER (ไม่มีกะที่นี่)
    { id: "", pos: "Support", name: "OSCAR", jobs: [[1, "ARR"]] },                     // ไม่มีทีม → หาจากเวร (CHARTER)
    { id: "", pos: "Support", name: "ROMEO", jobs: [[0, "ARR"]] },                     // ไม่มีในเวร → หาจากรายชื่อพนักงาน (PVTLP)
    { id: "", pos: "Support", name: "ZULU", jobs: [[0, "GA"]] }]),                     // ไม่เจอที่ไหน → เตือน supnoteam
  CHARTER: team([{ code: "N43433/9903", sta: "09:30", std: "12:25" }], [
    { id: 2201494, name: "MIKE", code: "J9", jobs: [[0, "FC"]] },
    { id: 2202073, name: "OSCAR S.", code: "J9" }, { id: 2202074, name: "KILO", code: "F9" }]),
};
const CTR = [["COUNTER CHECK"], ["AIRLINE", "FLIGHT", "NO. OF COUNTER", "OPEN-CLOSE TIME", "DATE"],
  ["SQ", "SQ726", "2", "05:35-08:25", "10/10/2026"], ["", "SQ728", "1", "07:50 - 10:40", "10/10/2026"], ["", "SQ726", "3", "05:30-08:30", "11/10/2026"]];
const MP = [["MANPOWER"], ["Team (SQ)", 8], ["Team (CHARTER)", 3]];
const tabs = Object.assign({ MANPOWER: MP, ShiftDB: X.SHIFTDB, COUNTER: CTR }, T);
const EMPS = [{ Title: "2201494", pos_group: "PSA", name_en: "MIKE M.", name_th: "", team: "CHARTER" }, { Title: "2300001", pos_group: "PSA", name_en: "ROMEO R.", name_th: "", team: "PVTLP" }];
// ---- เดิม ----
const ctx = { Logger: { log() {} }, console, Utilities: { formatDate: d => d.toISOString().slice(0, 10) }, Session: { getScriptTimeZone: () => "Asia/Bangkok" },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) }, CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) } };
vm.createContext(ctx);
for (const f of ["RosterReader.gs", "AssignCheck.gs", "SLA.gs", "AirlineSupport.gs", "WebDashboard.gs", "LLReader.gs"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx);
ctx.manOverride_ = () => null;
const gsheet = (name, rows) => { const Wd = Math.max(...rows.map(r => r.length)); const v = rows.map(r => r.concat(Array(Wd - r.length).fill("")));
  return { getName: () => name, getLastRow: () => v.length, getLastColumn: () => Wd, getDataRange: () => ({ getValues: () => v }),
    getRange: (r, c, nr, nc) => ({ getValues: () => v.slice(r - 1, r - 1 + nr).map(x => x.slice(c - 1, c - 1 + nc)) }) }; };
const ss = { getSheets: () => Object.keys(tabs).map(n => gsheet(n, tabs[n])), getSheetByName: n => tabs[n] ? gsheet(n, tabs[n]) : null };
const res = ctx.readRosterFromSpreadsheet(ss, null);
res.counters = ctx.counterReadFromRoster_(ss, vm.runInContext("new Date(2026, 9, 10)", ctx));
ctx.rbApplyCounterTimes_(res);
ctx.MASTER_FILE_ID_RB = "x";
ctx.rbMasterNameTeam_ = () => { const o = {}; EMPS.forEach(e => { const k = ctx.rbNameKey_(e.name_en); if (k) (o[k] = o[k] || {})[e.team] = 1; }); return o; };
ctx.rbMasterMapping_ = () => ({});
ctx.rbDedupeTeams_(res, null); ctx.rbResolveSupportTeams_(res, null);
// ---- ใหม่ ----
const r = M.main(X.book(tabs), "Shared Documents/2026/10.OCT26/10OCT.xlsx", "", "", "", "", "", "", "", JSON.stringify(EMPS));
const rows = l => r.batches.filter(b => b.list === l).flatMap(b => [...b.body.matchAll(/^\{.*\}$/gm)].map(m => JSON.parse(m[0])));
let bad = 0; const cmp = (lbl, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) bad++; console.log((ok ? "OK " : "XX ") + lbl + (ok ? "" : "\n   เดิม " + JSON.stringify(a) + "\n   ใหม่ " + JSON.stringify(b))); };
const oA = [], nA = rows("PAS_Assignment").map(a => a.team + "|" + a.emp_name + "|" + a.Title + "|" + a.counter_open + "-" + a.counter_close).sort();
Object.keys(res.teams).forEach(t => res.teams[t].records.forEach(x => (x.bucket === "working" || x.bucket === "ot_off" ? x.assignments || [] : []).forEach(a => oA.push(t + "|" + x.name + "|" + a.flight + "|" + (a.OP || "") + "-" + (a.CL || "")))));
cmp("เวลาเคาน์เตอร์จากแท็บ COUNTER (เฉพาะวันที่ 10)", oA.sort(), nA);
const oS = [], nS = rows("PAS_Duty").filter(d => d.is_support).map(d => d.team + "|" + d.emp_name + "|" + d.support_from).sort();
Object.keys(res.teams).forEach(t => res.teams[t].records.forEach(x => { if (x.support) oS.push(t + "|" + x.name + "|" + (x.supportTeam || "")); }));
cmp("แถวซัพ + ทีมต้นสังกัด (ซ้ำหลายทีม · จากเวร · จากรายชื่อพนักงาน)", oS.sort(), nS);
cmp("ที่มาของทีม", ["SQ|MIKE|dup", "SQ|OSCAR|auto", "SQ|ROMEO|master", "SQ|ZULU|"], rows("PAS_Duty").filter(d => d.is_support).map(d => d.team + "|" + d.emp_name + "|" + d.support_src).sort());
cmp("เตือนแถวซัพไม่มีทีม", ["SQ|ZULU"], rows("PAS_DataIssue").filter(i => i.category === "supnoteam").map(i => i.team + "|" + i.who));
const of = ctx.slaCollectFlights_(res, null).map(f => [f.flight, f.req.CI, f.req.total, f.assigned.CI, f.ok]);
const nf = rows("PAS_FlightSLA").map(f => [f.flight, f.req_ci, f.req_total, f.as_ci, f.ok]);
cmp("SLA ตัดเช็คอินตามเคาน์เตอร์ที่ท่าให้", of, nf);
cmp("จำนวนเคาน์เตอร์ต่อไฟลท์", [2, 1, null], rows("PAS_FlightSLA").map(f => f.ctr == null ? null : f.ctr));
// กฎหาคนซัพที่แก้ได้ (PAS_SupportRules / PAS_TeamRules): ค่าตั้งต้นใน List = ผลเดิม · แก้แล้วผลเปลี่ยนตาม
{
  const D = require("../lists.def.json"), seed = t => D.lists.find(l => l.title === t).seed;
  const run = (sr, tr) => M.main(X.book(tabs), "Shared Documents/2026/10.OCT26/10OCT.xlsx", "", "", "", "", "", "", "", JSON.stringify(EMPS), sr && JSON.stringify(sr), tr && JSON.stringify(tr));
  const sup = r2 => r2.batches.filter(b => b.list === "PAS_Support").flatMap(b => [...b.body.matchAll(/^\{.*\}$/gm)].map(m => JSON.parse(m[0])));
  const view = r2 => sup(r2).map(x => [x.source, x.flight, x.phase, x.block, JSON.parse(x.cands_json).map(c => c[0] + "/" + c[2]).join(",")]);
  const base = view(r), withSeed = view(run(seed("PAS_SupportRules"), seed("PAS_TeamRules")));
  cmp("ค่าตั้งต้นใน PAS_SupportRules / PAS_TeamRules ให้ผลเหมือนเดิม", base, withSeed);
  const anyFrom = (v, t) => v.some(x => x[4].split(",").some(c => c.endsWith("/" + t)));
  const tr = seed("PAS_TeamRules").map(x => Object.assign({}, x)).concat([{ Title: "CHARTER", role: "ไม่ดึงมาซัพ", systems: "" }]);
  const noCh = view(run(null, tr));
  cmp("ทีม CHARTER ตั้ง 'ไม่ดึงมาซัพ' → ไม่มีผู้สมัครจาก CHARTER (ก่อนแก้มี)", [anyFrom(base, "CHARTER"), anyFrom(noCh, "CHARTER")], [true, false]);
  const sr = seed("PAS_SupportRules").map(x => x.Title === "SQ" ? Object.assign({}, x, { support: "ไม่รับ" }) : x);
  const noSq = view(run(sr, null)).filter(x => x[0] === "SLA" && /^SQ/.test(x[1]));
  cmp("สาย SQ ตั้ง 'ไม่รับ' → แถว SLA ของ SQ ถูกบล็อก ไม่มีผู้สมัคร", noSq.every(x => !!x[3] && !x[4]) && noSq.length > 0, true);
}
console.log(bad ? bad + " FAILED" : "ALL PASSED (ขั้นหลังอ่านไฟล์ ตรงกับ rbLoadResLLraw_)"); process.exit(bad ? 1 : 0);
