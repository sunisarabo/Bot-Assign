# Flow I — อีเมลเตือน "ทีมยังลง Assignment ไม่ครบ" (ล่วงหน้า 7 วัน)

แทน `apNotifyMissingAssignments` / `apSetupMissingNotify` (AdvancePlan.gs) ที่ส่งเมลจาก Apps Script ทุกวัน 09:00

| | ของเดิม (Google) | ของใหม่ (Microsoft) |
|---|---|---|
| ตรวจ | เปิดไฟล์เวร 7 วันข้างหน้าทุกเช้า แล้วนับรายแท็บ | ตรวจ **ตอนนำเข้าไฟล์เวร** (Flow A/B) → `PAS_DataIssue` หมวด `notfilled` · ทีมกรอกเพิ่มในไฟล์ → นำเข้าใหม่เอง (~25 นาที) |
| กติกา | คนในแท็บ (รหัส 6–8 หลัก) ต้องมี **สถานะ** หรือ **งานในคอลัมน์ไฟลท์** · ทีมสแตนด์บาย (CHARTER/ZF/PVT/LP/STBY) มีกะก็พอ · ข้าม Porter/Crewsign/Admin Doc | เหมือนเดิม — `test/notfilled-parity.test.js` เทียบกับ `apTeamsNotFilled_` ตัวจริง **ตรงทุกทีม** |
| ไม่มีไฟล์ของวันนั้น | ❌ ยังไม่มีไฟล์เวร | เหมือนเดิม (ดูจาก `PAS_Manpower` ของวันนั้น) |
| ส่ง | GmailApp จาก `hktadminpsa@aotga.com` ถึง `hktadminpsa@` + `dutyhkt@` | **Office 365 Outlook** (ตัวต่อมาตรฐาน) — จาก shared mailbox เดิมได้ |
| ไม่มีอะไรค้าง | ไม่ส่ง (กันสแปม) | ไม่ส่ง |

> ข้อต่างเล็กน้อย: ของเดิมตรวจ **ทุกแท็บ** ที่มีหัว ID/NAME ส่วนของใหม่ตรวจเฉพาะทีมที่อยู่ใน MANPOWER (แท็บที่ไม่อยู่ใน MANPOWER จะขึ้นในหน้า 🩺 ตรวจข้อมูลแทน)

## ก่อนเริ่ม
1. รัน `provision-lists.js` ล่าสุด (เพิ่มหมวด `notfilled` ใน `PAS_DataIssue`)
2. วาง `import-roster.ts` ใหม่ทับใน Office Scripts
3. ไฟล์เวรล่วงหน้าที่วางไว้แล้ว → กด **Flow C** ที่โฟลเดอร์เดือนนี้/เดือนหน้า เพื่อนำเข้าใหม่ครั้งแรก (หลังจากนั้นทำเองเมื่อไฟล์ถูกแก้)
4. ถ้าจะส่งจาก `hktadminpsa@aotga.com`: บัญชีที่สร้าง flow ต้องมีสิทธิ์ **Send As** ของ mailbox นี้ (ถ้าปัจจุบันส่ง alias นี้จาก Outlook ได้อยู่แล้ว ก็ใช้ได้เลย)
   ถ้าไม่มีสิทธิ์ → ใช้ **Send an email (V2)** ส่งจากบัญชีตัวเองแทน (ข้อ 5)

## สร้าง Flow
**Scheduled cloud flow** `PAS · I แจ้งเตือน Assignment ค้าง` · ทุกวัน **08:52** · Time zone **(UTC+07:00) Bangkok**

1. **Initialize variable** `Rows` (String) = ว่าง · **Initialize variable** `NDays` (Integer) = `0`
2. **Apply to each** `@{range(1, 7)}` (Settings → Concurrency **Off/1** เพื่อเรียงวัน)
   1. **Compose `Day`** = `@{formatDateTime(addDays(convertFromUtc(utcNow(), 'SE Asia Standard Time'), item()), 'yyyy-MM-dd')}`
   2. **Compose `Label`** = `@{formatDateTime(addDays(convertFromUtc(utcNow(), 'SE Asia Standard Time'), item()), 'ddd dd MMM yyyy', 'th-TH')}`
   3. **Get items** `PAS_Manpower` · Filter Query `day_key eq '@{outputs('Day')}'` · Top Count `1` → (ตั้งชื่อ `GetMp`)
   4. **Get items** `PAS_DataIssue` · Filter Query `day_key eq '@{outputs('Day')}' and category eq 'notfilled'` · Order By `team` → (`GetMiss`)
   5. **Condition** `@{length(body('GetMp')?['value'])}` is equal to `0`
      - **Yes** (ไม่มีไฟล์) → **Append to string variable** `Rows`:
        ```html
        <tr><td style="padding:8px 10px;border-bottom:1px solid #eee;white-space:nowrap"><b>@{outputs('Label')}</b></td><td style="padding:8px 10px;border-bottom:1px solid #eee"><span style="color:#c0392b">❌ ยังไม่มีไฟล์เวรของวันนี้</span></td></tr>
        ```
        → **Increment variable** `NDays` 1
      - **No** → **Condition** `@{length(body('GetMiss')?['value'])}` is greater than `0`
        - **Yes** → **Select `Chips`** From `body('GetMiss')?['value']` · Map (โหมดข้อความ):
          ```
          <span style="display:inline-block;background:#fde8e8;color:#a12;border-radius:4px;padding:1px 7px;margin:2px">@{item()?['team']} <b>(@{item()?['who']} · @{replace(replace(item()?['detail'], 'ยังลง assignment ไม่ครบ — ', ''), ' (ไม่มีสถานะและไม่มีงาน)', '')})</b></span>
          ```
          → **Append to string variable** `Rows`:
          ```html
          <tr><td style="padding:8px 10px;border-bottom:1px solid #eee;white-space:nowrap"><b>@{outputs('Label')}</b></td><td style="padding:8px 10px;border-bottom:1px solid #eee">@{join(body('Chips'), ' ')}</td></tr>
          ```
          → **Increment variable** `NDays` 1
3. **Condition** `NDays` is greater than `0` (ไม่มีค้าง = ไม่ส่ง เหมือนเดิม)
   - **Yes → Send an email from a shared mailbox (V2)** (Office 365 Outlook)
     · Original Mailbox Address = `hktadminpsa@aotga.com`
     · To = `hktadminpsa@aotga.com;dutyhkt@aotga.com`
     · Subject = `⚠️ ทีมยังลง Assignment ไม่ครบ ล่วงหน้า 7 วัน (@{variables('NDays')} วันมีค้าง)`
     · Body (กดปุ่ม `</>` เพื่อวาง HTML):
     ```html
     <div style="font-family:Tahoma,Arial,sans-serif;max-width:640px">
     <h2 style="color:#1f4e79;margin:0 0 4px">⚠️ ทีมที่ยังลง Assignment ไม่ครบ (ล่วงหน้า 7 วัน)</h2>
     <p style="color:#666;margin:0 0 12px;font-size:13px">ตรวจอัตโนมัติ @{formatDateTime(convertFromUtc(utcNow(), 'SE Asia Standard Time'), 'dd MMM yyyy HH:mm')} · ต้องกรอกให้ครบทุกคน (ลง = มีสถานะหรือมีงาน)</p>
     <table style="border-collapse:collapse;width:100%;font-size:14px"><tr style="background:#1f4e79;color:#fff">
     <th style="padding:8px 10px;text-align:left">วันที่</th><th style="padding:8px 10px;text-align:left">ทีมที่ยังไม่ครบ (ลง/ทั้งหมด · ค้าง)</th></tr>
     @{variables('Rows')}
     </table>
     <p style="font-size:12px;color:#888;margin-top:10px">แก้ที่ไฟล์เวรในโฟลเดอร์เดือน — ระบบนำเข้าใหม่เองภายใน ~25 นาที · ดูรายละเอียดที่หน้า 🩺 ตรวจข้อมูล ใน PAS</p></div>
     ```
     · Importance = Normal
     (ไม่มีสิทธิ์ Send As → ใช้ **Send an email (V2)** ใส่ To/Subject/Body เหมือนกัน)

## ทดสอบ
- กด **Test → Manually** → ถ้ามีทีมค้างจะได้เมลทันที · ถ้าไม่ได้เมล ดูค่า `NDays` ในประวัติรัน (0 = ไม่มีค้าง)
- ลองลบสถานะของ 1 คนในไฟล์เวรพรุ่งนี้ → รอ ~25 นาที (Flow A/B นำเข้า) → กด Test อีกครั้ง → ต้องขึ้นทีมนั้น `ลง x/y · ค้าง 1 คน`

## เปลี่ยนเวลา / ผู้รับ / หยุดเตือน
- เวลา: แก้ที่ trigger (Recurrence) · ผู้รับ: แก้ช่อง To · หยุดชั่วคราว: **Turn off** flow (แทน `apStopMissingNotify`)
- เตือนเฉพาะ 3 วัน: เปลี่ยน `range(1, 7)` เป็น `range(1, 3)` และข้อความหัวเรื่อง
