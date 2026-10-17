import { MONW } from '../constants';

export default function AppBar({ date }: { date: Date }) {
  const be = date.getFullYear() + 543;
  return (
    <div className="appbar">
      <div className="appbar__row">
        <div className="brand">
          <div className="brand__mark">✈</div>
          <div>
            <h1>
              AOT<span>GA</span>
            </h1>
            <p>Passenger Services · การโดยสาร</p>
          </div>
        </div>
        <div className="appbar__meta">
          <div className="datepill">
            <div className="d tnum">
              {date.getDate()} {MONW[date.getMonth()]} {be}
            </div>
            <div className="s">Daily Manpower · ตารางกำลังพลรายวัน</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
            <div className="livedot">
              <i />
              Live
            </div>
            <button className="btn btn--accent" onClick={() => window.print()}>
              ⬇ Export PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
