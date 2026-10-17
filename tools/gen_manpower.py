#!/usr/bin/env python3
"""
gen_manpower.py — สรุป manpower รายวันจาก CSV pas_duty (ของ build_roster --dataverse หรือ import_daily_roster)
→ CSV ตาราง pas_manpower (pas_name=วันที่ · Work Date · Working Actual · OT · Scheduled · Sick · Annual · Training)

อินพุต: pas_duty_*.csv ที่มีคอลัมน์ (อ่านตามหัวจริง, ยืดหยุ่นชื่อ):
  pas_work_date · pas_bucket · pas_ot_hours · (pas_shift_hours ถ้ามี) · Team(pas_team) ถ้ามี
bucket: WORKING / OT_OFF / OFF / SICK / VACATION / LEAVE / TRAINING

usage:
  python3 tools/gen_manpower.py pas_duty_roster.csv -o pas_manpower.csv
  python3 tools/gen_manpower.py pas_duty_history.csv --by-team -o pas_manpower.csv   # แยกต่อทีม (คีย์ Team_date)
"""
import argparse, csv
from collections import defaultdict


def num(v):
    try:
        return float(v)
    except Exception:
        return 0.0


def pick(row, *names):
    for n in names:
        if n in row and row[n] not in (None, ''):
            return row[n]
    return ''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('inputs', nargs='+', help='CSV pas_duty อย่างน้อย 1')
    ap.add_argument('-o', '--out', default='pas_manpower.csv')
    ap.add_argument('--by-team', action='store_true', help='แยกสรุปต่อทีม (คีย์ = Team_date)')
    args = ap.parse_args()

    # agg[key] = dict ตัวเลข · key = date หรือ (team,date)
    agg = defaultdict(lambda: {'work': 0, 'ot': 0.0, 'sched': 0, 'sick': 0, 'annual': 0, 'train': 0, 'date': '', 'team': ''})
    for p in args.inputs:
        for r in csv.DictReader(open(p, encoding='utf-8-sig')):
            d = str(pick(r, 'pas_work_date', 'Work Date'))[:10]
            if not d:
                continue
            team = str(pick(r, 'Team(pas_team)', 'Team', 'pas_team')) if args.by_team else ''
            bucket = str(pick(r, 'pas_bucket', 'Bucket')).upper()
            ot = num(pick(r, 'pas_ot_hours', 'OT Hours'))
            key = (team, d) if args.by_team else d
            a = agg[key]; a['date'] = d; a['team'] = team
            a['ot'] += ot
            if bucket in ('WORKING', 'OT_OFF'):
                a['work'] += 1; a['sched'] += 1
            elif bucket == 'SICK':
                a['sick'] += 1
            elif bucket == 'VACATION':
                a['annual'] += 1
            elif bucket == 'TRAINING':
                a['train'] += 1
            # OFF / LEAVE / X ไม่นับเข้า working

    keys = sorted(agg, key=lambda k: (agg[k]['date'], agg[k]['team']))
    with open(args.out, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        head = ['pas_name', 'pas_work_date']
        if args.by_team:
            head.append('Team(pas_team)')
        head += ['pas_working_actual', 'pas_ot_hours', 'pas_scheduled', 'pas_sick', 'pas_annual_leave', 'pas_training']
        w.writerow(head)
        for k in keys:
            a = agg[k]
            name = (a['team'] + '_' + a['date']) if args.by_team else a['date']
            base = [name, a['date']] + ([a['team']] if args.by_team else [])
            w.writerow(base + [a['work'], round(a['ot'], 1), a['sched'], a['sick'], a['annual'], a['train']])
    print('saved', args.out, '(%d rows)' % len(keys))


if __name__ == '__main__':
    main()
