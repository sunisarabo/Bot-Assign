import { useMemo } from 'react';
import type { FlightCoverage, Phase, RosterResult } from '../types';
import { collectFlights, systemOf } from '../services/sla';

const PH_LABEL: Record<Phase, string> = { SUP: 'SUP', CI: 'Check-in', GATE: 'Gate', ARR: 'Arrival' };

function cell(f: FlightCoverage, ph: Phase) {
  const short = f.short[ph];
  return (
    <td className={'tnum ' + (short ? 'badd' : 'okk')}>
      {f.assigned[ph]}/{f.req[ph]}
      {short ? ` ▼${short}` : ' ✓'}
    </td>
  );
}

function shortText(f: FlightCoverage): string {
  const parts = (['SUP', 'CI', 'GATE', 'ARR'] as Phase[])
    .filter((ph) => f.short[ph])
    .map((ph) => `${PH_LABEL[ph]} ขาด ${f.short[ph]}`);
  return parts.join(' · ') || (f.shortTotal ? `ขาดรวม ${f.shortTotal}` : '');
}

export default function FlightsSLA({ res }: { res: RosterResult }) {
  const flights = useMemo(() => collectFlights(res), [res]);
  const shortN = flights.filter((f) => !f.ok).length;

  return (
    <>
      <div className="sectionlabel">
        ไฟลท์รวม {flights.length} · คนไม่ครบตาม SLA{' '}
        <b className={shortN ? 'badd' : 'okk'}>{shortN} ไฟลท์</b> — ต้องการคนตาม SUP / Check-in / Gate / Arrival
      </div>
      <div className="tablecard">
        <div className="tablecard__hd">
          <h3>✈️ ไฟลท์บินประจำวัน + เช็ค SLA สายการบิน</h3>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Flight</th>
                <th>สายการบิน</th>
                <th>ระบบ</th>
                <th>ทีม</th>
                <th>STA</th>
                <th>STD</th>
                <th>ส่ง/ต้องการ</th>
                <th>SUP</th>
                <th>Check-in</th>
                <th>Gate</th>
                <th>Arrival</th>
                <th>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {flights.map((f) => (
                <tr key={f.flight} className={f.ok ? '' : 'rowbad'}>
                  <td className="b">{f.flight}</td>
                  <td>{f.airline}</td>
                  <td className="muted">{systemOf(f.airline) || 'iPort'}</td>
                  <td>{f.teamList}</td>
                  <td className="tnum">{f.STA}</td>
                  <td className="tnum">{f.STD}</td>
                  <td className="tnum">
                    <b>{f.assigned.total}</b>/{f.req.total}
                  </td>
                  {cell(f, 'SUP')}
                  {cell(f, 'CI')}
                  {cell(f, 'GATE')}
                  {cell(f, 'ARR')}
                  <td>
                    {f.ok ? (
                      <span className="okk">✅ ครบ</span>
                    ) : (
                      <span className="badd">⚠️ {shortText(f)}</span>
                    )}
                  </td>
                </tr>
              ))}
              {flights.length === 0 && (
                <tr>
                  <td colSpan={12} className="muted" style={{ textAlign: 'center', padding: 20 }}>
                    — ไม่มีไฟลท์
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
