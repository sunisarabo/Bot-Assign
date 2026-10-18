# 18 · แจ้งเตือนพอตเตอร์/ซัพ — In-app live + LINE Messaging API

> ⚠️ **LINE Notify ถูกยกเลิกแล้ว (31 มี.ค. 2025)** — ใช้ **LINE Messaging API** (LINE Official Account) แทน

ทำทั้ง 2 ช่องทางคู่กัน: In-app เด้งในแอป (พอตเตอร์ไม่ต้องมีบัญชี) + LINE ยิงเข้ากลุ่มทีม

---

## ส่วนที่ 1 · In-app live (ในแอปพอตเตอร์)

### Control ที่เพิ่ม (หน้า porter)
- **Timer `tmrPoll`**: `Duration=20000` · `Repeat=true` · `AutoStart=true`
- **Audio `audAlert`** (เสียงแจ้งเตือน): `Start = varPlaySound` · `OnEnd = Set(varPlaySound,false)`
- **Label `lblAlert`** (แบนเนอร์) · **Gallery `galMyCases`** (เคสของฉัน)
- เลือกตัวตน: `ddPorter.Items = pas_porter_staffs` → `Set(varMyName, ddPorter.Selected.pas_name)` (ไม่ต้องล็อกอิน)

### `tmrPoll.OnTimerEnd`
```powerapps
ClearCollect(colMyCases,
  Filter(pas_porter_jobs, pas_work_date = Today(),
         varMyName in pas_porter_names,         // พอตเตอร์คนนี้ถูกจ่ายเคส
         pas_acknowledged <> true));
If(CountRows(colMyCases) > varPrevCount,
   Notify("🔔 เคสวีลแชร์ใหม่ — ไปรับที่ " & First(colMyCases).pas_gate &
          " (" & First(colMyCases).pas_service & ")", NotificationType.Information, 8000);
   Set(varPlaySound, true));
Set(varPrevCount, CountRows(colMyCases))
```

### Gallery + ปุ่ม "รับเคส" (= Acknowledge)
```powerapps
galMyCases.Items = colMyCases
// ในแถว: flight/service/gate + ปุ่ม
btnTake.OnSelect =
  Patch(pas_porter_jobs, ThisItem, { pas_acknowledged: true, pas_ack_at: Now(), pas_ack_by: varMyName });
  Notify("รับเคสแล้ว", NotificationType.Success)
```
> งานซัพพอร์ตข้ามทีม: ทำแบบเดียวกันบน `pas_assignment` ที่ flag ซัพ (filter ทีมปลายทาง)

---

## ส่วนที่ 2 · LINE Messaging API (เข้ากลุ่ม LINE ทีม)

### A. เตรียม (ครั้งเดียว — IT/คุณทำที่ LINE)
1. สร้าง **LINE Official Account** ฟรี ที่ `manager.line.biz`
2. เปิด **Messaging API** → ไป `developers.line.biz` → ช่อง **Messaging API** → คัดลอก **Channel access token (long-lived)**
3. **เชิญ OA (บอท) เข้ากลุ่ม LINE ทีม**
4. หา **groupId**: ตั้ง Webhook URL (จาก flow ข้อ B2) ในคอนโซล → พอบอทเข้ากลุ่ม LINE ยิง event มี `source.groupId` → เก็บค่าไว้
   - *ง่ายกว่า:* ให้พอตเตอร์ **แอดเป็นเพื่อน** แล้วใช้ `broadcast` (ไม่ต้องใช้ groupId)

### B. Power Automate flow "LINE แจ้งเคส"
1. **Trigger:** Dataverse **When a row is added** → ตาราง **PAS Porter Job** (และอีก flow สำหรับงานซัพบน PAS Assignment)
2. **HTTP** action:
   - Method **POST**
   - URI: `https://api.line.me/v2/bot/message/push`  *(หรือ `/broadcast` ถ้าไม่ใช้กลุ่ม)*
   - Headers:
     ```
     Authorization: Bearer <CHANNEL_ACCESS_TOKEN>
     Content-Type: application/json
     ```
   - Body:
     ```json
     {
       "to": "<groupId>",
       "messages": [
         { "type": "text",
           "text": "🔔 เคสวีลแชร์ใหม่\nไฟลท์ @{triggerOutputs()?['body/pas_name']}  บริการ @{...pas_service}\nรับที่เกท @{...pas_gate}" }
       ]
     }
     ```
   *(ถ้าใช้ `/broadcast` ให้ตัด `"to"` ออก)*
3. **Save** → ทดสอบเพิ่มเคสใหม่ → ข้อความเข้า LINE กลุ่ม

### หมายเหตุ
- เก็บ **token** ใน **Environment variable** (อย่าใส่ตรง ๆ ในสูตร)
- โควตา Messaging API ฟรี: broadcast/push มีลิมิตข้อความ/เดือน (ปัจจุบัน ~500 ข้อความ/เดือน แผนฟรี) — ถ้ายิงทุกเคสเยอะ พิจารณาแผน หรือรวมเป็นสรุปทุก X นาที
- In-app = เรียลไทม์ในแอป (ฟรี ไม่จำกัด) · LINE = เตือนนอกแอป (เผื่อไม่ได้เปิดแอป) → ใช้คู่กันดีสุด
