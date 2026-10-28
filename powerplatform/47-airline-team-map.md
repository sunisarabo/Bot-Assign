# 47 · map สายการบิน ↔ ทีม (ชุดเดียว · ยืนยันแล้ว)

รวม `build_int_roster.TEAMS` และ `gen_teamairline.TEAM_AIRLINES` ให้ **ตรงกันเป็นชุดเดียว**
**ในประเทศ (FD/VZ/SL/TG/DD) = ไม่ให้บริการ** (ภาพรวมเท่านั้น · ไม่จัดทีม/ไม่นับ sizing)
> ไฟล์: `tools/pas_teamairline.csv` (81 แถว · import เข้า `pas_teamairline`)

## ทีมที่ให้บริการ (14 ทีม)
| ทีม | สายการบิน (IATA) |
|---|---|
| EY | EY · DV · AY |
| QR | QR · MH · DE · OM |
| EK | UO · EK · FY · 6B · BY · KU |
| SQ | SQ · CX · LY · IZ |
| TK | OD · VJ · SG · HY · TK · N0 · VN |
| JQ | JQ · AI · IX · IT · VS |
| KE | KC · KE · OZ · NO · AF · LJ · OV |
| SU | SU · W5 · B2 |
| AK | AK · QZ · 8M |
| TR | TR · 6E · QP · 3K |
| PG | PG |
| WY/WK | WY · WK · G9 · 9C · DK · SV · KA |
| CHN | CA · 3U · MU · FM · HU · HO · HX · AQ · CZ · ZH · PN · 9H · OQ · BK · GX · MF |
| ZF (เช่าเหมา/charter) | ZF · LO · HH · EO · N4 · G2 · H4 · S7 · C6 · WZ · HB |

## ไม่ให้บริการ (ภาพรวม)
**FD** (Thai AirAsia) · **VZ** (Thai Vietjet) · **SL** (Thai Lion) · **TG** (Thai Airways) · **DD** (Nok)
→ แสดงรวมในภาพรวมสนามบิน แต่ไม่จัดคน/ไม่นับโหลดทีม

## ผลกับฤดูหนาว 2569/2570 (48,232 movements)
- **ให้บริการ 29,118** · ไม่ให้บริการ 19,114
- ต่อทีม: PG 4,956 · CHN 4,806 · SQ 2,508 · QR 2,192 · EY 2,034 · AK 1,718 · SU 1,670 · TK 1,656 · WY/WK 1,628 · EK 1,546 · TR 1,540 · KE 1,270 · JQ 1,030 · ZF 564

## แก้/ซิงค์
- แก้ที่ `tools/gen_teamairline.py` (`TEAM_AIRLINES` + `NOT_SERVICED`) — ต้อง **ตรงกับ** `tools/build_int_roster.py` (`TEAMS` + `NOT_SERVICED`)
- รีเจน: `python3 tools/gen_teamairline.py -o pas_teamairline.csv` → import ทับ `pas_teamairline`
- ถ้ารับบริการสายในประเทศ/เพิ่มทีมภายหลัง → ย้ายจาก NOT_SERVICED เข้าทีมทั้ง 2 ไฟล์ แล้วรีเจน
