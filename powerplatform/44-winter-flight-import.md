# 44 · นำเข้าตารางบินฤดูหนาว (PDF → flight master → รายวัน → pas_flight)

แปลง PDF ตารางบินฤดูหนาวภูเก็ต (ข้อมูลไฟลท์ที่คาดว่าจะบิน) เป็นข้อมูลพร้อมป้อนระบบ
สคริปต์: `tools/parse_winter_flights.py` (ใช้ `pdftotext -layout`)

## ไฟล์ต้นทาง (ฤดู 2569/2570 · 25 ต.ค. 2026 – 27 มี.ค. 2027)
- ระหว่างประเทศ (INTL) + ภายในประเทศ (DOM) อย่างละไฟล์ · (ปีก่อน 2568/2569 มีด้วย ใช้เทียบได้)

## 1) ทำตารางมาสเตอร์ (flight master)
```bash
python3 tools/parse_winter_flights.py INTL.pdf DOM.pdf -o winter_flight_master_2569-2570.csv
```
คอลัมน์: `scope`(INTL/DOM) · `season` · `iata` · `airline` · `arr_flight`(เช่น SU278) · `dep_flight`(SU279) · `route`(SVO-HKT-SVO) · `sta` · `std` · `days`(MTWHFSU) · `eff_from` · `eff_to` · `note`
- **289 variants** (แยกรอบ: 1 เที่ยวอาจมีหลายแถวตามเวลา/วันต่างกัน)
- รองรับ cell รวม (STA เดียว STD หลายค่า) + รอบที่พิมพ์เหนือบรรทัดเที่ยวบิน
- `days`: M=จ. T=อ. W=พ. H=พฤ. F=ศ. S=ส. U=อา. · DAILY = ครบ 7

## 2) ขยายรายวัน → movements (ป้อน pas_flight)
```bash
python3 tools/parse_winter_flights.py INTL.pdf DOM.pdf --expand --from 2026-11-01 --to 2026-11-30 -o pas_flight_2026-11.csv
```
- แตกตาม **วันบิน + ช่วง eff** → 1 เที่ยว = **ARR (ขาเข้า) + DEP (ขาออก)** ต่อวัน
- คอลัมน์: `pas_flightkey`(FlightNo_date) · `flight_date` · `iata` · `airline` · `flight_no` · `direction`(ARR/DEP) · `origin` · `dest` · `sta` · `std` · `scope`
- พ.ย. 2026 ≈ **9,067 movements** (~300/วัน · ARR ~150 + DEP ~150)

## 3) ป้อนเข้าระบบ
- **pas_flight (SharePoint list/Dataverse):** import CSV `pas_flight_<month>` (upsert key `pas_flightkey`)
  - ถ้าสคีมาเก็บเวลาเป็นนาที: แปลง `sta/std` (hh:mm → นาที) ตอน import/Dataflow
  - direction/origin/dest ใช้คัดงาน (เช็กอิน/เกท) ต่อทีม
- **generator:** ใช้แทน/เสริมไฟล์ตารางบินที่ `build_int_roster.py` อ่าน เพื่อวางแผน roster/assignment ฤดูหนาว
- **ตามทีม:** map `iata` → ทีม ด้วย `pas_teamairline` (ดู `gen_teamairline.py`) → รู้ว่าทีมไหนรับไฟลท์ไหน/วันไหน

## ข้อจำกัด/หมายเหตุ
- `eff` ว่างในบางแถว (หมายเหตุเป็น cell รวมคร่อมหลายเที่ยว) → ตอนขยายถือว่า "ไม่จำกัดช่วง" (รวมทุกวันที่ตรงวันบินในช่วงที่สั่ง) · ปกติอยู่ในฤดูอยู่แล้ว
- eff ซับซ้อน (หลายช่วง เช่น "26 OCT–18 DEC/1 FEB–28 MAR") → ใช้ **วันแรก–วันท้ายสุด** (อาจรวมช่วงเว้นกลางด้วย) — ถ้าต้องเป๊ะ ปรับ `note` รายเที่ยว
- PDF ไม่มี **อากาศยาน/เกท** → เว้นไว้ (เติมภายหลังได้)
- ขาออกข้ามเที่ยงคืน `+1` (เช่น 00:20+1) → บินวันถัดไป (เก็บ flag ไว้ในเวลา)
- ตรวจ spot-check แล้ว: SU278/279 (MON–SAT 09:55 + SUN 11:10), SU638 (WED+SUN), PG รายวัน — ตรงกับ PDF
