# 12 · ตารางสรุป OT รายวัน + ดึงทั้งเดือนแบบเบา

แทนการดึง OT จริง raw ทั้งเดือน (~4,000 แถว) → สร้าง **ตารางสรุป 1 แถว/วัน/แผนก** ไว้ในไฟล์ OT รวม
แล้ว flow ดึงเฉพาะเดือนที่ต้องการ (เดือนละ ~100 แถว) เบาและเร็ว

## ขั้น 1 — สร้างตารางสรุป (Office Script)
1. เปิดไฟล์ OT รวมใน Excel Online → **Automate → New Script** → วาง **`office-script-ot-daily-summary.ts`** → **Run**
2. ได้ชีต/Table ใหม่ชื่อ **`OTDailySummary`**:

| DateKey | DateTH | Dept | People | Cases | Hours | Hrs_x1_5 | Hrs_x1_0 | Hrs_x3_0 |
|---|---|---|---|---|---|---|---|---|
| 2026-09-26 | 26 ก.ย. 69 | KP | 114 | 121 | 428 | … | … | … |
| 2026-09-26 | 26 ก.ย. 69 | LP | 8 | 8 | 32.5 | … | … | … |
| 2026-09-26 | 26 ก.ย. 69 | **ALL** | 131 | 138 | 490.5 | … | … | … |

- 1 แถว/วัน/แผนก (KP/LP/LL) + แถว **ALL** รวมทั้งวัน
- `DateKey` เป็น **ข้อความ** `yyyy-mm-dd` → filter ใน flow ได้ตรง
- รันซ้ำได้ (ลบ/สร้างใหม่ทุกครั้ง) · ตั้ง Power Automate รันทุกคืนให้สดได้

## ขั้น 2 — Flow `GetOTSummary` (ดึงช่วง/เดือน แบบเบา)
เหมือน `GetActualOTRange` (ข้อ 11) แต่ชี้ Table **`OTDailySummary`**:
- Trigger: PowerApps(V2) · input `DateKey`, `DateKeyEnd`
- Excel List rows · Table `OTDailySummary` · Filter `DateKey ge '<DateKey>' and DateKey le '<DateKeyEnd>'`
- Select → `{ date, dept, people, cases, hours, h15, h10, h30 }`
- Respond text `rows` = `string(body('Select'))`

> ทั้งเดือน = ~90-120 แถว → payload เล็ก ส่งกลับสบาย (ไม่ต้องกลัวลิมิตเหมือนดึง raw)

## ขั้น 3 — Power Fx ใช้งาน
```powerapps
Set(varResp, GetOTSummary.Run(Text(varFrom,"yyyy-mm-dd"), Text(varTo,"yyyy-mm-dd")));
ClearCollect(colSum,
    ForAll(Table(ParseJSON(varResp.rows)), {
        date: Text(ThisRecord.date), dept: Text(ThisRecord.dept),
        people: Value(ThisRecord.people), cases: Value(ThisRecord.cases),
        hours: Value(ThisRecord.hours)
    })
);
// แนวโน้มรายวัน (ใช้แถว ALL):  Filter(colSum, dept="ALL")  → กราฟ X=date Y=hours
// ยอดรวมเดือน:  Sum(Filter(colSum, dept="ALL"), hours) & " ชม."
// แยกแผนก:  Filter(colSum, dept="KP")
```

## เลือกใช้อันไหน
| ต้องการ | ใช้ |
|---|---|
| OT จริงรายคน (เทียบแผน) 1 วัน | `GetActualOT` (ข้อ 10) — raw วันเดียว |
| OT รายคน ช่วงสั้น (≤2 สัปดาห์) | `GetActualOTRange` (ข้อ 11) — raw ช่วง |
| ภาพรวม/แนวโน้มทั้งเดือน-หลายเดือน | **`GetOTSummary` + ตารางนี้** — เบาสุด |
