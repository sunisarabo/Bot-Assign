import { useMemo, useState } from 'react';
import type { RosterRecord, RosterResult } from '../types';
import { isFlight } from '../services/sla';

const BUCKET_ORDER: Record<string, number> = { working: 0, ot_off: 1, off: 2, vac: 3, sick: 4 };
const ST_LABEL: Record<string, string> = { off: '⬛ OFF', sick: '🔴 SL (ป่วย)', vac: '🌴 ลา' };
const ST_CLASS: Record<string, string> = { off: 'row-off', sick: 'row-sl', vac: 'row-vac' };

function flightCount(r: RosterRecord) {
  return (r.assignments || []).filter((a) => isFlight(a.flight)).length;
}

export default function Timetable({ res }: { res: RosterResult }) {
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const all: RosterRecord[] = [];
    Object.keys(res.teams).forEach((t) => res.teams[t].records!.forEach((r) => all.push(r)));
    all.sort(
      (a, b) =>
        String(a.team).localeCompare(String(b.team)) ||
        (BUCKET_ORDER[a.bucket] || 0) - (BUCKET_ORDER[b.bucket] || 0) ||
        (a.shiftStart == null ? 99999 : a.shiftStart) - (b.shiftStart == null ? 99999 : b.shiftStart),
    );
    return all;
  }, [res]);

  const ql = q.toLowerCase();
  const visible = rows.filter((r) => !ql || (r.team + ' ' + r.name + ' ' + r.id + ' ' + r.pos).toLowerCase().includes(ql));

  return (
    <div className="tablecard">
      <div className="tablecard__hd">
        <h3>🕓 Timetable · ตารางงานรายคน</h3>
        <div className="search">
          <input placeholder="🔎 ค้นหา ทีม / ชื่อ / รหัส" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>ทีม</th>
              <th>รหัส</th>
              <th>ชื่อ</th>
              <th>ตำแหน่ง</th>
              <th>กะ (เข้า-ออก)</th>
              <th>OT</th>
              <th>#</th>
              <th>เที่ยวบิน</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => {
              const lbl = ST_LABEL[r.bucket];
              if (lbl) {
                return (
                  <tr key={i} className={ST_CLASS[r.bucket]}>
                    <td className="b">{r.team}</td>
                    <td className="tnum">{r.id}</td>
                    <td>{r.name}</td>
                    <td>{r.pos}</td>
                    <td className="b">{lbl}</td>
                    <td className="muted">—</td>
                    <td className="tnum">0</td>
                    <td className="muted">—</td>
                  </tr>
                );
              }
              const shiftCell = r.shiftTime && r.shiftTime !== r.shift ? `${r.shift} ${r.shiftTime}` : r.shift;
              const otCell = r.ot
                ? `${r.bucket === 'ot_off' ? 'OFF' : r.otType === 'PRE' ? 'ก่อน' : 'หลัง'} ${r.otTime} (${r.ot}h)`
                : '—';
              return (
                <tr key={i}>
                  <td className="b">{r.team}</td>
                  <td className="tnum">{r.id}</td>
                  <td>{r.name}</td>
                  <td>{r.pos}</td>
                  <td>{shiftCell}</td>
                  <td className={r.ot ? '' : 'muted'}>{otCell}</td>
                  <td className="tnum">{flightCount(r)}</td>
                  <td>
                    {r.assignments && r.assignments.length ? (
                      <div className="chipgroup">
                        {r.assignments.map((a, j) => (
                          <span key={j} className={isFlight(a.flight) ? 'chip' : 'chip chip--duty'}>
                            {a.flight}
                            {a.task ? <span className="tag" style={{ marginLeft: 5 }}>{a.task}</span> : null}
                            {a.STA || a.STD ? ` ${a.STA || '–'}/${a.STD || '–'}` : ''}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
