# PAS backend — Node + pg (อ่านจาก PostgreSQL) · รันได้ทุกที่ (Docker/Azure)
FROM node:20-alpine

WORKDIR /app

# ติดตั้ง dependency ก่อน (cache layer) — ต้องมี package-lock.json
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# โค้ดแอป
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# healthcheck เรียก /api/health
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1

CMD ["node", "server.js"]
