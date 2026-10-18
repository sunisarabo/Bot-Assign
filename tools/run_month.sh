#!/usr/bin/env bash
# run_month.sh — สร้าง roster + assignment ของ "เดือนถัดไป" เป็น CSV พร้อม import เข้า Dataverse
#
# usage:
#   tools/run_month.sh  TURNAROUND_MASTER.xlsx  REGISTRY.xlsx  YYYY-MM  OUTDIR  [LEAVE.csv]
#
#   TURNAROUND_MASTER = ไฟล์ตารางบิน (ชีต Flight_Schedule)
#   REGISTRY          = ไฟล์ทะเบียนพนักงาน (ชีต 'ทะเบียน')
#   YYYY-MM           = เดือนที่จะสร้าง (เช่น 2026-12)
#   OUTDIR            = โฟลเดอร์ผลลัพธ์
#   LEAVE.csv         = (ตัวเลือก) วันลาที่อนุมัติแล้ว (EmpCode,LeaveDate,LeaveType) → ข้ามคนลา
set -euo pipefail
M=$1; REG=$2; YM=$3; OUT=${4:-./out}; LV=${5:-}
DV="$OUT/dataverse"
mkdir -p "$DV"

python3 tools/build_int_roster.py "$M" -o "$OUT/INT.xlsx" --month "$YM" --dataverse "$DV"
python3 tools/build_roster.py --req "$OUT/INT_${YM}.xlsx" --reg "$REG" \
    -o "$OUT/Roster_${YM}.xlsx" --dataverse "$DV" ${LV:+--leave "$LV"}

echo "เสร็จ → $DV :"
ls -1 "$DV"
echo "อัปโหลด pas_duty_roster.csv / pas_flight_int.csv ขึ้น SharePoint ให้ flow import (ดู 21-auto-run.md)"
