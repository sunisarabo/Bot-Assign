import { useEffect, useMemo, useState } from 'react';
import type { RosterResult } from './types';
import { loadRoster } from './services/rosterService';
import { collectFlights } from './services/sla';
import { MONW } from './constants';
import AppBar from './components/AppBar';
import WeekNav from './components/WeekNav';
import Tabs, { type TabId } from './components/Tabs';
import Dashboard from './components/Dashboard';
import Timetable from './components/Timetable';
import FlightsSLA from './components/FlightsSLA';
import AiAssistant from './components/AiAssistant';

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fromISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export default function App() {
  const [iso, setIso] = useState<string>(toISO(new Date(2026, 5, 10)));
  const [tab, setTab] = useState<TabId>('dash');
  const [res, setRes] = useState<RosterResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadRoster(iso).then((r) => {
      if (alive) {
        setRes(r);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [iso]);

  const date = fromISO(iso);
  const dateStr = `${date.getDate()} ${MONW[date.getMonth()]} ${date.getFullYear() + 543}`;

  const shortCount = useMemo(() => (res ? collectFlights(res).filter((f) => !f.ok).length : 0), [res]);

  return (
    <div className="wrap">
      <AppBar date={date} />
      <WeekNav iso={iso} onPick={setIso} />
      <Tabs active={tab} onChange={setTab} shortCount={shortCount} />

      {loading || !res ? (
        <div className="panel muted" style={{ textAlign: 'center', padding: 40 }}>
          ⏳ กำลังโหลดข้อมูลกำลังพล…
        </div>
      ) : (
        <>
          {tab === 'dash' && <Dashboard res={res} />}
          {tab === 'tt' && <Timetable res={res} />}
          {tab === 'flt' && <FlightsSLA res={res} />}
          {tab === 'ai' && <AiAssistant res={res} dateStr={dateStr} />}
        </>
      )}

      <div className="foot">
        บริษัท บริการภาคพื้น ท่าอากาศยานไทย จำกัด (<b>AOTGA</b>) · Passenger Services · React + Gemini
      </div>
    </div>
  );
}
