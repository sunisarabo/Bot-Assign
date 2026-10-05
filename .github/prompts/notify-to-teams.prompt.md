---
agent: m365-migration
description: ย้ายการแจ้งเตือน Google Chat / Gmail ไป Microsoft Teams / Outlook
---

ย้ายการแจ้งเตือนของ `${input:source:เช่น RosterBot.gs (Google Chat) หรือ AdvancePlan.gs (Gmail)}`

1. หาทุกจุดที่ใช้ `GCHAT_WEBHOOK_REPORT`, `UrlFetchApp.fetch(webhook…)`, `GmailApp`, `MailApp`
2. ตรวจ Microsoft Learn ว่าวิธี post เข้า Teams channel ที่แนะนำตอนนี้คืออะไร (Workflows / Power Automate webhook) ก่อนเขียนโค้ด
3. Node: สร้าง `notify.js` รับ `{ title, lines[], link }` → ส่ง Teams (Adaptive Card) และ/หรือ อีเมลผ่าน `backend/mailer.js`
4. URL webhook / SMTP password อยู่ใน env (`TEAMS_WEBHOOK_URL`, `SMTP_*`) — เพิ่มใน `.env.example` เท่านั้น
5. ข้อความรายงานต้องมีเนื้อหาเท่าของเดิม (สรุปรายทีม working/off/sick/leave/OT)
6. บอกขั้นตอนที่ผู้ใช้ต้องทำเองใน Teams (สร้าง Workflow, คัดลอก URL)
