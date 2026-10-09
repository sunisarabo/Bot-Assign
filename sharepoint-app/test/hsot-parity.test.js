// เทียบตัวอ่านไฟล์ HumanSoft ใหม่ (import-hsot.ts) กับของเดิม (OTCompare.gs rbOTCompareData_) บนข้อมูลชุดเดียวกัน
const vm = require("vm"), fs = require("fs"), path = require("path");
const M = require(process.argv[2]);
const ROOT = path.join(__dirname, "..", "..");
const HS = [
  ["รายงานคำขอ OT", "", "", "", "", "", "", "", "", "", "", "", ""],
  ["2600001", "สมชาย ใจดี", "PSA", "", "", "", "", "", "", "", "", "", ""],
  ["", "07/09/2026", "", "SQ", "", "", "", "", "14:00", "17:00", "", 3, "ไฟลท์ดีเลย์"],
  ["", "08/09/2026", "", "SQ", "", "", "", "", "05:00", "06:30", "", "1:30", ""],
  ["2600002", "สมหญิง รักงาน", "", "", "", "", "", "", "", "", "", "", ""],
  ["", "07/09/2026", "", "", "", "", "", "", "18:00", "22:00", "", 4, "คนไม่พอ"],
  ["", "07/09/2026", "", "", "", "", "", "", "06:00", "07:00", "", 1, "เปิดเคาน์เตอร์"],
  ["รวม", "", "", "", "", "", "", "", "", "", "", 9.5, ""],
  ["2600003", "มานะ ขยัน", "Senior", "", "", "", "", "", "", "", "", "", ""],
  ["", "09/09/2026", "", "QR", "", "", "", "", "20:00", "23:00", "", "3", "AOG"],
];
const TEAM = [["รหัส", "ทีม"], ["2600002", "EK/UO"]];
const sheet = (rows) => ({ getDataRange: () => ({ getValues: () => rows }) });
const ctx = { Logger: { log() {} }, console, PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
  SpreadsheetApp: { openById: () => ({ getSheetByName: (n) => n === "ชีต1" ? sheet(HS) : n === "ทีม" ? sheet(TEAM) : null }) } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, "OTCompare.gs"), "utf8"), ctx);
const old = ctx.rbOTCompareData_("x");
const ws = (name, rows) => ({ getName: () => name, getUsedRange: () => ({ getTexts: () => rows.map(r => r.map(String)), getValues: () => rows }) });
const wb = { getWorksheet: (n) => n === "ทีม" ? ws("ทีม", TEAM) : undefined, getWorksheets: () => [ws("ทีม", TEAM), ws("ชีต1", HS)] };
const neu = M.main(wb, JSON.stringify([{ Title: "2600003", team: "QR/MH" }]), "", "OT HumanSoft SEP.xlsx");
const iso = d => d.split("/").reverse().join("-");
const a = old.details.map(d => [iso(d.date), d.empCode, d.empName, d.position, d.team, d.timeRange, d.hours, d.reason].join("|"));
// ของเดิม: details = เฉพาะรายการที่ไม่อยู่ในแผน (ไฟล์ทดสอบไม่มีชีตแผน → ทุกรายการ = ขอจริงทั้งหมด)
const rows = [];
for (const bt of neu.batches) for (const m of bt.body.matchAll(/\{.*\}/g)) rows.push(JSON.parse(m[0]));
const n = rows.map(r => [r.day_key, r.emp_code, r.emp_name, r.position, r.team === "QR/MH" ? "QR" : r.team, r.time_start + " - " + r.time_end, r.hours, r.reason].join("|"));
let bad = 0;
console.log("รายการ เดิม=" + a.length + " ใหม่=" + n.length + " · วัน " + neu.days.join(",")); if (a.length !== n.length) bad++;
a.forEach((x, i) => { const ok = x === n[i]; if (!ok) bad++; console.log((ok ? "OK " : "XX ") + x + (ok ? "" : "\n   ใหม่: " + n[i])); });
console.log(bad ? bad + " FAILED" : "ALL PASSED (อ่านไฟล์ HumanSoft ตรงกับ OTCompare.gs ทุกรายการ)"); process.exit(bad ? 1 : 0);
