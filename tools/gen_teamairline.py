#!/usr/bin/env python3
"""
gen_teamairline.py — สร้างตาราง map ทีม ↔ สายการบิน (IATA) → CSV ตาราง pas_teamairline
(คีย์ Team|IATA · Team · IATA) ใช้ให้ scrAssign กรองไฟลท์/สายการบินตามทีม

ที่มา: กลุ่มสายการบินต่อทีม (จากทะเบียน/การจัดทีมจริง) ฝังไว้ด้านล่าง — แก้ตรงนี้เมื่อการจัดทีมเปลี่ยน
(สอดคล้องกับ REG2TEAM ใน build_roster.py)

usage:  python3 tools/gen_teamairline.py -o pas_teamairline.csv
        python3 tools/gen_teamairline.py --from-flights PAS_2026-10.xlsx   # (ออปชัน) เช็กว่าครอบคลุมสายการบินในไฟล์จริงไหม
"""
import argparse, csv

# ทีม → รายชื่อสายการบิน (IATA) · ★ แก้ให้ตรงการจัดทีมจริงได้
TEAM_AIRLINES = {
    'QR':    ['QR', 'MH', 'OM', 'DE'],
    'TR':    ['TR', '6E', 'QP'],
    'EK':    ['EK', 'UO', '6B', 'BY', 'FY'],
    'EY':    ['EY', 'DV', 'AY'],
    'SQ':    ['SQ', 'CX', 'LY'],
    'KE':    ['KC', 'LJ', 'KE', 'OZ', 'NO', 'AF'],
    'SU':    ['SU', 'B2', 'W5'],
    'TK':    ['TK', 'VJ', 'SG', 'HY', 'OD'],
    'JQ':    ['JQ', 'IT', 'IX', 'AI', 'N0'],
    'PG':    ['PG'],
    'AK':    ['AK', 'QZ', '8M'],
    'WY/WK': ['WY', 'G9', '9C', 'DK', 'SV', 'KA', 'WK'],
    'CHN':   ['CA', 'MU', 'CZ', 'FM', 'SC', 'HO', '3U', '8L', 'GS', 'GJ', 'HU', 'MF'],   # ★ กลุ่มจีน (รวม Hainan/Xiamen)
    'PVT':   [],   # เที่ยวบินส่วนตัว/เช่าเหมา — ไม่ผูก IATA ตายตัว
}

# สายที่ PSA "ไม่ได้ให้บริการ" → ไม่มีทีม · แสดงเป็นภาพรวมสนามบินเท่านั้น
# (ส่วนมากในประเทศ) — ปรับได้ถ้าภายหลังรับบริการเพิ่ม
NOT_SERVICED = ['FD', 'VZ', 'SL', 'TG', 'DD', 'HX', 'VN', 'S7', 'C6', 'KU', 'VS', 'HH', 'IZ']


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('-o', '--out', default='pas_teamairline.csv')
    ap.add_argument('--from-flights', default=None, help='(ออปชัน) ไฟล์ไฟลท์จริง เพื่อเช็กสายการบินที่ยังไม่ได้ map')
    args = ap.parse_args()

    rows = []
    seen = set()
    for team, iatas in TEAM_AIRLINES.items():
        for a in iatas:
            key = team + '|' + a
            rows.append([key, team, a])
            seen.add(a)
    with open(args.out, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(['Key', 'Team(pas_team)', 'pas_iata'])
        w.writerows(rows)
    print('saved', args.out, '(%d team-airline rows, %d airlines)' % (len(rows), len(seen)))

    if args.from_flights:
        try:
            from openpyxl import load_workbook
            wb = load_workbook(args.from_flights, read_only=True, data_only=True)
            found = set()
            for ws in wb.worksheets:
                for r in ws.iter_rows(values_only=True):
                    for c in r:
                        s = str(c or '').strip().upper()
                        if len(s) == 2 and s.isalnum() and not s.isdigit():
                            found.add(s)
            missing = sorted(a for a in found if a not in seen and a.isalpha())
            if missing:
                print('⚠️ สายการบินในไฟล์ที่ยังไม่ได้ map (ตรวจ/เพิ่มใน TEAM_AIRLINES):', missing[:40])
            else:
                print('✓ สายการบินในไฟล์ครอบคลุมครบ')
        except Exception as e:
            print('อ่านไฟล์ไฟลท์ไม่ได้:', e)


if __name__ == '__main__':
    main()
