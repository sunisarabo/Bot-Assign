// เทียบ SLA ใหม่ (import-roster.ts computeSla) กับของเดิม (SLA.gs slaCollectFlights_) บนข้อมูลชุดเดียวกัน
const vm = require("vm"), fs = require("fs"), path = require("path");
const { computeSla } = require(process.argv[2]);
const ROOT = path.join(__dirname, "..", "..");
const ctx = { Logger: { log() {} }, console };
vm.createContext(ctx);
for (const f of ["RosterReader.gs", "AssignCheck.gs", "SLA.gs", "WeeklyFlight.gs"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx);
ctx.manOverride_ = () => null;

const m2 = m => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
// ทีม/คน/งาน (ครอบคลุม: ครบ, ขาดหลายเฟส, ขาออกอย่างเดียว, ขาเข้าอย่างเดียว, RON, ไม่มีเวลา, ferry AK, หลายเฟสในคนเดียว, เทรน, Gate↔Arrival เกลี่ย, หัวหน้าเครดิต SUP, ทีมชื่อไม่ตรงสาย)
const P = (team, name, ds, hrs, pss, asg) => ({ team, name, ds, hrs, pss, asg });
const roster = [
  P("EY", "E1", 360, 9, true, []),                                                   // หัวหน้า EY ไม่มีงานไฟลท์ → เครดิต SUP
  ...[1, 2, 3, 4, 5, 6, 7].map(i => P("EY", "EC" + i, 360, 9, false, [["EY410/411", "CT" + i, "08:05", "09:30"]])),
  P("EY", "EG", 360, 9, false, [["EY410/411", "G", "08:05", "09:30"]]),
  P("EY", "EA", 360, 9, false, [["EY410/411", "ARR", "08:05", "09:30"], ["EY412", "CI/GATE", "", "13:00"]]),
  P("QR", "Q1", 600, 9, false, [["QR840", "SUP", "", "23:50"]]),                      // ขาออกอย่างเดียว ขาดหนัก
  P("QR", "Q2", 600, 9, false, [["QR840", "C1", "", "23:50"], ["QR841", "ARR", "21:00", ""]]),   // QR841 ขาเข้าอย่างเดียว
  P("TR", "T1", 300, 9, false, [["TR632", "SUP", "06:00", "06:00"], ["TR632", "CT", "06:00", "06:00"]]),   // RON
  P("TR", "T2", 300, 9, false, [["TR632", "GATE", "06:00", "06:00"], ["TR632", "GATE", "06:00", "06:00"]]),
  P("AKTEAM", "A1", 300, 9, false, [["AK1234", "SUP", "", "07:00"], ["AK830", "TRAINING", "", "09:00"]]),   // ferry + เทรน
  P("SU", "S1", 300, 9, false, [["SU274", "CT", "", ""]]),                             // ไม่มีเวลา
  P("WY", "W1", 300, 9, false, [["WY814", "SUP", "10:00", "11:30"], ["WY814", "C1", "10:00", "11:30"], ["WY814", "C2", "10:00", "11:30"],
    ["WY814", "C3", "10:00", "11:30"], ["WY814", "C4", "10:00", "11:30"], ["WY814", "C5", "10:00", "11:30"], ["WY814", "C6", "10:00", "11:30"],
    ["WY814", "C7", "10:00", "11:30"], ["WY814", "G", "10:00", "11:30"], ["WY814", "G", "10:00", "11:30"], ["WY814", "G", "10:00", "11:30"]]),
  P("PORTER", "PX", 300, 9, false, [["EY410", "WCHR", "08:05", "09:30"]]),             // ทีม Porter ไม่นับ
];
// --- เดิม: res.teams[t].records ---
const res = { teams: {} };
for (const r of roster) {
  const t = res.teams[r.team] = res.teams[r.team] || { records: [] };
  // WY: 1 คนหลายแถวงานในไฟลท์เดียว → เดิมแต่ละ assignment นับ 1 headcount (เหมือนหลายคน) — จำลองเป็นหลายคน
  const expand = r.team === "WY" || r.team === "TR" ? r.asg.map((a, i) => ({ ...r, name: r.name + "_" + i, asg: [a] })) : [r];
  for (const x of expand) t.records.push({ name: x.name, id: "", bucket: "working", posGroup: x.pss ? "PSS" : "PSA", pos: "",
    shiftStart: x.ds, shiftHrs: x.hrs, assignments: x.asg.map(a => ({ flight: a[0], task: a[1], STA: a[2], STD: a[3], OP: "", CL: "" })) });
}
const old = ctx.slaCollectFlights_(res, null);
// --- ใหม่ ---
const people = [], pss = {};
for (const t of Object.keys(res.teams)) for (const r of res.teams[t].records) {
  const emp = t + ":" + r.name; if (r.posGroup === "PSS") pss[emp] = true;
  people.push({ team: t, emp, name: r.name, ds: r.shiftStart, de: r.shiftStart + r.shiftHrs * 60,
    asg: r.assignments.map(a => ({ code: a.flight, task: a.task, STA: a.STA, STD: a.STD, OP: "", CL: "" })) });
}
const neu = computeSla("2026-10-08", people, Object.keys(res.teams), {}, pss, {});
let bad = 0;
const byKey = {}; neu.forEach(r => byKey[r.flight_key] = r);
console.log("flights old=" + old.length + " new=" + neu.length);
if (old.length !== neu.length) { bad++; console.log("XX จำนวนไฟลท์ไม่เท่ากัน"); }
for (const f of old) {
  const k = ctx.slaFlightKey_(f.flight), n = byKey[k];
  if (!n) { bad++; console.log("XX ไม่มีในใหม่: " + k); continue; }
  const o = { req: [f.req.SUP, f.req.CI, f.req.GATE, f.req.ARR, f.req.total], as: [f.assigned.SUP, f.assigned.CI, f.assigned.GATE, f.assigned.ARR, f.assigned.total],
    short: [f.short.SUP || 0, f.short.CI || 0, f.short.GATE || 0, f.short.ARR || 0, f.shortTotal], ok: f.ok, noTime: !!f.noTime, frag: !!f.fragment, team: f.teamList };
  const x = { req: [n.req_sup, n.req_ci, n.req_gate, n.req_arr, n.req_total], as: [n.as_sup, n.as_ci, n.as_gate, n.as_arr, n.as_total],
    short: [n.short_sup, n.short_ci, n.short_gate, n.short_arr, n.short_total], ok: n.ok, noTime: n.no_time, frag: n.fragment, team: n.team_list };
  const same = JSON.stringify(o) === JSON.stringify(x);
  if (!same) bad++;
  console.log((same ? "OK " : "XX ") + k.padEnd(7) + " req " + o.req + " | มี " + o.as + " | ขาด " + o.short + " | ok " + o.ok + (same ? "" : "\n     ใหม่: req " + x.req + " | มี " + x.as + " | ขาด " + x.short + " | ok " + x.ok + " team " + x.team + " vs " + o.team));
}
console.log(bad ? bad + " FAILED" : "ALL PASSED (ตรงกับ SLA.gs ทุกไฟลท์)"); process.exit(bad ? 1 : 0);
