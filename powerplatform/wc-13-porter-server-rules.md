# WC/Porter · 13 · บังคับกติกา PAS_Porter ฝั่งเซิร์ฟเวอร์

กติกาที่ต้องกันทุกทางเขียน (แอป/แก้มือ): **สถานะไม่ถอยหลัง · ต้องรับทราบก่อนเริ่ม · เปลี่ยนคนหลังเริ่มงานไม่ได้**

> ⚠️ **PAS_Porter เป็น SharePoint list หรือ Dataverse?** (handoff = ดึงจาก SharePoint REST → น่าจะเป็น **SharePoint list**)
> - **SharePoint list** → ไม่มี plug-in บล็อกสด · ใช้ **Power Automate ตรวจ+ย้อนกลับ (async)** + gate ในแอป (ข้อ A)
> - **Dataverse table** → ใช้ **plug-in real-time (Pre-Operation Update)** บล็อกได้ทันทีก่อน commit (ข้อ B)

## ลำดับสถานะ (lp_state)
```
NEW(0) → ASSIGNED(1) → ACK(2) → ON_PROCESS(3) → DONE(4)     (ว่าง = NEW)
```
กติกา:
1. **ไม่ถอยหลัง:** rank(ใหม่) ≥ rank(เดิม)
2. **ต้องรับทราบก่อนเริ่ม:** จะเป็น `ON_PROCESS` ต้องมี `lp_ack_at` (เคยผ่าน ACK)
3. **จบต้องเคยเริ่ม:** จะเป็น `DONE` ต้องมี `lp_start_at` หรือ `pickup_at`
4. **ล็อกคนหลังเริ่ม:** state เดิม ∈ {ON_PROCESS, DONE} → เปลี่ยน `lp_porter`/`lp_porter_code` ไม่ได้

---

## A · SharePoint list → Power Automate (ตรวจ + ย้อนกลับ)
SharePoint ไม่มี sync plug-in → บล็อกก่อนเขียนไม่ได้ · ใช้ flow จับ "ถูกแก้" แล้ว **ย้อนค่าถ้าผิดกติกา** (เกิดชั่วขณะแล้วเด้งกลับ) + โชว์เตือน
> ต้องมี **shadow column** เก็บค่าที่ผ่านแล้ว: `lp_state_prev` (Text) · (ออปชัน `lp_porter_prev`) — flow ใช้เทียบ เพราะ SharePoint trigger ไม่ส่งค่าเก่า

**Flow "Porter Rules":**
1. **Trigger:** When an item is created or modified (list PAS_Porter)
   - **Trigger condition** กันลูป: `@not(equals(triggerBody()?['lp_state'], triggerBody()?['lp_state_prev']))`
2. **Compose rankNew / rankOld** จาก map ข้างบน (ใช้ `if`/`switch` กับ `lp_state` และ `lp_state_prev`; ว่าง=0)
3. **Condition — ผิดกติกาไหม** (OR):
   - `rankNew < rankOld`  (ถอยหลัง)
   - `and(equals(lp_state,'ON_PROCESS'), empty(lp_ack_at))`  (เริ่มโดยไม่รับทราบ)
   - `and(equals(lp_state,'DONE'), and(empty(lp_start_at), less(length(coalesce(pickup_at,'')),4)))`  (จบโดยไม่เริ่ม)
   - (ออปชัน) `and(greaterOrEquals(rankOld,3), not(equals(lp_porter_prev, lp_porter)))`  (เปลี่ยนคนหลังเริ่ม)
   - **ถ้าผิด →** Update item: `lp_state = lp_state_prev` (+ เคลียร์ timestamp ที่เพิ่งใส่ผิด · คืน lp_porter_prev) → **Notify/โพสต์ log** "ย้อนสถานะผิดกติกา"
   - **ถ้าถูก →** Update item: `lp_state_prev = lp_state` (+ `lp_porter_prev = lp_porter`)  ← commit ค่าที่ผ่าน
> การ Update ของ flow จะ trigger ซ้ำ แต่ trigger condition (ข้อ1) ตัดจบเพราะ `lp_state = lp_state_prev` แล้ว

**gate ในแอป (ชั้นแรก ให้ UX ดี):** ปุ่มใน scrMe/scrLP บังคับลำดับอยู่แล้ว (NEW/ASSIGNED→ACK→ON_PROCESS→DONE, ดู `wc-12`) · flow เป็นตาข่ายกันพลาด/แก้มือ

---

## B · Dataverse table → plug-in real-time (บล็อกสด)
ถ้าย้าย PAS_Porter เป็น Dataverse table → guard แบบ `wc-07` บน **Update** (Pre-Operation + Pre-Image `pre`):
```csharp
// register: Message=Update · Table=pas_porter · Stage=Pre-operation · Pre-Image "pre"
//           (attrs: lp_state, lp_ack_at, lp_start_at, pickup_at, lp_porter_code)
public class PorterRules : IPlugin {
  static int Rank(string s) =>
    s == "ASSIGNED" ? 1 : s == "ACK" ? 2 : s == "ON_PROCESS" ? 3 : s == "DONE" ? 4 : 0;

  public void Execute(IServiceProvider sp) {
    var ctx = (IPluginExecutionContext)sp.GetService(typeof(IPluginExecutionContext));
    var tgt = (Entity)ctx.InputParameters["Target"];
    if (!tgt.Contains("lp_state") && !tgt.Contains("lp_porter_code")) return;
    var pre = ctx.PreEntityImages.Contains("pre") ? ctx.PreEntityImages["pre"] : new Entity();

    string oldS = pre.GetAttributeValue<string>("lp_state") ?? "";
    string newS = tgt.Contains("lp_state") ? (tgt.GetAttributeValue<string>("lp_state") ?? "") : oldS;

    // 1) ไม่ถอยหลัง
    if (Rank(newS) < Rank(oldS))
      throw new InvalidPluginExecutionException("สถานะถอยหลังไม่ได้ (" + oldS + "→" + newS + ")");

    // 2) ต้องรับทราบก่อนเริ่ม
    var ackAt = tgt.Contains("lp_ack_at") ? tgt.GetAttributeValue<DateTime?>("lp_ack_at")
                                          : pre.GetAttributeValue<DateTime?>("lp_ack_at");
    if (newS == "ON_PROCESS" && ackAt == null)
      throw new InvalidPluginExecutionException("ต้องรับทราบ (ACK) ก่อนเริ่มงาน");

    // 3) จบต้องเคยเริ่ม
    var startAt = tgt.Contains("lp_start_at") ? tgt.GetAttributeValue<DateTime?>("lp_start_at")
                                              : pre.GetAttributeValue<DateTime?>("lp_start_at");
    if (newS == "DONE" && startAt == null)
      throw new InvalidPluginExecutionException("ต้องเริ่มงานก่อนปิดงาน");

    // 4) ล็อกคนหลังเริ่ม
    if (Rank(oldS) >= 3 && tgt.Contains("lp_porter_code")
        && tgt.GetAttributeValue<string>("lp_porter_code") != pre.GetAttributeValue<string>("lp_porter_code"))
      throw new InvalidPluginExecutionException("เปลี่ยนพอตเตอร์หลังเริ่มงานไม่ได้");
  }
}
```
> บล็อกทันที throw = ผู้ใช้เห็น error เลย ไม่มี "เด้งกลับชั่วขณะ" แบบ SharePoint · register เหมือน `wc-07` ข้อ 6

---

## C · (ออปชัน) กัน 1 คนทำหลายงานพร้อมกัน
- **flow/plug-in** ก่อนตั้ง `ON_PROCESS`: query PAS_Porter `day_key = วันนี้ · lp_porter_code = คนนี้ · lp_state = ON_PROCESS` → ถ้ามีอยู่แล้ว เตือน/บล็อก
- หรือปล่อยให้พอตเตอร์ทำทีละเคส (ปุ่มเริ่มกดได้เมื่อไม่มีงาน ON_PROCESS ค้างของตัวเอง)

## สรุปเลือกทาง
| PAS_Porter เป็น | บังคับกติกาเซิร์ฟเวอร์ |
|---|---|
| **SharePoint list** (น่าจะใช่) | **A** — flow ตรวจ+ย้อนกลับ + shadow column + gate ในแอป |
| **Dataverse table** | **B** — plug-in real-time บล็อกสด (แน่นสุด) |

> ทั้งสองทาง gate ในแอป (`wc-12` ปุ่มเดินสเต็ป) ยังเป็นด่านแรกเพื่อ UX · เซิร์ฟเวอร์เป็นด่านกันพลาด/แก้มือ
