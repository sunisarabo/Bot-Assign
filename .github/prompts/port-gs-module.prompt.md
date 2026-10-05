---
agent: m365-migration
description: พอร์ตโมดูล .gs หนึ่งตัวไป Microsoft (Graph/Node หรือ Postgres) พร้อมทดสอบ parity
---

พอร์ตโมดูล `${input:module:ชื่อไฟล์ .gs เช่น LLReader.gs}` ไป Track `${input:track:A (Graph) / B (Postgres) / C (Power Platform)}`

1. อ่านโมดูลต้นทาง + แถวของมันใน `docs/MIGRATION-INVENTORY.md`
2. แยก logic บริสุทธิ์ ออกจากจุดเรียก Google service — logic เป็นฟังก์ชัน pure
3. เขียน adapter ตาม Track ที่เลือก (ดูตาราง API mapping ใน agent)
4. ทดสอบเทียบ `reference_parser.py` หรือ fixture — รายงานตัวเลขที่ต่างกัน (ถ้ามี)
5. อัปเดต `docs/MIGRATION-INVENTORY.md` + README ของ track
6. สรุป: ไฟล์ที่เปลี่ยน · ผล parity · env/permission ที่ต้องตั้ง
