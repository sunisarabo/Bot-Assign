// OT: ปกติ + นักขัต X1 · ไม่นับแถวซัพพอร์ต · แถวรายคน · สัปดาห์ จ.–อา.
const { main } = require(process.argv[2]);
const X = require("./fakexl.js");
const W = 44, blank = () => Array(W).fill("");
const mp = [["MANPOWER"], ["Team (EY)", 4, 0, 0, 0, 0, 0, 0, 0, 3]];
const ey = [blank()].concat(X.header([{ code: "EY410" }]));
const person = (id, name, ot1, ot2, status) => { const p = blank(); p[0] = id; p[2] = name; p[3] = "F9"; p[4] = "06:00"; p[6] = 9; p[12] = ot1; p[15] = ot2; p[16] = status || ""; return p; };
ey.push(person(2601001, "A", 2, 1.5));             // OT 3.5
ey.push(person(2601002, "B", 0, 0));               // ไม่มี OT
{ const c = person(2601003, "C (WY)", 4, 0); c[0] = ""; c[1] = "Support"; c[19] = "CI"; ey.push(c); }   // แถวซัพพอร์ตจาก WY (ID/Position = Support) → ไม่นับ OT
ey.push(person(2601004, "D", 6, 0, "OFF"));        // OT วันหยุด → OT_OFF
const wb = X.book({ MANPOWER: mp, EY: ey, ShiftDB: X.SHIFTDB });
const rows = (r, list) => r.batches.filter(b => b.list === list).flatMap(b => [...b.body.matchAll(/^\{.*\}$/gm)].map(m => JSON.parse(m[0])));
let bad = 0; const ok = (c, m) => { if (!c) bad++; console.log(c ? "OK " : "XX ", m); };

// วันธรรมดา (พฤ. 8 ต.ค. 2026)
let r = main(wb, "Shared Documents/2026/10.OCT26/08OCT.xlsx", "", "", JSON.stringify(["2026-10-13"]));
let m = rows(r, "PAS_Manpower")[0], o = rows(r, "PAS_OT_Person"), d = rows(r, "PAS_Duty");
ok(m.ot_hours === 9.5 && m.ot_hol_hours === 0 && m.ot_total === 9.5, "OT ทีม = 3.5 + 6 (ไม่รวมซัพพอร์ต 4) → " + m.ot_total);
ok(m.ot_people === 2 && m.ot_off_hours === 6 && m.month_key === "2026-10" && !m.is_holiday, "คนทำ OT 2 · OT วันหยุด 6 ชม.");
ok(o.length === 2 && o.every(x => x.week_key === "2026-10-05"), "OT รายคน 2 แถว · สัปดาห์เริ่มจันทร์ 5 ต.ค.");
ok(d.find(x => x.emp_name === "C").is_support === true && d.find(x => x.emp_name === "D").bucket === "OT_OFF", "ติดป้ายซัพพอร์ต / OT_OFF");

// วันหยุดประเพณี (13 ต.ค. วันนวมินทรมหาราช): คนที่มาทำงาน 9 ชม. = OT นักขัต 9
r = main(wb, "Shared Documents/2026/10.OCT26/13OCT.xlsx", "", "", JSON.stringify([{ day_key: "2026-10-13" }]));
m = rows(r, "PAS_Manpower")[0]; o = rows(r, "PAS_OT_Person");
ok(m.is_holiday && m.ot_hol_hours === 18 && m.ot_total === 27.5, "วันหยุด: นักขัต 9+9 (A,B) · ไม่นับซัพพอร์ต/คนหยุด → รวม " + m.ot_total);
ok(o.length === 3 && o.find(x => x.emp_code === "2601002").ot_total === 9, "B ไม่มี OT ปกติ แต่ได้ OT นักขัต 9 → มีแถว");
ok(rows(main(wb, "Shared Documents/2026/10.OCT26/13OCT.xlsx"), "PAS_Manpower")[0].ot_hol_hours === 0, "ไม่ส่ง holidays → ไม่มี OT นักขัต");
// สัปดาห์ข้ามเดือน: อา. 1 พ.ย. 2026 → จันทร์ 26 ต.ค.
r = main(wb, "Shared Documents/2026/11.NOV26/01NOV.xlsx");
ok(rows(r, "PAS_OT_Person")[0].week_key === "2026-10-26" && rows(r, "PAS_OT_Person")[0].month_key === "2026-11", "สัปดาห์ข้ามเดือน → week 2026-10-26 · month 2026-11");
// นับหัวรายวันสำหรับสรุปสัปดาห์: มาทำงาน/ป่วย/แวค/กิจ (ไม่นับซัพพอร์ต · 1 คน/ทีม)
const ey2 = [blank()].concat(X.header([{ code: "EY410" }]));
ey2.push(person(2602001, "W1", 0, 0), person(2602002, "W2", 0, 0, "OFF"), person(2602003, "S", 0, 0, "SICK"),
  person(2602004, "V", 0, 0, "AL"), person(2602005, "P", 0, 0, "ลากิจ"), person(2602006, "M", 0, 0, "ML"), person(2602007, "T", 0, 0, "TRAINING"),
  Object.assign(person(2602008, "SUP (WY)", 0, 0), { 0: "", 1: "Support", 19: "CI" }), person(2602009, "TH", 0, 0, "ลาป่วย"), person(2602010, "TV", 0, 0, "ลาพักร้อน"), person(2602001, "W1", 0, 0));
const wb2 = X.book({ MANPOWER: mp, EY: ey2, ShiftDB: X.SHIFTDB });
const c = rows(main(wb2, "Shared Documents/2026/10.OCT26/08OCT.xlsx"), "PAS_Manpower")[0];
ok(c.cnt_work === 1 && c.cnt_sick === 2 && c.cnt_vac === 2 && c.cnt_personal === 2 && c.cnt_training === 1,
  "หัวรายวัน: ทำงาน 1 (ซ้ำ/ซัพพอร์ตไม่นับ) · ป่วย 2 · แวค 2 · กิจ 2 (ลากิจ/ML) · อบรม 1 → " + [c.cnt_work, c.cnt_sick, c.cnt_vac, c.cnt_personal, c.cnt_training]);
ok(c.cnt_staff === 9 && c.cnt_off === 1 && c.cnt_ot_off === 0, "staff 9 (ไม่นับซัพพอร์ต/แถวซ้ำ) · OFF 1 → " + [c.cnt_staff, c.cnt_off, c.cnt_ot_off]);
ok(rows(main(wb, "Shared Documents/2026/10.OCT26/08OCT.xlsx"), "PAS_Manpower")[0].cnt_ot_off === 1, "OT_OFF นับแยก");
// สรุปรายวัน (กราฟ OT เทียบไฟลท์)
const ds = rows(main(wb, "Shared Documents/2026/10.OCT26/08OCT.xlsx"), "PAS_DayStats");
ok(ds.length === 1 && ds[0].Title === "2026-10-08" && ds[0].ot_total === 9.5 && ds[0].ot_people === 2 && ds[0].working === 3 && ds[0].flights === 1,
  "PAS_DayStats 1 แถว/วัน: OT 9.5 · คน OT 2 · ทำงาน 3 (รวม OT OFF · ไม่นับซัพพอร์ต) · ไฟลท์ 1 (EY410 จากแถวซัพพอร์ต) → " + JSON.stringify(ds[0]));
// ชม.รวม OT: 0.9999999 (=(OUT-IN)*24 ทศนิยมเพี้ยน) = 1 ชม. ไม่ใช่ 0.99999/24 · เศษวัน 0.0416 (=OUT-IN) = 1 ชม. · 0.5 (30 นาที) คงเดิม
const ey3 = [blank()].concat(X.header([{ code: "EY410" }]));
const p1 = person(3001001, "F1", "0.99999999999999911", 0); p1[10] = "07:00"; p1[11] = "08:00";
const p2 = person(3001002, "F2", 0, "0.041666666666666664"); p2[13] = "21:00"; p2[14] = "22:00";
const p3 = person(3001003, "F3", 0, "0.5"); p3[13] = "15:00"; p3[14] = "15:30";
ey3.push(p1, p2, p3);
const d3 = rows(main(X.book({ MANPOWER: mp, EY: ey3, ShiftDB: X.SHIFTDB }), "Shared Documents/2026/10.OCT26/09OCT.xlsx"), "PAS_Duty");
const oh = c => (d3.find(x => x.emp_code === String(c)) || {}).ot_hours;
ok(oh(3001001) === 1 && oh(3001002) === 1 && oh(3001003) === 0.5, "ชม.OT ตีความตามเวลาเข้า-ออก: 0.9999→1 · 1/24→1 · 0.5→0.5 → " + [oh(3001001), oh(3001002), oh(3001003)]);
console.log(bad ? bad + " FAILED" : "ALL PASSED"); process.exit(bad ? 1 : 0);
