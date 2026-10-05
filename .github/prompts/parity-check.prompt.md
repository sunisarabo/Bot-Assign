---
agent: m365-migration
description: เทียบตัวเลขระบบเดิม (GAS / reference_parser.py) กับระบบใหม่ (Graph / Postgres) ของวันที่กำหนด
---

ตรวจ parity วันที่ `${input:date:YYYY-MM-DD}` ไฟล์ `${input:file:path ไฟล์ .xlsx ของวันนั้น}`

1. รัน `python3 reference_parser.py <file>` → ผลอ้างอิงต่อทีม
2. รัน parser ฝั่งใหม่บนไฟล์เดียวกัน (`graph/parseDay.js` หรือ import → query `backend/queries.js`)
3. ทำตารางเทียบ: ทีม | working | ot_off | off | sick | leave | OT คน | OT ชม. | flights — ใส่ ✅/❌ ต่อช่อง
4. ทุก ❌ ให้หาสาเหตุ (layout / REMARK / shift ข้ามวัน) และเสนอ fix — อย่าแก้ spec ให้ตรงกับโค้ดใหม่
5. ติ๊ก checklist ข้อที่ผ่านใน `docs/MIGRATION-INVENTORY.md` §6 พร้อมวันที่
