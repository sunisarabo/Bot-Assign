// OT: ปกติ + นักขัต X1 · ไม่นับแถวซัพพอร์ต · แถวรายคน · สัปดาห์ จ.–อา.
const { main } = require(process.argv[2]);
const sheet = (name, rows) => ({ getName: () => name, getRange: () => ({ getValues: () => rows, getTexts: () => rows.map(r => r.map(x => String(x))) }), getUsedRange: () => ({ getValues: () => rows }) });
const W = 44, blank = () => Array(W).fill("");
const mp = [["MANPOWER"], ["Team (EY)", 4, 0, 0, 0, 0, 0, 0, 0, 3]];
const ey = [blank(), blank()]; ey[1][18] = "FLIGHT"; ey[1][19] = "EY410";
const person = (id, name, ot1, ot2, status) => { const p = blank(); p[0] = id; p[2] = name; p[4] = "06:00"; p[6] = 9; p[12] = ot1; p[15] = ot2; p[16] = status || ""; return p; };
ey.push(person(1001, "A", 2, 1.5));             // OT 3.5
ey.push(person(1002, "B", 0, 0));               // ไม่มี OT
ey.push(person(1003, "C (WY)", 4, 0));          // ซัพพอร์ตจาก WY → ไม่นับ OT
ey.push(person(1004, "D", 6, 0, "OFF"));        // OT วันหยุด → OT_OFF
const wb = { getWorksheet: n => ({ MANPOWER: sheet("MANPOWER", mp), EY: sheet("EY", ey) })[n], getWorksheets: () => [] };
const rows = (r, list) => r.batches.filter(b => b.list === list).flatMap(b => [...b.body.matchAll(/^\{.*\}$/gm)].map(m => JSON.parse(m[0])));
let bad = 0; const ok = (c, m) => { if (!c) bad++; console.log(c ? "OK " : "XX ", m); };

// วันธรรมดา (พฤ. 8 ต.ค. 2026)
let r = main(wb, "Shared Documents/2026/10.OCT26/08OCT.xlsx", "", "", JSON.stringify(["2026-10-13"]));
let m = rows(r, "PAS_Manpower")[0], o = rows(r, "PAS_OT_Person"), d = rows(r, "PAS_Duty");
ok(m.ot_hours === 9.5 && m.ot_hol_hours === 0 && m.ot_total === 9.5, "OT ทีม = 3.5 + 6 (ไม่รวมซัพพอร์ต 4) → " + m.ot_total);
ok(m.ot_people === 2 && m.ot_off_hours === 6 && m.month_key === "2026-10" && !m.is_holiday, "คนทำ OT 2 · OT วันหยุด 6 ชม.");
ok(o.length === 2 && o.every(x => x.week_key === "2026-10-05"), "OT รายคน 2 แถว · สัปดาห์เริ่มจันทร์ 5 ต.ค.");
ok(d.find(x => x.emp_code === "1003").is_support === true && d.find(x => x.emp_code === "1004").bucket === "OT_OFF", "ติดป้ายซัพพอร์ต / OT_OFF");

// วันหยุดประเพณี (13 ต.ค. วันนวมินทรมหาราช): คนที่มาทำงาน 9 ชม. = OT นักขัต 9
r = main(wb, "Shared Documents/2026/10.OCT26/13OCT.xlsx", "", "", JSON.stringify([{ day_key: "2026-10-13" }]));
m = rows(r, "PAS_Manpower")[0]; o = rows(r, "PAS_OT_Person");
ok(m.is_holiday && m.ot_hol_hours === 18 && m.ot_total === 27.5, "วันหยุด: นักขัต 9+9 (A,B) · ไม่นับซัพพอร์ต/คนหยุด → รวม " + m.ot_total);
ok(o.length === 3 && o.find(x => x.emp_code === "1002").ot_total === 9, "B ไม่มี OT ปกติ แต่ได้ OT นักขัต 9 → มีแถว");
ok(rows(main(wb, "Shared Documents/2026/10.OCT26/13OCT.xlsx"), "PAS_Manpower")[0].ot_hol_hours === 0, "ไม่ส่ง holidays → ไม่มี OT นักขัต");
// สัปดาห์ข้ามเดือน: อา. 1 พ.ย. 2026 → จันทร์ 26 ต.ค.
r = main(wb, "Shared Documents/2026/11.NOV26/01NOV.xlsx");
ok(rows(r, "PAS_OT_Person")[0].week_key === "2026-10-26" && rows(r, "PAS_OT_Person")[0].month_key === "2026-11", "สัปดาห์ข้ามเดือน → week 2026-10-26 · month 2026-11");
// นับหัวรายวันสำหรับสรุปสัปดาห์: มาทำงาน/ป่วย/แวค/กิจ (ไม่นับซัพพอร์ต · 1 คน/ทีม)
const ey2 = [blank(), blank()]; ey2[1][18] = "FLIGHT"; ey2[1][19] = "EY410";
ey2.push(person(2001, "W1", 0, 0), person(2002, "W2", 0, 0, "OFF"), person(2003, "S", 0, 0, "SICK"),
  person(2004, "V", 0, 0, "AL"), person(2005, "P", 0, 0, "ลากิจ"), person(2006, "M", 0, 0, "ML"), person(2007, "T", 0, 0, "TRAINING"),
  person(2008, "SUP (WY)", 0, 0), person(2009, "TH", 0, 0, "ลาป่วย"), person(2010, "TV", 0, 0, "ลาพักร้อน"), person(2001, "W1", 0, 0));
const wb2 = { getWorksheet: n => ({ MANPOWER: sheet("MANPOWER", mp), EY: sheet("EY", ey2) })[n], getWorksheets: () => [] };
const c = rows(main(wb2, "Shared Documents/2026/10.OCT26/08OCT.xlsx"), "PAS_Manpower")[0];
ok(c.cnt_work === 1 && c.cnt_sick === 2 && c.cnt_vac === 2 && c.cnt_personal === 2 && c.cnt_training === 1,
  "หัวรายวัน: ทำงาน 1 (ซ้ำ/ซัพพอร์ตไม่นับ) · ป่วย 2 · แวค 2 · กิจ 2 (ลากิจ/ML) · อบรม 1 → " + [c.cnt_work, c.cnt_sick, c.cnt_vac, c.cnt_personal, c.cnt_training]);
ok(c.cnt_staff === 9 && c.cnt_off === 1 && c.cnt_ot_off === 0, "staff 9 (ไม่นับซัพพอร์ต/แถวซ้ำ) · OFF 1 → " + [c.cnt_staff, c.cnt_off, c.cnt_ot_off]);
ok(rows(main(wb, "Shared Documents/2026/10.OCT26/08OCT.xlsx"), "PAS_Manpower")[0].cnt_ot_off === 1, "OT_OFF นับแยก");
// สรุปรายวัน (กราฟ OT เทียบไฟลท์)
const ds = rows(main(wb, "Shared Documents/2026/10.OCT26/08OCT.xlsx"), "PAS_DayStats");
ok(ds.length === 1 && ds[0].Title === "2026-10-08" && ds[0].ot_total === 9.5 && ds[0].ot_people === 2 && ds[0].working === 3 && ds[0].flights === 0,
  "PAS_DayStats 1 แถว/วัน: OT 9.5 · คน OT 2 · ทำงาน 3 (รวม OT OFF · ไม่นับซัพพอร์ต) · ไฟลท์ 0 → " + JSON.stringify(ds[0]));
console.log(bad ? bad + " FAILED" : "ALL PASSED"); process.exit(bad ? 1 : 0);
