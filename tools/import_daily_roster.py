#!/usr/bin/env python3
"""
import_daily_roster.py — อ่าน "ไฟล์เวร assignment รายวัน" เดิม (แท็บทีม เช่น 01OCT.xlsx)
→ CSV pas_duty (ประวัติ: กะ + เวลา IN/OUT + OT ก่อน/หลังกะ) สำหรับ import เข้า Dataverse ครั้งเดียว

โครงแท็บทีม (PAS DAILY JOB ASSIGNMENT):
  row มี 'ID' = หัวตาราง · คอลัมน์ 0-based:
  0 ID · 1 Position · 2 NAME · 3 SHIFT · 4-6 ON DUTY (IN/OUT/Total)
  7-9 RE-SKED · 10-12 OT ก่อนกะ · 13-15 OT หลังกะ

usage:  python3 tools/import_daily_roster.py  DAILY.xlsx  OUT.csv  [--date YYYY-MM-DD]
        (ถ้าไม่ระบุ --date จะอ่านจากหัวแท็บ · หลายไฟล์ = รันวนเอง)
"""
import argparse, csv, datetime, re
from openpyxl import load_workbook

SKIP = {'MANPOWER', 'สรุปคอนเฟิร์ม', 'SUPPORT REQUEST', 'Sheet1', 'Urgent Support',
        'MASTER (แม่แบบ)', 'ShiftDB', 'Code', '_CODES'}


def to_min(v):
    if isinstance(v, datetime.time):
        return v.hour * 60 + v.minute
    if isinstance(v, datetime.datetime):
        return v.hour * 60 + v.minute
    m = re.match(r'^\s*(\d{1,2})[:.](\d{2})', str(v or ''))
    return (int(m.group(1)) * 60 + int(m.group(2))) if m else None


def tab_date(ws, fallback):
    for row in ws.iter_rows(min_row=1, max_row=2, values_only=True):
        for c in row:
            if isinstance(c, datetime.datetime):
                return c.date()
    return fallback


def num(v):
    try:
        return round(float(v), 1)
    except Exception:
        return 0.0


def parse(path, forced_date=None):
    wb = load_workbook(path, read_only=True, data_only=True)
    out = []
    for ws in wb.worksheets:
        name = ws.getName() if hasattr(ws, 'getName') else ws.title
        if name.strip() in SKIP:
            continue
        rows = [list(r) for r in ws.iter_rows(values_only=True)]
        hdr = next((i for i, r in enumerate(rows[:6]) if r and str(r[0]).strip() == 'ID'), None)
        if hdr is None:
            continue
        d = forced_date or tab_date(ws, None)
        if not d:
            continue
        team = name.strip()
        for r in rows[hdr + 1:]:
            if not r or r[0] is None:
                continue
            code = str(r[0]).strip()
            if not re.match(r'^\d{6,7}$', code):      # เฉพาะรหัสพนักงานจริง (ข้ามตัวอย่าง/ว่าง)
                continue
            pos = str(r[1] or '').strip()
            nm = str(r[2] or '').strip()
            shift = str(r[3] or '').strip()
            ss, se, hrs = to_min(r[4]), to_min(r[5]), num(r[6])
            ot_pre = num(r[12]) if len(r) > 12 else 0
            ot_post = num(r[15]) if len(r) > 15 else 0
            working = bool(shift) or hrs > 0 or ss is not None
            out.append({
                'pas_name': code + '_' + d.isoformat(),
                'pas_work_date': d.isoformat(),
                'EmpCode(pas_employee)': code, 'pas_emp_name': nm, 'Team(pas_team)': team,
                'Position': pos,
                'pas_bucket': 'WORKING' if working else 'OFF',
                'pas_shift_code': shift,
                'pas_shift_start': ss if ss is not None else '',
                'pas_shift_end': se if se is not None else '',
                'pas_shift_hours': hrs,
                'pas_ot_pre_hours': ot_pre, 'pas_ot_post_hours': ot_post,
                'pas_ot_hours': round(ot_pre + ot_post, 1),
            })
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('inputs', nargs='+', help='ไฟล์เวรรายวัน (.xlsx) อย่างน้อย 1')
    ap.add_argument('-o', '--out', default='pas_duty_history.csv')
    ap.add_argument('--date', default=None, help='YYYY-MM-DD (ถ้าหัวแท็บไม่มีวันที่)')
    args = ap.parse_args()
    fd = datetime.date.fromisoformat(args.date) if args.date else None
    rows = []
    for p in args.inputs:
        r = parse(p, fd)
        rows += r
        print(p, '→', len(r), 'rows')
    if rows:
        with open(args.out, 'w', newline='', encoding='utf-8-sig') as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader(); w.writerows(rows)
    print('total', len(rows), '→', args.out)


if __name__ == '__main__':
    main()
