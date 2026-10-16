#!/usr/bin/env python3
"""
build_roster.py — จับ "คนจริงในทีม" ลงกะตามแพทเทิร์นความต้องการรายวัน (ตารางเวรรายเดือน)

อินพุต:
  --req   เวิร์กบุ๊กเดือน (จาก build_int_roster.py --month) ที่มีชีต 'ShiftReq_Daily'
  --reg   ไฟล์ทะเบียนพนักงาน (ชีต 'ทะเบียน': EmpID/Team/Status/FirstNameTH)
  -o      ไฟล์ roster ผลลัพธ์

ผลลัพธ์:
  - 1 ชีต/ทีม: แถว=พนักงาน · คอลัมน์=วันในเดือน · ค่า = M/A/N/OFF
  - 'Coverage' : ต่อทีม×วัน เทียบ target vs assigned vs ขาด (ต่อกะ)
  - 'Teams_NoStaff' : ทีมที่ไม่มีคนในทะเบียน (ต้องใช้ support/charter)

วิธีจับ: เลือก OFF คนที่ทำงานสะสมมากสุดก่อน (เฉลี่ยวันหยุด) · ใส่กะกลางคืนให้คนที่
ได้ N น้อยสุดก่อน (เฉลี่ยกะดึก) · ถ้าคนไม่พอ target จะ scale ลงและแจ้ง "ขาด"
"""
import argparse, csv, os
from collections import defaultdict
from openpyxl import load_workbook, Workbook
from openpyxl.styles import Font, PatternFill, Alignment

# เวลาเข้า-ออกมาตรฐานต่อกะ (นาที) → เขียนลง pas_duty ตอน import
SHIFT_TIME = {'M': (5*60, 14*60), 'A': (13*60, 22*60), 'N': (21*60, 30*60)}

# ทะเบียน team string → ชื่อทีม ADV
REG2TEAM = {
    'CHINA TEAM': 'CHN', 'QR/MH/OM/DE': 'QR', 'TR/6E/QP': 'TR', 'EK/UO/6B/BY/FY': 'EK',
    'EY/DV/AY': 'EY', 'SQ/CX/LY': 'SQ', 'KC/LJ/KE/OZ/NO/AF': 'KE', 'SU/B2/W5': 'SU',
    'TK/VJ/SG/HY/OD': 'TK', 'JQ/IT/IX/AI/N0': 'JQ', 'PG': 'PG',
    'WY/G9/9C/DK': 'WY/WK', 'SV/KA/WK': 'WY/WK', 'AK/QZ/8M': 'AK', 'PVT': 'PVT',
}
SHIFT_FILL = {'M': 'FFF3BF', 'A': 'D0EBFF', 'N': 'E5DBFF', 'OFF': 'F1F3F5'}
SHIFT_FONT = {'M': '996A13', 'A': '1864AB', 'N': '5F3DC4', 'OFF': 'ADB5BD'}
ROYAL = '1D428A'


def load_staff(reg_path):
    wb = load_workbook(reg_path, read_only=True, data_only=True)
    ws = wb['ทะเบียน']; it = ws.iter_rows(values_only=True)
    h = list(next(it)); ix = {n: i for i, n in enumerate(h)}
    team_staff = defaultdict(list)
    for r in it:
        if r[ix['EmpID']] is None or str(r[ix['Status']]) != 'Active':
            continue
        tname = REG2TEAM.get(str(r[ix['Team']] or '').strip())
        if not tname:
            continue
        nick = str(r[ix['FirstNameTH']] or '').strip() or str(r[ix['EmpID']])
        team_staff[tname].append({'id': str(r[ix['EmpID']]), 'nick': nick})
    return team_staff


def load_req(req_path):
    wb = load_workbook(req_path, read_only=True, data_only=True)
    ws = wb['ShiftReq_Daily']; it = ws.iter_rows(values_only=True)
    h = list(next(it)); ix = {n: i for i, n in enumerate(h)}
    req = defaultdict(dict)   # team -> date -> (m,a,n)
    dates = []
    for r in it:
        d = r[ix['Date']]; d = d.date() if hasattr(d, 'date') else d
        if d not in dates:
            dates.append(d)
        req[r[ix['Team']]][d] = (int(r[ix['M']]), int(r[ix['A']]), int(r[ix['N']]))
    return req, sorted(set(dates))


def roster_team(staff, req_by_date, dates):
    """คืน assign[date][staff_id]=shift + coverage[date]=(tgt,asg,short per M/A/N)"""
    ids = [s['id'] for s in staff]
    N = len(ids)
    work_cnt = {i: 0 for i in ids}
    night_cnt = {i: 0 for i in ids}
    assign = {}
    coverage = {}
    for d in dates:
        m, a, n = req_by_date.get(d, (0, 0, 0))
        need = m + a + n
        # scale ถ้าคนไม่พอ
        if need > N and need > 0:
            f = N / need
            cm, ca, cn = int(m * f), int(a * f), int(n * f)
            while cm + ca + cn < N:  # แจกเศษ
                if cm < m: cm += 1
                elif cn < n: cn += 1
                elif ca < a: ca += 1
                else: break
        else:
            cm, ca, cn = m, a, n
        on_need = cm + ca + cn
        # OFF = คนทำงานเยอะสุดก่อน
        order = sorted(ids, key=lambda i: (-work_cnt[i], i))
        off = set(order[:max(0, N - on_need)])
        on = [i for i in ids if i not in off]
        # ใส่กะ: N ให้คนได้ดึกน้อยสุดก่อน
        day = {}
        pool = sorted(on, key=lambda i: (night_cnt[i], work_cnt[i], i))
        for i in pool[:cn]:
            day[i] = 'N'; night_cnt[i] += 1
        rest = [i for i in pool if i not in day]
        rest = sorted(rest, key=lambda i: (work_cnt[i], i))
        for i in rest[:cm]:
            day[i] = 'M'
        for i in rest[cm:cm + ca]:
            day[i] = 'A'
        for i in ids:
            s = day.get(i, 'OFF')
            if s != 'OFF':
                work_cnt[i] += 1
            assign.setdefault(d, {})[i] = s
        asg = (cm, ca, cn)
        coverage[d] = ((m, a, n), asg, (m - cm, a - ca, n - cn))
    return assign, coverage


def hdr(ws, n):
    fill = PatternFill('solid', fgColor=ROYAL); font = Font(color='FFFFFF', bold=True)
    for c in range(1, n + 1):
        ws.cell(1, c).fill = fill; ws.cell(1, c).font = font
    ws.freeze_panes = 'C2'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--req', required=True)
    ap.add_argument('--reg', required=True)
    ap.add_argument('-o', '--out', default='Roster.xlsx')
    ap.add_argument('--dataverse', default=None, help='โฟลเดอร์ output CSV pas_duty สำหรับ import')
    args = ap.parse_args()
    duty_rows = []

    team_staff = load_staff(args.reg)
    req, dates = load_req(args.req)
    WD = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา']

    wb = Workbook(); wb.remove(wb.active)
    cov = wb.create_sheet('Coverage')
    cov.append(['Team', 'Date', 'DOW', 'Tgt_M', 'Tgt_A', 'Tgt_N', 'Asg_M', 'Asg_A', 'Asg_N', 'Short_M', 'Short_A', 'Short_N'])

    teams_with = [t for t in req if team_staff.get(t)]
    order = sorted(teams_with, key=lambda t: -len(team_staff[t]))
    for t in order:
        staff = team_staff[t]
        assign, coverage = roster_team(staff, req[t], dates)
        ws = wb.create_sheet(t.replace('/', '-')[:28])
        head = ['รหัส', 'ชื่อ'] + ['%d\n%s' % (d.day, WD[d.weekday()]) for d in dates]
        ws.append(head)
        for s in staff:
            row = [s['id'], s['nick']] + [assign[d][s['id']] for d in dates]
            ws.append(row)
            for d in dates:
                sh = assign[d][s['id']]
                st, en = SHIFT_TIME.get(sh, (None, None))
                duty_rows.append([d.isoformat(), s['id'], s['nick'], t,
                                  ('OFF' if sh == 'OFF' else 'WORKING'),
                                  ('' if sh == 'OFF' else sh),
                                  st if st is not None else '', en if en is not None else ''])
        # ระบายสีกะ
        for ri in range(2, 2 + len(staff)):
            for ci in range(3, 3 + len(dates)):
                v = ws.cell(ri, ci).value
                ws.cell(ri, ci).fill = PatternFill('solid', fgColor=SHIFT_FILL.get(v, 'FFFFFF'))
                ws.cell(ri, ci).font = Font(color=SHIFT_FONT.get(v, '000000'), bold=(v == 'N'))
                ws.cell(ri, ci).alignment = Alignment(horizontal='center')
        hdr(ws, len(head))
        ws.column_dimensions['A'].width = 9; ws.column_dimensions['B'].width = 14
        for ci in range(3, 3 + len(dates)):
            ws.column_dimensions[ws.cell(1, ci).column_letter].width = 5
        ws.row_dimensions[1].height = 30
        # coverage rows
        for d in dates:
            (tm, ta, tn), (am, aa, an), (sm, sa, sn) = coverage[d]
            cov.append([t, d, WD[d.weekday()], tm, ta, tn, am, aa, an, max(sm, 0), max(sa, 0), max(sn, 0)])

    # เน้นแดงช่องขาด
    for ri in range(2, cov.max_row + 1):
        for ci in (10, 11, 12):
            if (cov.cell(ri, ci).value or 0) > 0:
                cov.cell(ri, ci).fill = PatternFill('solid', fgColor='FFC9C9')
    hdr(cov, 12)
    for col in cov.columns:
        cov.column_dimensions[col[0].column_letter].width = 10

    ns = wb.create_sheet('Teams_NoStaff')
    ns.append(['Team', 'หมายเหตุ'])
    for t in req:
        if not team_staff.get(t):
            ns.append([t, 'ไม่มีพนักงานประจำในทะเบียน — ต้องใช้ support/charter/outsource'])
    hdr(ns, 2); ns.column_dimensions['A'].width = 12; ns.column_dimensions['B'].width = 60

    # เรียง Coverage ไว้หน้าสุด
    wb.move_sheet('Coverage', -(len(wb.sheetnames) - 1))
    wb.save(args.out)

    if args.dataverse:
        os.makedirs(args.dataverse, exist_ok=True)
        fp = os.path.join(args.dataverse, 'pas_duty_roster.csv')
        with open(fp, 'w', newline='', encoding='utf-8-sig') as fh:
            w = csv.writer(fh)
            w.writerow(['pas_work_date', 'EmpCode(pas_employee)', 'pas_emp_name', 'Team(pas_team)',
                        'pas_bucket', 'pas_shift_code', 'pas_shift_start', 'pas_shift_end'])
            w.writerows(duty_rows)
        print('dataverse pas_duty:', fp, '(%d rows)' % len(duty_rows))
    tot_short = sum(1 for ri in range(2, cov.max_row + 1)
                    if any((cov.cell(ri, c).value or 0) > 0 for c in (10, 11, 12)))
    print('saved', args.out)
    print('teams rostered:', len(teams_with), '| team-days with shortfall:', tot_short)
    print('teams w/o staff:', [t for t in req if not team_staff.get(t)])


if __name__ == '__main__':
    main()
