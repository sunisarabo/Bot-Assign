# Deploy บน Azure (ไม่ต้องใช้ Terminal)

โฮสต์ dashboard (`graph/server.js`) ให้รันตลอด ทุกคนเปิดผ่านลิงก์เว็บ · **แนะนำ App Service** (ง่ายกว่า Container Apps)

## แนะนำ: Azure App Service (Web App) — deploy Node จาก GitHub ตรง ๆ ไม่ต้อง build image
> app นี้**ไม่มี dependency** (ใช้ Node built-ins ล้วน) → App Service รัน `npm start` = `node graph/server.js` ได้เลย

**1. สร้าง Web App**
Azure Portal → **App Services → Create → Web App**
- Runtime stack: **Node 20 LTS** · OS: **Linux**
- Region: **Southeast Asia** · Plan: **B1** (หรือ F1 ฟรีสำหรับทดสอบ)

**2. ต่อ GitHub (Deployment Center)**
Web App → **Deployment Center** → Source **GitHub** → เลือก repo **sunisarabo/Bot-Assign** · branch **claude/blissful-clarke-TEW22** → Save
→ Azure สร้าง GitHub Action ให้อัตโนมัติ (build + deploy ทุกครั้งที่ push)

**3. ตั้งค่า env (Configuration → Application settings) → + New**
```
GRAPH_TENANT_ID   = 619b9081-4c12-4243-af65-d67cb3b41d81
GRAPH_CLIENT_ID   = <app id>
GRAPH_CLIENT_SECRET = <secret>
SP_HOSTNAME       = aotgath.sharepoint.com
SP_SITE_PATH      = /sites/0AAYJ05_KoLORUk9PVA
SP_ROOT_FOLDER    = /Shared Documents/2025
```
กด **Save** (แอปจะรีสตาร์ท)

**4. Startup Command** (Configuration → General settings) — เผื่อไว้ให้แน่:
```
node graph/server.js
```

**5. เปิดเว็บ** → `https://<ชื่อแอป>.azurewebsites.net`
(ครั้งแรกอาจต้องรอ GitHub Action build ~2–3 นาที)

## ทางเลือก: Container Apps (ถ้าถนัด container)
มี `graph/Dockerfile` (build context = repo root) ให้แล้ว
```
az acr build -r <registry> -t pas-graph:latest -f graph/Dockerfile .
# → Container Apps: image = <registry>/pas-graph:latest · target port 3000 · ingress external · ใส่ env เหมือนข้างบน
```

## ค่าใช้จ่าย / สิทธิ์
- ต้องมี **Azure subscription** · App Service B1 ≈ หลักร้อย/เดือน · F1 ฟรี (จำกัด, พอทดสอบ)
- ต้องเปิด egress ให้ `graph.microsoft.com` + `login.microsoftonline.com` (ค่า default เปิดอยู่แล้ว)
- Graph app ต้องมี **Sites.Read.All + Files.Read.All + admin consent** (ทำแล้ว ✅)

## หลัง deploy
- เพิ่ม **Authentication (Easy Auth)** ของ App Service → บังคับ login Entra ให้เฉพาะพนักงานองค์กรเข้าได้ (ไม่ต้องเขียนโค้ด)
- ตั้ง **Custom domain** ถ้าต้องการชื่อสวย
