// เทียบ Support/เติมคน ใหม่ (supportRows) กับของเดิม (SLA.gs slaSupportRows_) บนข้อมูลชุดเดียวกัน
const vm = require("vm"), fs = require("fs"), path = require("path");
const M = require(process.argv[2]);
const ROOT = path.join(__dirname, "..", "..");
const ctx = { Logger: { log() {} }, console };
vm.createContext(ctx);
for (const f of ["RosterReader.gs", "AssignCheck.gs", "SLA.gs", "WeeklyFlight.gs", "AirlineSupport.gs"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx);
ctx.manOverride_ = () => null;
const hm = s => { const m = String(s).match(/(\d+):(\d+)/); return m ? +m[1] * 60 + +m[2] : null; };
// [ทีม, ชื่อ, ตำแหน่ง, กะ, ชม.OT, ช่วงOT, bucket, งาน[[flight,task,STA,STD]]]
const P = [
  // ไฟลท์ขาด (เจ้าของ)
  ["SQ", "sq-sup", "PSS", "05:00-14:00", 0, "", "working", [["SQ726", "SUP", "", "10:30"]]],
  ["SQ", "sq-ci", "PSA", "05:00-14:00", 0, "", "working", [["SQ726", "C1", "", "10:30"]]],
  ["MH", "mh-ci", "PSA", "10:00-19:00", 0, "", "working", [["MH782", "C1", "15:00", "16:30"]]],
  ["VN", "vn-ci", "PSA", "12:00-21:00", 0, "", "working", [["VN636", "CT", "", "18:00"]]],          // Altea · ไม่มีใน AIRLINE_SUP → รับทุกเฟส
  ["SU", "su-ci", "PSA", "06:00-15:00", 0, "", "working", [["SU274", "CT", "", "11:00"]]],          // ASTRA (CHARTER ก่อน)
  ["QR", "qr-ci", "PSA", "06:00-15:00", 0, "", "working", [["QR840", "C1", "", "12:00"]]],          // QR ไม่รับซัพ
  ["H4", "h4-a", "PSA", "05:00-14:00", 0, "", "working", [["H4501", "C1", "", "10:00"]]],          // iPort → ทุกคนช่วยเช็คอินได้ · รับทุกเฟส
  ["H4", "h4-b", "PSA", "05:00-14:00", 0, "", "working", [["H4503", "C1", "", "10:30"]]],          // เวลาทับ H4501 → ทดสอบ "จองคน" ไม่แนะซ้ำ
  // คนช่วยได้ (ทีมอื่น)
  ["EY", "ey-agent1", "PSA", "05:00-14:00", 0, "", "working", [["EY410", "CT1", "", "06:00"]]],     // Altea · ว่างหลัง 06:00
  ["EY", "ey-snr", "SNR", "04:00-13:00", 0, "", "working", []],
  ["EY", "ey-sup", "PSS", "05:00-14:00", 0, "", "working", []],
  ["KE", "ke-agent", "PSA", "09:00-18:00", 0, "", "working", [["KE638", "C1", "", "11:30"]]],     // Altea · ติดงาน 11:30
  ["KE", "ke-night", "PSA", "18:00-03:00", 0, "", "working", []],
  ["PVTLP", "pvt-1", "PSA", "06:00-15:00", 0, "", "working", []],                                   // ทีมพูล · ไม่รู้ระบบ
  ["CHARTER", "ch-1", "PSA", "05:00-14:00", 0, "", "working", []],                                  // ASTRA pool
  ["TR", "tr-busy", "PSA", "05:00-14:00", 0, "", "working", [["TR632", "G", "", "07:00"], ["TR634", "G", "", "08:00"]]],   // 2 ไฟลท์ติด → พัก 60
  ["TR", "tr-long", "PSA", "05:00-17:00", 5, "17:00-22:00", "working", []],                          // ชั่วโมงยาว → ดันท้าย
  ["WY", "wy-otoff", "PSA", "", 6, "08:00-14:00", "ot_off", []],                                    // OT วันหยุด → ดันท้าย
  ["PORTER", "porter", "PSA", "05:00-14:00", 0, "", "working", []],                                 // ทีม Porter ไม่ใช่คนช่วย
];
const res = { teams: {} }, recs = [], pg = {};
for (const [team, name, pos, shift, ot, otr, bucket, asg] of P) {
  const sr = shift ? shift.split("-").map(hm) : [null, null], orr = otr ? otr.split("-").map(hm) : [null, null];
  const hrs = sr[0] != null ? ((sr[1] - sr[0] + 1440) % 1440) / 60 : 0;
  const otType = ot > 0 ? ctx.rrOtType_(sr, orr, bucket === "ot_off") : null;
  const spans = orr[0] != null ? [{ a: orr[0], b: orr[1], type: null }] : [];
  const assignments = asg.map(a => ({ flight: a[0], task: a[1], STA: a[2], STD: a[3], OP: "", CL: "" }));
  const st = sr[0] != null ? ctx.rrFmtRange_(sr) : "";
  (res.teams[team] = res.teams[team] || { records: [] }).records.push({ name, id: name, pos, posGroup: pos, bucket, shift: "D", shiftTime: st,
    shiftStart: sr[0], shiftHrs: hrs, ot, otType, otSpans: spans, otTime: otr ? ctx.rrFmtRange_(orr) : "", assignments, training: false });
  pg[name] = pos;
  recs.push({ team, name, emp: name, hrs, bucket: bucket === "ot_off" ? "OT_OFF" : "WORKING", ss: sr[0], se: sr[1], ot, otType: otType || "",
    otSpans: spans.map(s => ({ a: s.a, b: s.b, type: "" })), otTime: otr ? ctx.rrFmtRange_(orr) : "", shiftCode: "D", asg: assignments });
}
const old = ctx.slaSupportRows_(res, null);
// ใหม่: ไฟลท์จาก computeSla (คนเดียวกัน)
const people = recs.map(r => ({ team: r.team, emp: r.emp, name: r.name, ds: r.ss, de: r.se, asg: r.asg.map(a => ({ code: a.flight, task: a.task, STA: a.STA, STD: a.STD, OP: "", CL: "" })) }));
const pss = {}; for (const k of Object.keys(pg)) if (pg[k] === "PSS") pss[k] = true;
const sla = M.computeSla("2026-10-08", people, Object.keys(res.teams), {}, pss, {});
const neu = M.supportRows("2026-10-08", sla.flights, recs, pg);
let bad = 0;
console.log("แถวขาด เดิม=" + old.length + " ใหม่=" + neu.length);
if (old.length !== neu.length) bad++;
old.forEach((o, i) => {
  const n = neu[i] || {};
  const a = { flight: o.flight, phase: o.phase, short: o.shortN, win: o.win, sys: o.needSys, block: o.block,
    cands: o.cands.map(c => c.name).join(","), others: o.others.map(c => c.name).join(","), first: o.cands[0] ? [o.cands[0].shift, o.cands[0].ot, o.cands[0].hlevel, o.cands[0].n].join("|") : "" };
  const nc = JSON.parse(n.cands_json || "[]"), no = JSON.parse(n.others_json || "[]");
  const b = { flight: n.flight, phase: n.phase, short: n.short_n, win: n.win, sys: n.need_sys, block: n.block,
    cands: nc.map(c => c[0]).join(","), others: no.map(c => c[0]).join(","), first: nc[0] ? [nc[0][5], nc[0][6], nc[0][8], nc[0][10]].join("|") : "" };
  const same = JSON.stringify(a) === JSON.stringify(b);
  if (!same) bad++;
  console.log((same ? "OK " : "XX ") + (a.flight + " " + a.phase).padEnd(18) + " ขาด " + a.short + " · " + (a.block || ("คน: " + (a.cands || "—"))) + (a.others ? " · อื่นๆ: " + a.others : ""));
  if (!same) for (const k of Object.keys(a)) if (a[k] !== b[k]) console.log("     " + k + "\n       เดิม: " + a[k] + "\n       ใหม่: " + b[k]);
});
console.log(bad ? bad + " FAILED" : "ALL PASSED (ตรงกับ SLA.gs Support ทุกแถว)"); process.exit(bad ? 1 : 0);
