// เทียบ จัดล่วงหน้า ใหม่ (advPlanDay / advScanFrontline) กับของเดิม (AdvancePlan.gs advPlan_) บนข้อมูลชุดเดียวกัน
const vm = require("vm"), fs = require("fs"), path = require("path");
const M = require(process.argv[2]);
const ROOT = path.join(__dirname, "..", "..");
const ctx = { Logger: { log() {} }, console, CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) }, PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) } };
vm.createContext(ctx);
for (const f of ["RosterReader.gs", "AssignCheck.gs", "SLA.gs", "WeeklyFlight.gs", "AirlineSupport.gs", "AutoPlan.gs", "AdvancePlan.gs"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx);
ctx.manOverride_ = () => null;
// ---- ROSTER ล่วงหน้า (บล็อกหน้างาน) : วันที่ 7 กับ 8 ต.ค. ----
const H = (title) => [title, "POS", "ID", "NAME", "SURNAME", "7/TIME", "CODE", "HR", "OT", "OTHR", "REMARK", "8/TIME", "CODE", "HR", "OT", "OTHR", "REMARK"];
const P = (pos, id, nm, d8, d7) => ["", pos, id, nm, "X", d7 || "05:00-14:00", "E9", "", "", "", "", d8, "", "", "", "", ""];
const sheet1 = [
  ["PS ROSTER"], H("OCTOBER 2026 /SQ CX LY"),
  P("Supervisor", "2600001", "sq-sup", "05:00-14:00"), P("Senior PSA", "2600002", "sq-snr", "05:00-14:00"),
  P("PSA", "2600003", "sq-a1", "06:00-15:00"), P("PSA", "2600004", "sq-a2", "06:00-15:00"), P("PSA", "2600005", "sq-a3", "09:00-18:00"),
  P("PSA", "2600006", "sq-off", "OFF"), P("PSA", "2600007", "sq-resign", "05:00-14:00"),
  H("OCTOBER 2026 /QR MH DE OM"),
  P("Supervisor", "2600011", "qr-sup", "07:00-16:00"), P("PSA", "2600012", "qr-a1", "07:00-16:00"), P("PSA", "2600013", "qr-a2", "07:00-16:00"),
  P("PSA", "2600014", "qr-a3", "13:00-22:00"), P("Senior PSA", "2600015", "qr-snr", "12:00-21:00"),
];
const sheet2 = [
  H("SEPTEMBER 2026 /EK UO FY"), P("PSA", "2600090", "wrong-month", "05:00-14:00"),          // เดือนไม่ตรง → ไม่นับ
  H("OCTOBER 2026 /EK UO FY 6B BY"),
  P("Supervisor", "2600021", "ek-sup", "05:00-14:00"), P("PSA", "2600022", "ek-a1", "06:00-15:00"), P("PSA", "2600023", "ek-a2", "06:00-15:00"),
  H("OCTOBER 2026 /PG"), P("PSA", "2600031", "pg-a1", "10:00-19:00"), P("PSA", "2600032", "pg-a2", "11:00-20:00"), P("Senior", "2600033", "pg-snr", "10:00-19:00"),
  H("OCTOBER 2026 /VIP LP"), P("PSA", "2600041", "pvt-1", "06:00-15:00"), P("PSA", "2600042", "pvt-night", "22:00-07:00"), P("PSA", "2600043", "pvt-blank", ""),
];
const emps = [
  ["2600001", "SQ/CX/LY", "Supervisor"], ["2600002", "SQ/CX/LY", "Senior PSA"], ["2600003", "SQ/CX/LY", "PSA"], ["2600004", "SQ", "PSA"], ["2600005", "SQ", "PSA"],
  ["2600006", "SQ", "PSA"], ["2600007", "SQ", "PSA", "Resigned"], ["2600011", "QR/MH/DE", "Supervisor"], ["2600012", "QR/MH", "PSA"], ["2600013", "QR", "PSA"],
  ["2600014", "QR", "PSA"], ["2600015", "QR/MH", "Senior"], ["2600021", "EK/UO", "Supervisor"], ["2600022", "EK", "PSA"], ["2600023", "EK", "PSA"],
  ["2600031", "PG", "PSA"], ["2600032", "PG", "PSA"], ["2600033", "PG", "Senior"], ["2600041", "VIP", "PSA"], ["2600042", "PRIVATE", "PSA"], ["2600043", "VIP", "PSA"],
].map(([id, team, pos, st]) => ({ Title: id, team, position: pos, name_en: "", status: st || "Active" }));
// ---- ตารางบิน 8 ต.ค. ----
const flights = [
  ["SQ726", "09:30", "10:30", ""], ["CX701", "12:00", "13:00", "A330"], ["QR840", "10:30", "12:00", "B777"], ["MH782", "15:00", "16:30", ""],
  ["EK378", "09:00", "11:00", ""], ["PG271", "13:00", "14:00", "A320"], ["LY85", "", "18:00", ""], ["TR632", "08:00", "09:00", ""], ["QR838", "", "", ""],
  ["SQ728", "16:00", "17:00", "", true],
].map(([f, sta, std, ac, c]) => ({ day_key: "2026-10-08", flight_no: f, sta, std, aircraft_type: ac, cancelled: !!c }));

// ---- เดิม ----
const empMap = {}; for (const e of emps) empMap[e.Title] = { id: e.Title, team: e.team, pos: e.position, name: "", active: !/resign/i.test(e.status) };
ctx.advReadEmployees_ = () => empMap;
ctx.advReadRosterFrontline_ = (tgt) => { const out = []; [sheet1, sheet2].forEach(d => ctx.advScanFrontlineRows_(d, tgt, out)); return out; };
ctx.advReadFlights_ = () => flights.filter(f => !f.cancelled).map(f => ({ flight: f.flight_no, airline: f.flight_no.slice(0, 2), STA: f.sta, STD: f.std, AC: f.aircraft_type, gate: "", OP: "", CL: "" }));
const old = ctx.advPlan_({ y: 2026, m: 10, d: 8 });
// ---- ใหม่ ----
const front = []; for (const d of [sheet1, sheet2]) M.advScanFrontline(d.map(r => r.map(String)), 10, 8, front);
const neu = M.advPlanDay("2026-10-08", front, M.advEmpMap(JSON.stringify(emps)), flights, {});
const rows = neu.plan.filter(r => r.kind === "FLIGHT"), sum = neu.plan.find(r => r.kind === "SUM");
let bad = 0;
const K = ["SUP", "FC", "CI", "ARR", "STB", "GM", "GA"];
console.log("ไฟลท์ เดิม=" + old.plan.length + " ใหม่=" + rows.length); if (old.plan.length !== rows.length) bad++;
old.plan.forEach((o, i) => {
  const n = rows[i] || {};
  const a = { flight: o.flight, team: o.team, counter: o.counter }, b = { flight: n.flight, team: n.team, counter: n.counter };
  for (const k of K) {
    const lk = k.toLowerCase();
    a[k] = o.req[k] + ":" + (o.assign[k] || []).map(p => p.name).join(",") + ":" + (o.shortx[k] || 0) + ":" + (o["ot" + k] || []).map(c => c.name + "+" + c.ot).join(",");
    const ot = JSON.parse(n.ot_json || "{}")[k] || [];
    b[k] = n["req_" + lk] + ":" + JSON.parse(n["a_" + lk] || "[]").map(p => p[0]).join(",") + ":" + n["short_" + lk] + ":" + ot.map(c => c[0] + "+" + c[4]).join(",");
  }
  const same = JSON.stringify(a) === JSON.stringify(b); if (!same) bad++;
  console.log((same ? "OK " : "XX ") + a.flight.padEnd(7) + K.filter(k => o.req[k]).map(k => k + " " + ((o.assign[k] || []).map(p => p.name).join(",") || "—") + (o.shortx[k] ? " (ขาด " + o.shortx[k] + ")" : "")).join(" · "));
  if (!same) for (const k of Object.keys(a)) if (a[k] !== b[k]) console.log("     " + k + "\n       เดิม: " + a[k] + "\n       ใหม่: " + b[k]);
});
const ob = old.bench.map(b => b.name).sort().join(","), nb = neu.ros.filter(r => r.n_jobs === 0).map(r => r.emp_name).sort().join(",");
const s1 = { bench: ob, people: old.nPeople, asg: old.nAssigned }, s2 = { bench: nb, people: sum.n_people, asg: sum.n_assigned };
const same = JSON.stringify(s1) === JSON.stringify(s2); if (!same) { bad++; console.log("     เดิม: " + JSON.stringify(s1) + "\n     ใหม่: " + JSON.stringify(s2)); }
console.log((same ? "OK " : "XX ") + "พูล " + old.nPeople + " คน · จัด " + old.nAssigned + " · พัก: " + (ob || "—"));
console.log(bad ? bad + " FAILED" : "ALL PASSED (ตรงกับ AdvancePlan.gs ทุกไฟลท์ทุกบทบาท)"); process.exit(bad ? 1 : 0);
