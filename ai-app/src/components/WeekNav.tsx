import { MONW, DOWW } from '../constants';

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function WeekNav({ iso, onPick }: { iso: string; onPick: (iso: string) => void }) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const chips = [];
  for (let off = -7; off <= 7; off++) {
    const dd = new Date(date.getFullYear(), date.getMonth(), date.getDate() + off);
    const i = toISO(dd);
    chips.push(
      <a
        key={i}
        className={'wk' + (i === iso ? ' sel' : '')}
        onClick={() => onPick(i)}
        style={{ cursor: 'pointer' }}
      >
        <span className="wd">{DOWW[dd.getDay()]}</span>
        <span className="wn tnum">{dd.getDate()}</span>
        <span className="wm">{MONW[dd.getMonth()]}</span>
      </a>,
    );
  }
  const shift = (delta: number) => {
    const dd = new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta);
    onPick(toISO(dd));
  };
  return (
    <div className="weeknav">
      <div className="weeknav__date">
        <button className="iconbtn" onClick={() => shift(-1)}>
          ‹
        </button>
        <button className="iconbtn" onClick={() => shift(1)}>
          ›
        </button>
        <input type="date" value={iso} onChange={(e) => e.target.value && onPick(e.target.value)} />
      </div>
      <div className="weeknav__strip">{chips}</div>
    </div>
  );
}
