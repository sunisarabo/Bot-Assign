// import-othr.ts — ไฟล์ OT ทั้งปีงบ (ชีต ข้อมูลคำนวณ / พนักงานคำนวณ / ไฟลท์) → PAS_OTHR_*
// กติกาเทียบกับชีต "แดชบอร์ด" ของไฟล์จริง (ตรวจกับไฟล์ OCT25–SEP26 แล้ว: 12 เดือน · ประเภท · Code · แผนก · เกินเพดาน ตรงทุกตัว)
const assert = require("assert");
const { book } = require("./fakexl");
const M = require(process.argv[2]);
const ser = iso => Math.round(Date.parse(iso + "T00:00:00Z") / 86400000) + 25569;
const K15 = "โอทีก่อนเริ่มงาน / หลังเลิกงาน (x1.5)", KOFF = "โอทีวันหยุด (x1.0)", KHOL = "โอทีวันนักขัตฤกษ์ (x1.0)", K30 = "โอทีก่อนเริ่มงาน / หลังเลิกงาน วันหยุด (x3.0)";
const HEAD = ["วันที่", "วันที่ (พ.ศ.)", "รหัสพนักงาน", "ชื่อ-สกุล", "แผนก", "ทีม/ตำแหน่ง", "ประเภท OT", "อัตรา", "Code", "ชั่วโมง", "แหล่ง", "แถวต้นทาง"];
const row = (iso, emp, name, dept, team, kind, code, h) => [ser(iso), "", emp, name, dept, team, kind, 1, code, h, "PSA", 0];
function data(cHours) {
  const r = [HEAD,
    // A: สัปดาห์ 29 ก.ย.–5 ต.ค. (เริ่มก่อนข้อมูล → นับเป็น ต.ค.) = 38 ชม. → เกิน 36
    row("2025-10-01", "1000001", "ALPHA A.", "KP", "SQ/CX/LY", K15, "A2", 10),
    row("2025-10-02", "1000001", "ALPHA A.", "KP", "SQ/CX/LY", K15, "A2", 10),
    row("2025-10-03", "1000001", "ALPHA A.", "KP", "SQ/CX/LY", K15, "A2", 10),
    row("2025-10-05", "1000001", "ALPHA A.", "KP", "SQ/CX/LY", KHOL, "A1", 8),
    // B (LL ใช้ตำแหน่ง → ทีม LL): สัปดาห์ 27 ต.ค.–2 พ.ย. ข้ามเดือน = 39 → เกิน 36 (นับเป็น ต.ค.)
    row("2025-10-31", "1000002", "BRAVO B.", "LL", "เจ้าหน้าที่บริการสัมภาระ / สถานที่ทำงาน : ท่าอากาศยานภูเก็ต", K30, "A3", 5),
    row("2025-11-01", "1000002", "BRAVO B.", "LL", "เจ้าหน้าที่บริการสัมภาระ", KOFF, "A7", 4),
    row("2025-11-02", "1000002", "BRAVO B.", "LL", "เจ้าหน้าที่บริการสัมภาระ", KOFF, "A7", 30)];
  // C (LP): 3–12 พ.ย. วันละ 15 = 150 → เกิน 144/เดือน
  for (let d = 3; d <= 12; d++) r.push(row("2025-11-" + String(d).padStart(2, "0"), "1000003", "CHARLIE C.", "LP", "PORTER", K15, "A2", d === 12 ? cHours : 15));
  return r;
}
const EMPS = [["รหัสพนักงาน", "ชื่อ-สกุล", "แผนก", "กลุ่ม", "ตำแหน่ง", "วันเริ่มงาน", "วันพ้นสภาพ", "Function เดิม"],
  ["1000001", "ALPHA A.", "KP", "HKT", "x", ser("2020-01-01"), "", "KP"],
  ["1000002", "BRAVO B.", "LL", "HKT", "x", ser("2025-10-15"), "", "LL"],
  ["1000003", "CHARLIE C.", "LP", "HKT", "x", ser("2019-01-01"), ser("2025-11-20"), "LP"],
  ["1000004", "DELTA D.", "KP", "HKT", "x", ser("2025-11-30"), ser("2025-11-30"), "KP"]];
const FLT = [["วันที่", "จำนวนไฟลท์"], [ser("2025-10-01"), 70], [ser("2025-10-02"), 72]];
const CHK = [["หัวข้อ", "ค่า"], ["อัปเดตข้อมูลเมื่อ", "9 ต.ค. 2569"]];
const wb = c => book({ "ข้อมูลคำนวณ": data(c), "พนักงานคำนวณ": EMPS, "ไฟลท์": FLT, "ตรวจข้อมูล": CHK });
const rowsOf = (r, l) => r.batches.filter(b => b.list === l).flatMap(b => [...b.body.matchAll(/^\{.*\}$/gm)].map(m => JSON.parse(m[0])));
const sigsOf = r => JSON.stringify(rowsOf(r, "PAS_OTHR_Month").filter(x => x.dept === "ALL").map(x => ({ Title: x.Title, sig: x.sig })));

const r = M.main(wb(15), "", "", "OT.xlsx");
assert.strictEqual(r.status, "ok"); assert.deepStrictEqual(r.months, ["2025-10", "2025-11"]); assert.strictEqual(r.more, false);
assert.strictEqual(r.updated, "9 ต.ค. 2569");
const mon = {}; for (const x of rowsOf(r, "PAS_OTHR_Month")) mon[x.Title] = x;
const o = mon["2025-10|ALL"], n = mon["2025-11|ALL"];
assert.deepStrictEqual([o.hours, o.cnt, o.people, o.h_t15, o.h_hol, o.h_t30, o.h_off], [43, 5, 2, 30, 8, 5, 0]);
assert.deepStrictEqual([n.hours, n.cnt, n.people, n.h_off, n.h_t15], [184, 12, 2, 34, 150]);
assert.deepStrictEqual([o.flights, o.flight_days, n.flights], [142, 2, 0]);
// กำลังพล ณ สิ้นเดือน: ต.ค. A B C = 3 (B เข้าใหม่) · พ.ย. C ออก 20 พ.ย. · D เข้าและออกวันสิ้นเดือน (ไม่นับ ณ สิ้นเดือน)
assert.deepStrictEqual([o.headcount, o.new_hires, o.resigned], [3, 1, 0]);
assert.deepStrictEqual([n.headcount, n.new_hires, n.resigned], [2, 1, 2]);
assert.deepStrictEqual([mon["2025-11|LP"].headcount, mon["2025-11|LP"].resigned, mon["2025-10|LL"].hours], [0, 1, 5]);
assert.deepStrictEqual(JSON.parse(o.codes_json), [{ c: "A1", h: 8, n: 1, p: 1 }, { c: "A2", h: 30, n: 3, p: 1 }, { c: "A3", h: 5, n: 1, p: 1 }]);
assert.deepStrictEqual(JSON.parse(o.types_json), [{ t: "t15", h: 30, n: 3, p: 1 }, { t: "hol", h: 8, n: 1, p: 1 }, { t: "t30", h: 5, n: 1, p: 1 }]);
assert.deepStrictEqual([o.over36_people, o.over36_times, n.over144_people, n.over36_times], [2, 2, 1, 2]);
const ov = rowsOf(r, "PAS_OTHR_Over").map(x => x.kind + "|" + x.period_key + "|" + x.emp_code + "|" + x.month_key + "|" + x.hours);
assert.deepStrictEqual(ov.sort(), ["month|2025-11|1000003|2025-11|150", "week|2025-09-29|1000001|2025-10|38", "week|2025-10-27|1000002|2025-10|39",
  "week|2025-11-03|1000003|2025-11|105", "week|2025-11-10|1000003|2025-11|45"]);
assert.strictEqual(rowsOf(r, "PAS_OTHR_Over").find(x => x.period_key === "2025-09-29").period_label, "29 ก.ย. 68 – 5 ต.ค. 68");
const day = rowsOf(r, "PAS_OTHR_Day");
assert.ok(day.some(x => x.Title === "2025-10-31|LL|LL" && x.h_t30 === 5 && x.week_key === "2025-10-27"));
const per = rowsOf(r, "PAS_OTHR_Person").find(x => x.Title === "2025-10|1000001");
assert.deepStrictEqual([per.hours, per.days, per.max_week, per.team, per.over_month], [38, 4, 38, "SQ/CX/LY"]
  .concat([false]));
console.log("OK สรุปเดือน · ประเภท/Code · กำลังพล · ไฟลท์ · เกินเพดาน (สัปดาห์ข้ามเดือน) · ทีม LL");

// นำเข้าซ้ำ: ไม่มีอะไรเปลี่ยน → ไม่เขียน
const sig = sigsOf(r);
const r2 = M.main(wb(15), sig, "", "OT.xlsx");
assert.deepStrictEqual([r2.months, r2.batches.length, r2.counts.changed], [[], 0, 0]);
// แก้แค่ 12 พ.ย. → ทำใหม่เฉพาะ พ.ย.
const r3 = M.main(wb(16), sig, "", "OT.xlsx");
assert.deepStrictEqual(r3.months, ["2025-11"]);
// เดือนนอกช่วงของไฟล์ (ปีงบอื่น) ไม่แตะ · แบ่งรอบด้วย maxRows
const r4 = M.main(wb(15), JSON.stringify([{ Title: "2025-09|ALL", sig: "x" }]), "", "OT.xlsx", 1);
assert.deepStrictEqual([r4.months, r4.more, r4.pending], [["2025-10"], true, 1]);
// เดือนในช่วงที่ไม่มีรายการแล้ว → ลบ
const r5 = M.main(wb(15), JSON.stringify([{ Title: "2025-10|ALL", sig: "x" }, { Title: "2025-11|ALL", sig: "x" }, { Title: "2025-10-x|ALL", sig: "" }]), "", "OT.xlsx");
assert.ok(r5.months.indexOf("2025-10-x") >= 0);
console.log("OK นำเข้าเฉพาะเดือนที่เปลี่ยน · ไม่แตะปีงบอื่น · แบ่งรอบ");
console.log("ALL PASSED (import-othr)");
