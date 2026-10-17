# 24 · ใช้ "คน/ไฟลท์จริง" + "เวลาเริ่มกะจริง" (A + B)

สกัดจากไฟล์วิเคราะห์การจัดพนักงาน (JAN–OCT 69) ด้วย `tools/extract_staffing.py`:
```bash
python3 tools/extract_staffing.py  ANALYSIS_JAN-OCT.xlsx   # → tools/flight_manning.csv + shift_templates.csv
```

## A · คน/ไฟลท์จริง แยกเฟส (`flight_manning.csv`) — เสียบ generator แล้ว ✅
`Team,CI,GATE,ARR` = ค่าเฉลี่ยจริงต่อไฟลท์ (จาก "มาตรฐานไฟลท์") · **แทน SLA_RQ ประมาณการ**
`build_int_roster.py → phase_weights()` ใช้ค่านี้ก่อน (ทีมที่ไม่มี เช่น ZF/DOM = fallback SLA)

| ทีม | CI | GATE | ARR | รวม |
|---|---|---|---|---|
| QR | 5.7 | 5.8 | 1.9 | 13.4 |
| WY/WK | 4.5 | 8.8 | 2.4 | 15.7 |
| EK | 4.5 | 5.5 | 2.1 | 12.2 |
| CHN | 3.2 | 6.7 | 1.1 | 11.1 |
| AK | 1.3 | 6.3 | 0.7 | 8.3 |

**ผลหลัง regen:** sizing แม่นขึ้น · residual ขาดเหลือแค่ **TK/JQ** (ขาดจริงตาม manning จริง — ควรเพิ่มคน/ซัพ) · ทีมอื่นพอ

## B · เวลาเริ่มกะจริงต่อทีม (`shift_templates.csv`)
`Team,Period,StartHour,LenHrs,People` = กะที่ IP แนะนำ (คลุม demand รายชม. ด้วยคนน้อยสุด)
ตัวอย่าง (ต.ค.):
- **CHN:** 06:00+12h×8 · 11:00+12h×9 · 12:00+12h×17 · 15:00+10h×5 · 16:00+8h×11
- **QR:** 05:00+8h×24 · 13:00+10h×11
- **SQ:** 05:00+8h×7 · 06:00+12h×5 · 08:00+12h×15 · 16:00+8h×5

### เอาไปใช้ 3 ทาง
1. **แคตตาล็อกกะใน Dataverse** (`pas_shift_template`: Team·StartHour·LenHrs·People) → import `shift_templates.csv` → หน้า Roster/Assignment เลือกกะจริงต่อทีม (แทน M/A/N ตายตัว) · โชว์เวลาเริ่มจริง
2. **ปรับ `BANDS`/`SHIFT_TIME` ต่อทีม** ใน generator — เปลี่ยนจาก M/A/N 3 ช่วงคงที่ เป็น "ช่วงกะตามทีม" → roster ลงกะตรงกับที่จัดจริง
3. **ตรวจความพอดี** — เทียบ demand รายชม. (จาก flight_work_intervals) กับคนในกะ → ชม.ไหนขาด = OT/pool

> **หมายเหตุ:** ตอนนี้ roster ยังใช้กะ M/A/N (05-14 · 13-22 · 21-06) ที่ map ง่าย — การทำให้ generator ลงกะ "ตาม template ต่อทีม" (แบบ B เต็มรูป) เป็น refactor ก้อนใหญ่ (ลง people ต่อ start-time ต่อทีม) · ข้อมูลพร้อมแล้ว ทำต่อได้เมื่อพร้อม

## สรุป
- **A ทำแล้ว** (sizing ใช้คน/ไฟลท์จริง) → เลขทีม/วันแม่นขึ้น เห็นทีมขาดจริง (TK/JQ)
- **B มีข้อมูลพร้อม** (`shift_templates.csv`) → เลือกใช้เป็นแคตตาล็อกกะ หรือต่อ generator เต็มรูปภายหลัง
