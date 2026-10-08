// เทียบ ตรวจ Assign ใหม่ (acAnalyzeRec) กับของเดิม (AssignCheck.gs acAnalyze_) บนข้อมูลชุดเดียวกัน
const vm = require("vm"), fs = require("fs"), path = require("path");
const M = require(process.argv[2]);
const ROOT = path.join(__dirname, "..", "..");
const ctx = { Logger: { log() {} }, console };
vm.createContext(ctx);
for (const f of ["RosterReader.gs", "AssignCheck.gs", "SLA.gs", "WeeklyFlight.gs"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx);
const hm = s => { const m = String(s).match(/(\d+):(\d+)/); return m ? +m[1] * 60 + +m[2] : null; };
// [ทีม, ชื่อ, bucket, กะ "06:00-15:00"|"", ชม.OT, ช่วงOT "a-b"|"", assignments[[flight,task,STA,STD,OP,CL]]]
const P = [
  ["EY", "ok-ci", "working", "05:00-14:00", 0, "", [["EY410/411", "CT1", "08:05", "09:30", "", ""]]],
  ["EY", "out-noot", "working", "13:00-22:00", 0, "", [["EY410/411", "CT2", "08:05", "09:30", "", ""]]],
  ["QR", "post-ot-ok", "working", "06:00-15:00", 3, "15:00-18:00", [["QR840", "G", "", "17:30", "", ""], ["QR841", "ARR", "11:00", "", "", ""]]],
  ["QR", "ot-not-needed", "working", "06:00-15:00", 2, "15:00-17:00", [["QR842", "C1", "", "12:00", "08:30", "11:00"]]],
  ["QR", "gap-edge", "working", "06:00-15:00", 0, "", [["QR843", "ARR", "07:00", "", "", ""]]],
  ["TR", "otoff", "ot_off", "", 4, "16:00-20:00", [["TR632", "C1", "", "19:00", "16:30", "18:15"]]],
  ["TR", "pre-ot", "working", "06:00-15:00", 2, "04:00-06:00", [["TR634", "CT", "", "06:30", "", ""]]],
  ["SQ", "gate-arr", "working", "07:00-16:00", 0, "", [["SQ726", "GATE", "", "10:30", "", ""], ["SQ727", "ARR", "14:00", "", "", ""]]],
  ["SQ", "cs-gk", "working", "07:00-16:00", 0, "", [["SQ728", "CS", "", "12:00", "08:00", "11:00"], ["SQ729", "GK", "", "15:00", "", ""]]],
  ["SQ", "training", "working", "07:00-16:00", 0, "", [["TRAINING 08-17", "", "", "", "", ""], ["SQ730", "C2", "", "09:00", "", ""]]],
  ["TR", "support-ey", "working", "05:00-14:00", 0, "", [["EY410/411", "CT3", "08:05", "09:30", "", ""]]],
  ["KE", "night", "working", "22:00-07:00", 0, "", [["KE638", "C1", "", "01:30", "22:30", "00:45"], ["KE637", "ARR", "23:50", "", "", ""]]],
  ["KE", "nowin", "working", "", 0, "", [["KE639", "C1", "", "10:00", "", ""]]],
  ["WY", "manifest", "working", "06:00-15:00", 0, "", [["WY814", "MANIFEST", "10:00", "11:30", "", ""], ["WY815", "DEBRIEF", "", "14:30", "", ""]]],
  ["WY", "sod-multi", "working", "06:00-15:00", 0, "", [["WY816", "SOD", "", "07:00", "", ""], ["WY818", "SOD", "", "20:00", "", ""], ["WY820", "SOD", "", "23:00", "", ""]]],
];
const res = { teams: {} }, recs = [];
for (const [team, name, bucket, shift, ot, otr, asg] of P) {
  const sr = shift ? shift.split("-").map(hm) : [null, null];
  const orr = otr ? otr.split("-").map(hm) : [null, null];
  const otType = ot > 0 ? ctx.rrOtType_(sr, orr, bucket === "ot_off") : null;
  const spans = orr[0] != null ? [{ a: orr[0], b: orr[1], type: null }] : [];
  const assignments = asg.map(a => ({ flight: a[0], task: a[1], STA: a[2], STD: a[3], OP: a[4], CL: a[5] }));
  (res.teams[team] = res.teams[team] || { records: [] }).records.push({ name, id: "", pos: "PSA", bucket, shiftTime: shift, shift: shift ? "D" : "X",
    shiftStart: sr[0], shiftHrs: sr[0] != null ? ((sr[1] - sr[0] + 1440) % 1440) / 60 : 0, ot, otType, otSpans: spans, otTime: otr, assignments, training: false });
  recs.push({ team, name, bucket: bucket === "ot_off" ? "OT_OFF" : "WORKING", ss: sr[0], se: sr[1], ot, otType: otType || "",
    otSpans: spans.map(s => ({ a: s.a, b: s.b, type: "" })), otTime: otr ? ctx.rrFmtRange_(orr) : "", shiftCode: shift ? "D" : "X", asg: assignments });
}
const old = ctx.acAnalyze_(res, null).rows;
const owner = M.acOwnerTeams(recs);
let bad = 0;
for (const r of recs) {
  const n = M.acAnalyzeRec(r, owner), o = old.find(x => x.name === r.name);
  const pick = x => ({ status: x.status, flights: x.flights, job: x.job || "", zones: x.zones || "0/0/0", support: x.support || 0, uncovered: x.uncovered || "", gaps: x.gaps || "", otVerdict: x.otVerdict || "", issue: x.issue || "" });
  const a = pick(o), b = pick(n);
  if (a.status === "nowin") { a.job = b.job = ""; a.zones = b.zones = ""; a.support = b.support = 0; }   // เดิมไม่สร้างคอลัมน์งานให้แถวไม่มีเวลากะ
  const same = JSON.stringify(a) === JSON.stringify(b);
  if (!same) bad++;
  console.log((same ? "OK " : "XX ") + r.name.padEnd(14) + a.status.padEnd(6) + " " + a.flights + " · " + (a.issue || "—").slice(0, 70));
  if (!same) for (const k of Object.keys(a)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) console.log("     " + k + "\n       เดิม: " + a[k] + "\n       ใหม่: " + b[k]);
}
console.log(bad ? bad + " FAILED" : "ALL PASSED (ตรงกับ AssignCheck.gs ทุกคน)"); process.exit(bad ? 1 : 0);
