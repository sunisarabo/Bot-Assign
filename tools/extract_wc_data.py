#!/usr/bin/env python3
"""
extract_wc_data.py — ดึง STAFF / WC / ROMAN ที่ hardcode ใน WC Tracker (Index.html)
ออกเป็น CSV สำหรับ import เข้า Dataverse (ตาราง pas_wc_staff / pas_wheelchair)

usage:  python3 tools/extract_wc_data.py  /path/to/wheelchair-tracking/Index.html  OUTDIR
รันซ้ำได้เมื่อรายชื่อ/รถเข็นในโค้ดเปลี่ยน (จนกว่าจะย้ายเป็นตารางจริง)
"""
import re, csv, os, sys


def block(s, start, closec):
    i = s.index(start); j = s.index(closec, i) + 1
    return s[i:j]


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else 'Index.html'
    out = sys.argv[2] if len(sys.argv) > 2 else './wcdata'
    os.makedirs(out, exist_ok=True)
    s = open(src, encoding='utf-8').read()

    staff = re.findall(r"\{id:'([^']*)',name:'([^']*)',nick:'([^']*)'\}", block(s, 'const STAFF=[', '];'))
    roman = dict(re.findall(r"'([0-9A-Za-z]+)'\s*:\s*'([^']*)'", block(s, 'const ROMAN={', '};')))
    wc = re.findall(r"\{no:'([^']*)',ctrl:'([^']*)',type:'([^']*)'\}", block(s, 'const WC=[', '];'))

    with open(os.path.join(out, 'pas_wc_staff.csv'), 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f); w.writerow(['StaffId', 'FullNameTh', 'NickTh', 'NameEn', 'IsActive'])
        for sid, name, nick in staff:
            w.writerow([sid, name, nick, roman.get(sid, ''), 'true'])
    with open(os.path.join(out, 'pas_wheelchair.csv'), 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f); w.writerow(['ShortNo', 'ControlNo', 'Type', 'IsActive'])
        for no, ctrl, typ in wc:
            w.writerow([no, ctrl, typ, 'true'])

    miss = [sid for sid, _, _ in staff if sid not in roman]
    print('STAFF:', len(staff), '| WC:', len(wc), '| staff missing EN:', miss or 'none')
    print('saved →', out)


if __name__ == '__main__':
    main()
