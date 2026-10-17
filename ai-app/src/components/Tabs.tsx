export type TabId = 'dash' | 'tt' | 'flt' | 'ai';

const TABS: { id: TabId; label: string }[] = [
  { id: 'dash', label: '▦ Dashboard' },
  { id: 'tt', label: '☰ Timetable' },
  { id: 'flt', label: '✈ Flights & SLA' },
  { id: 'ai', label: '🤖 AI Assistant' },
];

export default function Tabs({
  active,
  onChange,
  shortCount,
}: {
  active: TabId;
  onChange: (t: TabId) => void;
  shortCount: number;
}) {
  return (
    <div className="tabs">
      {TABS.map((t) => (
        <button
          key={t.id}
          className={'tab' + (active === t.id ? ' active' : '')}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.id === 'flt' && shortCount > 0 && <span className="badge tnum">{shortCount}</span>}
        </button>
      ))}
    </div>
  );
}
