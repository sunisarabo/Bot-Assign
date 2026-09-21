#!/usr/bin/env bash
# load_all.sh — โหลด JSON ที่ export จาก Apps Script (rbSaveAllDay/rbSaveMasterJson) เข้า DB
# ทั้งวันในคำสั่งเดียว · idempotent ต่อวัน (importer ลบของวันนั้นก่อน insert)
#
# ใช้:
#   DATABASE_URL="postgres://pas:pas@host/pas" db/load_all.sh <โฟลเดอร์> <YYYY-MM-DD> [--master]
#   db/load_all.sh ./exports 2026-09-19            # ใช้ DB default (pas) ถ้าไม่ตั้ง DATABASE_URL
#   db/load_all.sh ./exports 2026-09-19 --master   # โหลด master (employee) ด้วย
#
# ไฟล์ที่คาดหวังในโฟลเดอร์:
#   pas_day_<DATE>.json  pas_flights_<DATE>.json  pas_porter_<DATE>.json
#   pas_prewc_<DATE>.json  pas_manpower_<DATE>.json   (+ pas_master.json ถ้า --master)
# ไฟล์ไหนไม่มี → ข้าม (เตือน) · ตั้ง STRICT=1 เพื่อให้ error แทนการข้าม
set -euo pipefail

DIR="${1:?ต้องระบุโฟลเดอร์ที่มีไฟล์ JSON}"
DATE="${2:?ต้องระบุวันที่ YYYY-MM-DD}"
WITH_MASTER="${3:-}"
[[ "$DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "วันที่ต้องเป็น YYYY-MM-DD" >&2; exit 2; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STRICT="${STRICT:-0}"
if [[ -n "${DATABASE_URL:-}" ]]; then PSQL=(psql "$DATABASE_URL"); else PSQL=(psql -d pas); fi

run() {  # run <importer.js> <json-file>
  local imp="$1" file="$2"
  if [[ ! -f "$file" ]]; then
    echo "⏭️  ข้าม $(basename "$file") (ไม่พบไฟล์)" >&2
    [[ "$STRICT" == "1" ]] && { echo "STRICT: ขาดไฟล์ $file" >&2; exit 3; } || return 0
  fi
  echo "▶️  $(basename "$imp")  ←  $(basename "$file")" >&2
  node "$HERE/$imp" "$file" | "${PSQL[@]}" -q -v ON_ERROR_STOP=1
}

echo "=== โหลดข้อมูลวันที่ $DATE จาก $DIR ===" >&2
[[ "$WITH_MASTER" == "--master" ]] && run import_master.js   "$DIR/pas_master.json"
run import.js          "$DIR/pas_day_${DATE}.json"        # duty + assignment (รันก่อน สร้าง employee stub)
run import_flights.js  "$DIR/pas_flights_${DATE}.json"
run import_porter.js   "$DIR/pas_porter_${DATE}.json"
run import_prewc.js    "$DIR/pas_prewc_${DATE}.json"
run import_manpower.js "$DIR/pas_manpower_${DATE}.json"
echo "✅ เสร็จ ($DATE)" >&2
