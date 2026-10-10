// เทียบตัวอ่านไฟล์เวรใหม่ (readRoster + คำขอซัพพอร์ต) กับของเดิม (RosterReader.gs + WebDashboard.gs rbAttachSupportOut_/rbSupportHtml + SLA.gs)
// fixture จำลองรูปแบบไฟล์จริง: หัวตาราง ID/NAME · RE-SKED · OT ก่อน/หลังกะ · ID เป็นข้อความ · คอลัมน์ ID เยื้อง (แบบแท็บ TR) · แถว Support · อบรม · SUPPORT REQUEST
const vm = require("vm"), fs = require("fs"), path = require("path");
const M = require(process.argv[2]), X = require("./fakexl.js");
const ROOT = path.join(__dirname, "..", "..");
const W = X.W, blank = () => Array(W).fill("");
const P = (o) => { const r = blank(); r[0] = o.id == null ? "" : o.id; r[1] = o.pos || "PSA"; r[2] = o.name; r[3] = o.code || "";
  if (o.rs) { r[7] = o.rs[0]; r[8] = o.rs[1]; } if (o.pre) { r[10] = o.pre[0]; r[11] = o.pre[1]; } if (o.post) { r[13] = o.post[0]; r[14] = o.post[1]; }
  r[16] = o.st == null ? "Onduty" : o.st; r[17] = o.rm || ""; (o.jobs || []).forEach(([i, t]) => r[19 + i * 4] = t); return r; };
const team = (flights, people, shiftId) => { const top = blank(); top[0] = "TEAM"; top[4] = "10/OCT";
  const rows = [top].concat(X.header(flights)); const rest = people.map(P);
  if (shiftId) rest.forEach(r => { const id = r[0]; r[0] = r[1]; r[1] = id; });     // แบบแท็บ TR: ตำแหน่งอยู่ A · รหัสอยู่ B
  return rows.concat(rest); };
const T = {
  SQ: team([{ code: "SQ726/SQ725", sta: "08:35", std: "09:25" }, { code: "SQ728/727", sta: "10:50", std: "11:40" }, { code: "CX700", sta: "", std: "" }], [
    { id: 2100960, pos: "Sup", name: "INDIA", code: "F9", jobs: [[0, "SOD"]] },
    { id: "2101225", pos: "Snr", name: "LIMA", code: "F9", jobs: [[0, "FC"], [1, "GA"]] },
    { id: 2101243, name: "BRAVO", code: "E9", pre: ["03:00", "05:00"], jobs: [[0, "C1"]] },
    { id: 2101394, name: "GOLF", code: "J9", st: "Off" },
    { id: 2201494, name: "MIKE", code: "G9", rs: ["06:00", "16:00"], post: ["16:00", "18:00"], jobs: [[1, "C2/GA"]] },
    { id: 2201495, name: "TRAINEE", code: "G9", rm: "TRAINING LOAD CONTROL 08-17" },
    { id: "", pos: "Support", name: "OSCAR (CHARTER)", jobs: [[1, "ARR"]] }]),
  TR: team([{ code: "TR658/659", sta: "08:20", std: "09:20" }], [
    { id: 2101080, pos: "PSS", name: "HOTEL", code: "F9", jobs: [[0, "SOD"]] },
    { id: 2303487, pos: "SNR", name: "DELTA", code: "E9", jobs: [[0, "C1/GA"]] },
    { id: 2404987, pos: "PSA", name: "ECHO", code: "G9", st: "VAC" },
    { id: 2201505, pos: "PSA", name: "FOXTROT", code: "J9" }], true),
  CHARTER: team([{ code: "N43433/9903", sta: "09:30", std: "12:25" }], [
    { id: "2202073", pos: "SNR", name: "KILO S.", code: "J9", rs: ["07:00", "17:00"] },
    { id: "2202105", pos: "Sup", name: "JULIET", code: "F9", jobs: [[0, "FC/FR"]] },
    { id: "2202439", pos: "PSA", name: "PAPA", code: "E9", st: "OT OFF", pre: ["05:00", "09:00"] },
    { id: "2202440", pos: "PSA", name: "NOVEMBER", code: "F9" }, { id: "2202441", pos: "PSA", name: "ALPHA", code: "J9" }]),
};
const REQ = [["SUPPORT REQUEST — วันที่ 10/10/2026"], ["NO.", "ทีมที่ขอ", "FLIGHT", "หน้าที่", "เวลา/STBY", "ชื่อผู้ไปซัพพอร์ต (ดิวตี้กรอก)", "จากทีม", "สถานะ", "Re-sked/Remark"],
  ["1", "SQ", "SQ726/SQ725", "ARR", "08:00-08:40", "KILO S.", "CHARTER", "จัดแล้ว", "RE 07-17"],
  ["2", "TR", "TR658/659", "GA", "08:30-09:20", "", "", "(รอจัดคน)", ""],
  ["3", "SQ", "SQ728/727", "GA", "10:55", "", "", "(รอจัดคน)", ""],
  ["4", "TR", "TR658/659", "SOD", "07:20-09:20", "NOVEMBER", "CHARTER", "จัดแล้ว", ""],
  ["", "SQ", "", "", "", "", "", "", ""]];
const MP = [["MANPOWER"], ["Team (SQ)", 7], ["Team (TR)", 4], ["Team (CHARTER)", 5]];
const tabs = Object.assign({ MANPOWER: MP, ShiftDB: X.SHIFTDB, "SUPPORT REQUEST": REQ }, T);
// ---- เดิม ----
const ctx = { Logger: { log() {} }, console, Utilities: { formatDate: d => d.toISOString().slice(0, 10) }, Session: { getScriptTimeZone: () => "Asia/Bangkok" },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) }, CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) } };
vm.createContext(ctx);
for (const f of ["RosterReader.gs", "AssignCheck.gs", "SLA.gs", "AirlineSupport.gs", "WebDashboard.gs"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx);
ctx.manOverride_ = () => null;
const gsheet = (name, rows) => { const Wd = Math.max(...rows.map(r => r.length)); const v = rows.map(r => r.concat(Array(Wd - r.length).fill("")));
  return { getName: () => name, getLastRow: () => v.length, getLastColumn: () => Wd, getDataRange: () => ({ getValues: () => v }),
    getRange: (r, c, nr, nc) => ({ getValues: () => v.slice(r - 1, r - 1 + nr).map(x => x.slice(c - 1, c - 1 + nc)) }) }; };
const ss = { getSheets: () => Object.keys(tabs).map(n => gsheet(n, tabs[n])), getSheetByName: n => tabs[n] ? gsheet(n, tabs[n]) : null };
const res = ctx.readRosterFromSpreadsheet(ss, null);
res.supportReq = ctx.rrReadSupportReq_(ss);
ctx.rbAttachSupportOut_(res, null);
// ---- ใหม่ ----
const wb = X.book(tabs);
const neu = M.readRoster(wb.getWorksheets().map(w => ({ name: w.getName(), rows: w.getUsedRange().getTexts() })));
let bad = 0;
const key = r => [r.id || r.name, r.name, r.bucket, r.shiftStart, r.shiftHrs, r.ot, r.otType || "", !!r.training, !!r.support, r.supportTeam || "", r.posGroup,
  (r.assignments || []).filter(a => !a.supportOut).map(a => [a.flight, a.task, a.STA, a.STD, a.OP, a.CL].join("~")).join(" | ")].join(" ¦ ");
for (const t of Object.keys(T)) {
  const o = res.teams[t].records.map(key), nt = neu.tabs.find(x => x.name === t), n = nt ? nt.recs.map(key) : [];
  const same = JSON.stringify(o) === JSON.stringify(n); if (!same) { bad++; o.forEach((x, i) => { if (x !== n[i]) console.log("   เดิม " + x + "\n   ใหม่ " + n[i]); }); }
  console.log((same ? "OK " : "XX ") + "อ่านแท็บ " + t.padEnd(8) + o.length + " คน");
}
// คำขอซัพพอร์ต → แถวหาคน (ทั้งไฟล์ผ่าน main)
const r = M.main(wb, "Shared Documents/2026/10.OCT26/10OCT.xlsx");
const rows = l => r.batches.filter(b => b.list === l).flatMap(b => [...b.body.matchAll(/^\{.*\}$/gm)].map(m => JSON.parse(m[0])));
const reqs = res.supportReq.map(q => { const ph = ctx.rbSupDutyPhase_(q.duty), cov = !!q.name || /จัดแล้ว|เสร็จ|assigned|done/i.test(q.status || "");
  return { flight: q.flight, phase: ph, n: 1, win: ctx.rbSupReqWin_(q.time, ph), open: cov ? 0 : 1, assigned: q.name || "", label: (q.duty || "") + (q.team ? " · ขอโดย " + q.team : "") }; })
  .filter(x => x.flight && ctx.acIsFlight_(x.flight));
const or = ctx.slaManualSupportRows_(res, null, reqs, true), nr = rows("PAS_Support").filter(x => x.source === "REQ");
console.log("คำขอ เดิม " + or.length + " ใหม่ " + nr.length); if (or.length !== nr.length) bad++;
or.forEach((o, i) => { const n = nr[i] || {}; const nc = JSON.parse(n.cands_json || "[]");
  const a = [o.flight, o.phase, o.win, o.assigned, o.shortN, o.cands.map(c => c.name).join(",")], b = [n.flight, n.phase, n.win, n.assigned, n.short_n, nc.map(c => c[0]).join(",")];
  const same = JSON.stringify(a) === JSON.stringify(b); if (!same) bad++;
  console.log((same ? "OK " : "XX ") + "คำขอ " + (o.flight + " " + o.label).padEnd(30) + (o.assigned ? "จัดแล้ว " + o.assigned : "รอจัดคน → " + (a[5] || "—")) + (same ? "" : "\n   เดิม " + JSON.stringify(a) + "\n   ใหม่ " + JSON.stringify(b))); });
// คนที่ดิวตี้ส่งไปซัพแล้ว → ติดงานช่วงนั้น
const go = []; Object.keys(res.teams).forEach(t => res.teams[t].records.forEach(rec => (rec.assignments || []).forEach(a => { if (a.supportOut) go.push(t + "|" + rec.name + "|" + a.flight); })));
const gn = rows("PAS_Assignment").filter(a => /^ซัพ/.test(a.task)).map(a => a.team + "|" + a.emp_name + "|" + a.Title);
const sameOut = JSON.stringify(go.sort()) === JSON.stringify(gn.sort()); if (!sameOut) bad++;
console.log((sameOut ? "OK " : "XX ") + "ผูกงานซัพให้คนที่ส่งไปแล้ว: " + gn.join(", ") + (sameOut ? "" : "\n   เดิม " + go.join(", ")));
// Gantt รายคน: PAS_Duty.gantt_json ต้องวาดออกมาเหมือน rbTtGantt_ ทุกแถบ (ตำแหน่ง · สี/เฟส · เลน · ป้าย · รายละเอียด)
{
  const html = ctx.rbTtGantt_(res, null, -1, {});
  const un = s => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const pc = m => +(m / 1440 * 100).toFixed(4);
  const go = html.split('<div class="gt-row').slice(2).map(h => ({
    team: un((h.match(/data-team="([^"]*)"/) || [])[1] || ""), st: (h.match(/gt-status \w+">([^<]*)</) || [])[1],
    b: [...h.matchAll(/gt-seg (gt-\w+)" style="left:([\d.e-]+)%;width:([\d.e-]+)%" data-tip="[^"]*"><span>(.*?)<\/span>/g)].map(m => [+(+m[2]).toFixed(4), +(+m[3]).toFixed(4), { "gt-shift": "s", "gt-ot": "o", "gt-ghost": "g" }[m[1]], un(m[4])]),
    f: [...h.matchAll(/gt-flt (\w+)( sup)?" style="left:([\d.e-]+)%;width:([\d.e-]+)%;top:(\d+)px" data-tip="([^"]*)"><span>(.*?)<\/span>/g)].map(m => [+(+m[3]).toFixed(4), +(+m[4]).toFixed(4), m[1], m[2] ? 1 : 0, (+m[5] - 30) / 18, un(m[7]), un(m[6])]) }));
  const gn = rows("PAS_Duty").filter(d => !d.gantt_hide).sort((x, y) => x.gantt_ord - y.gantt_ord).map(d => { const g = JSON.parse(d.gantt_json || "{}");
    return { team: d.team, st: g.st, b: (g.b || []).map(x => [pc(x[0]), pc(x[1] - x[0]), x[2], x[3]]), f: (g.f || []).map(x => [pc(x[0]), pc(x[1] - x[0]), x[2], x[3], x[4], x[5], x[6]]) }; });
  let gBad = 0; go.forEach((o, i) => { if (JSON.stringify(o) !== JSON.stringify(gn[i])) { gBad++; console.log("   เดิม " + JSON.stringify(o) + "\n   ใหม่ " + JSON.stringify(gn[i])); } });
  if (go.length !== gn.length) gBad++;
  const nJob = gn.reduce((s, x) => s + x.f.length, 0), nSup = gn.reduce((s, x) => s + x.f.filter(f => f[3]).length, 0);
  if (gBad || nJob < 8 || nSup < 2) bad++;
  console.log((gBad ? "XX " : "OK ") + "Gantt รายคน " + gn.length + " แถว · งาน " + nJob + " แถบ · ซัพข้ามทีม " + nSup + " (ตรงกับ rbTtGantt_)");
}
console.log(bad ? bad + " FAILED" : "ALL PASSED (อ่านไฟล์เวร + คำขอซัพพอร์ต + Gantt ตรงกับ RosterReader.gs / WebDashboard.gs)"); process.exit(bad ? 1 : 0);
