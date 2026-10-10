# หน้า 🩺 ตรวจข้อมูล (Power Apps) — แทนหน้าเดิมของ PAS

หน้าเดิม (`rbDataCheckHtml`) ตรวจไฟล์เวรของวันที่เลือก แล้วบอก "จุดที่ควรแก้ในชีต"
ระบบใหม่ตรวจ **ตอนนำเข้า** (`import-roster.ts`) แล้วเก็บผลใน List `PAS_DataIssue` → หน้านี้แค่แสดง (เปิดเร็ว)
**แก้ไฟล์เวรแล้ว** → Flow A/B นำเข้าใหม่เองใน ~25 นาที → จุดที่แก้แล้วหายจากหน้านี้เอง (ไม่ต้องกดอะไร)

## รายการตรวจ
| หมวด (`category`) | ชื่อบนหน้า | เดิม | ตรวจอะไร |
|---|---|---|---|
| `droptab` | 🛑 แท็บอ่านไม่ได้ (หายทั้งทีม) | ✅ | MANPOWER มีทีมแต่ไม่มีแท็บชื่อนั้น · หรือแท็บไม่มีแถวพนักงานที่อ่านได้ |
| `dupblock` | 👥 บล็อกซ้อนซ้ำในแท็บ | ✅ | รหัสเดียวกันอยู่ 2 แถวในแท็บเดียว |
| `staledate` | 📅 แท็บวันที่ไม่ตรงกัน | ✅ | วันที่บนหัวแท็บ (เช่น 29/JUN) ต่างจากทีมส่วนใหญ่ |
| `offflt` | 🚫 เขียน OFF แต่มีไฟลท์ | ✅ | สถานะหยุด แต่มีงานในช่องไฟลท์ |
| `noshift` | ⏰ มาทำงานแต่อ่านเวลากะไม่ได้ | ✅ | มาทำงาน + มีไฟลท์ แต่ช่องเวลาเข้า (E) อ่านไม่ได้ |
| `flttime` | ✈️ ไฟลท์ขาด STA/STD | ✅ | หัวไฟลท์ไม่มีทั้ง STA/STD/OP/CL |
| `supnoteam` | 🤝 แถวซัพไม่มีทีมต้นสังกัด | ✅ | แถวซัพพอร์ตที่หาทีมไม่เจอทั้งจากเวรวันนั้นและรายชื่อพนักงาน |
| `dupteam` | 👯 รหัสซ้ำหลายทีม | (ไม่เกิดแล้ว) | เหมือนระบบเดิม: รหัสซ้ำหลายทีม → เก็บที่ต้นสังกัด อีกทีมกลายเป็นแถวซัพ "ซัพจาก …" อัตโนมัติ |
| `dupname` | 📋 ชื่อซ้ำในทีม | ✅ | ชื่อเดียวกัน 2 แถวในทีม |
| `notfilled` | 📝 ทีมยังลง assignment ไม่ครบ | ✅ (อีเมลเตือน) | มีคนในแท็บที่ไม่มีทั้งสถานะและงาน (ทีมสแตนด์บาย: มีกะก็พอ) — ใช้ส่งอีเมลเตือนล่วงหน้า 7 วัน (`FLOW-notify.md`) |
| `filedate` | 🗓️ วันที่ไฟล์ไม่ตรงหัวชีต | ใหม่ | ชื่อไฟล์/โฟลเดอร์บอกวันหนึ่ง แต่หัว MANPOWER เป็นอีกวัน (วางไฟล์ผิดวัน/ลืมแก้หัว) |
| (จาก `PAS_ImportLog`) | ⚠️ นำเข้าไม่สำเร็จ | ใหม่ | ไฟล์ที่สถานะ Error / Skipped |
| (จากปฏิทิน) | 📭 วันที่ไม่มีไฟล์เวร | ใหม่ | วันที่ผ่านมาแล้วในเดือนนี้ แต่ยังไม่มีข้อมูล |
| (จาก `PAS_Employees`) | 🧑‍💼 ในเวรแต่ไม่มีในรายชื่อ | ใหม่ | รหัสในเวรวันนี้ที่ไม่มีในไฟล์ Manpower (เดิมเป็นข้อความเตือนใน Dashboard) |

> ยังไม่ครอบคลุม "🤝 ซัพพอร์ตไม่ระบุทีม" ของเดิม — ระบบใหม่จำแถวซัพพอร์ตจากรูปแบบ `ชื่อ (ทีม)` เท่านั้น แถวที่ไม่มีวงเล็บจึงนับเป็นคนของทีมนั้น (ถ้าเป็นคนทีมอื่นจะขึ้นใน 👯 รหัสซ้ำหลายทีมแทน)

## เปิดใช้
1. รัน `provision-lists.js` ล่าสุด (เพิ่ม List `PAS_DataIssue`)
2. วาง `import-roster.ts` ใหม่ทับใน Excel
3. Flow B: ข้อ 3a ลบของวันเดิม **5 รอบ** (เพิ่ม `PAS_DataIssue`) — ดู `FLOW-import.md`
4. Power Apps: Add data → `PAS_DataIssue`

## 1) ปุ่มเมนู + โหลด
ปุ่มเมนู: `Set(varTab, "dc"); Select(btnLoadDc)` · container `Visible = varTab = "dc"` · ต่อท้าย `dpDay.OnChange`: `If(varTab = "dc", Select(btnLoadDc))`

**`btnLoadDc.OnSelect`**
```powerapps
ClearCollect(colIssue, Filter(PAS_DataIssue, day_key = varDay));
// นำเข้าไม่สำเร็จ (ไฟล์ของวันนี้ + ค้างทั้งหมด)
ClearCollect(colImpErr, Filter(PAS_ImportLog, status.Value = "Error" || (status.Value = "Skipped" && day_key = varDay)));
// วันที่ไม่มีไฟล์เวร (1 → เมื่อวานของเดือนที่เลือก)
With({m1: Date(Value(Left(varDay, 4)), Value(Mid(varDay, 6, 2)), 1)},
    With({has: ShowColumns(Filter(PAS_Manpower, month_key = Text(m1, "yyyy-mm")), day_key)},
        ClearCollect(colNoFile,
            Filter(
                ForAll(Sequence(Day(EOMonth(m1, 0)), 0) As i,
                    With({dt: DateAdd(m1, i.Value, TimeUnit.Days)},
                        {k: Text(dt, "yyyy-mm-dd"), lbl: Text(dt, "d mmm"), past: dt < Today()})),
                past && IsBlank(LookUp(has, day_key = k))))));
// ในเวรแต่ไม่มีในรายชื่อ (ไม่นับแถวซัพพอร์ต)
ClearCollect(colNotInMaster,
    Filter(colDuty, !is_support && IsBlank(LookUp(colEmp, Title = emp_code))))
```
> `colDuty` (เวรวันที่เลือก) และ `colEmp` (รายชื่อ ACTIVE) โหลดไว้แล้วจาก `btnLoad` / `App.OnStart` — ถ้าอยากเทียบกับทุกสถานะ ให้ใช้ `PAS_Employees` แทน `colEmp` (แต่ระวังเพดาน 2,000)

## 2) ตารางนิยามหมวด (App.OnStart — เพิ่ม)
```powerapps
ClearCollect(colDcDef,
    {k: "droptab",   t: "🛑 แท็บอ่านไม่ได้ (หายทั้งทีม)",     hint: "แท็บมีข้อมูลแต่อ่านไม่ออก/ไม่มีแท็บ — ทั้งทีมหายจากยอดและ SLA"},
    {k: "dupblock",  t: "👥 บล็อกซ้อนซ้ำในแท็บ",              hint: "ลบบล็อกซ้ำเพื่อกันข้อมูลตกหล่น/นับซ้ำ"},
    {k: "staledate", t: "📅 แท็บวันที่ไม่ตรงกัน",              hint: "อาจลืมอัปเดตแท็บ (ข้อมูลทั้งทีมเป็นของวันเก่า)"},
    {k: "filedate",  t: "🗓️ วันที่ไฟล์ไม่ตรงหัวชีต",            hint: "ตรวจว่าวางไฟล์ถูกโฟลเดอร์/ชื่อวัน หรือหัว MANPOWER ลืมเปลี่ยน"},
    {k: "offflt",    t: "🚫 เขียน OFF แต่มีไฟลท์",             hint: "นับเป็นไม่มาทำงานทั้งที่นั่งไฟลท์อยู่"},
    {k: "noshift",   t: "⏰ มาทำงานแต่อ่านเวลากะไม่ได้",        hint: "ลืมกรอกเวลาเข้า → ชั่วโมง/Util/ครอบคลุมไฟลท์เพี้ยน"},
    {k: "supnoteam", t: "🤝 แถวซัพไม่มีทีมต้นสังกัด",         hint: "ใส่ \"ชื่อ + รหัสทีม\" เช่น \"สมชาย PVT\""},
    {k: "flttime",   t: "✈️ ไฟลท์ขาด STA/STD",                 hint: "เติมเวลาในชีต ไม่งั้นเช็ค SLA / หาคนช่วยไม่ได้"},
    {k: "dupteam",   t: "👯 รหัสซ้ำหลายทีม",                    hint: "คนเดียวอยู่ 2 ทีม = นับซ้ำ · คนไปช่วยให้ใช้แถว ชื่อ (ทีม)"},
    {k: "dupname",   t: "📋 ชื่อซ้ำในทีม",                      hint: "ตรวจว่ากรอกชื่อซ้ำหรือเป็นคนละคน"},
    {k: "notfilled", t: "📝 ทีมยังลง assignment ไม่ครบ",        hint: "คนในแท็บยังไม่มีสถานะและไม่มีงาน — กรอกให้ครบก่อนวันทำงาน"})
```

## 3) แถบสรุปบนสุด
```powerapps
With({n: CountRows(colIssue) + CountRows(colImpErr) + CountRows(colNoFile) + CountRows(colNotInMaster)},
    "🩺 ตรวจข้อมูล · " & If(n > 0, "พบ " & n & " จุดที่ควรแก้", "ไม่พบปัญหา — ข้อมูลครบถูกต้อง ✅") & "   (แก้ที่ไฟล์ต้นทาง ระบบนำเข้าใหม่เองใน ~25 นาที)")
```
พื้น: `If(n > 0, ColorValue("#fff4e6"), ColorValue("#e8f5e9"))` · ขอบซ้าย: `If(n > 0, ColorValue("#f59e0b"), ColorValue("#16a34a"))`

## 4) การ์ดตามหมวด — Gallery แนวตั้ง `galDcCat`
```powerapps
Filter(AddColumns(colDcDef, rows, Filter(colIssue, category.Value = k), n, CountRows(Filter(colIssue, category.Value = k))), n > 0)
```
ในแต่ละการ์ด:
- หัว: `ThisItem.t & "  (" & ThisItem.n & ")"` · คำแนะนำ: `ThisItem.hint` (ตัวเล็ก สีเทา)
- Gallery ซ้อน `Items = ThisItem.rows` · 3 คอลัมน์: `team` · `who` (ตัวหนา) · `detail`
- ความสูงการ์ด: `60 + 34 * ThisItem.n` (หรือใช้ Flexible height gallery)

**การ์ดพิเศษ (ใต้ gallery):**
| การ์ด | Visible | รายการ |
|---|---|---|
| ⚠️ นำเข้าไม่สำเร็จ | `!IsEmpty(colImpErr)` | `file_name` · `status.Value` · `message` |
| 📭 วันที่ไม่มีไฟล์เวร | `!IsEmpty(colNoFile)` | `Concat(colNoFile, lbl, " · ")` + คำแนะนำ "ตรวจว่ามีไฟล์ในโฟลเดอร์เดือน หรือกด Flow C" |
| 🧑‍💼 ในเวรแต่ไม่มีในรายชื่อ | `!IsEmpty(colNotInMaster)` | `team` · `emp_code` · `emp_name` + คำแนะนำ "เพิ่มในไฟล์ Manpower หรือแก้รหัสในเวร" |

ถ้าไม่มีอะไรเลย: Label `"✅ ทุกทีมข้อมูลครบ ไม่พบจุดที่ต้องแก้"` · `Visible = IsEmpty(colIssue) && IsEmpty(colImpErr) && IsEmpty(colNoFile) && IsEmpty(colNotInMaster)`

## 5) ส่งต่อให้ทีมแก้
ปุ่ม 📋 คัดลอก:
```powerapps
Copy("🩺 ตรวจข้อมูล " & varDay & Char(10) &
    Concat(colIssue, "• [" & team & "] " & who & " — " & detail, Char(10)))
```
(วางใน Teams/LINE กลุ่มหัวหน้าทีมได้เลย)

## ตรวจว่าตรงกับ PAS เดิม
เลือกวันเดียวกัน → จำนวนต่อหมวดควรใกล้เคียงกัน
- ระบบใหม่ **มากกว่า** ใน `noshift`/`offflt` → เดิมอ่านเวลา/ไฟลท์จากหัวคอลัมน์ ใหม่อ่านตามตำแหน่งมาตรฐาน — ส่งชื่อทีมมา จะปรับให้
- ระบบใหม่ **ไม่มี** `droptab` ของทีมที่เดิมมี → ดีขึ้น (ไม่ต้องทำอะไร) หรือทีมนั้นไม่มีใน MANPOWER (ตรวจ MANPOWER)
