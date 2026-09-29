// Representative sample roster — lets the app run standalone in AI Studio.
// Replace by wiring VITE_ROSTER_ENDPOINT to a deployed Apps Script JSON endpoint.
import type { Assignment, Bucket, OtType, RosterRecord } from '../types';

function toMin(hhmm: string): number | null {
  const m = String(hhmm || '').match(/(\d{1,2}):(\d{2})/);
  return m ? +m[1] * 60 + +m[2] : null;
}

interface Seed {
  team: string;
  id: string;
  name: string;
  pos: string;
  posGroup: string;
  shift: string;
  shiftTime?: string;
  bucket: Bucket;
  ot?: number;
  otType?: OtType;
  otTime?: string;
  flights?: Assignment[];
}

function f(flight: string, task: string, STA: string, STD: string, OP = '', CL = ''): Assignment {
  return { flight, task, STA, STD, OP, CL };
}

function rec(s: Seed): RosterRecord {
  const shiftTime = s.shiftTime || (s.bucket === 'working' || s.bucket === 'ot_off' ? s.shift : '');
  const start = toMin(shiftTime.split('-')[0] || '');
  let hrs = 0;
  const parts = shiftTime.split('-');
  if (parts.length === 2) {
    const a = toMin(parts[0]);
    let b = toMin(parts[1]);
    if (a != null && b != null) {
      if (b <= a) b += 1440;
      hrs = Math.round(((b - a) / 60) * 10) / 10;
    }
  }
  return {
    team: s.team, id: s.id, name: s.name, pos: s.pos, posGroup: s.posGroup,
    shift: s.shift, shiftTime, shiftStart: start, shiftHrs: hrs,
    bucket: s.bucket, ot: s.ot || 0, otType: s.otType || null, otTime: s.otTime || '',
    assignments: s.flights || [],
  };
}

const SEEDS: Seed[] = [
  // ── SQ ──────────────────────────────────────────────────────────────────
  { team: 'SQ', id: '210045', name: 'SOMCHAI P.', pos: 'PSS', posGroup: 'PSS', shift: '04:00-13:00', bucket: 'working',
    flights: [f('SQ979', 'SUP', '07:30', '08:40'), f('SQ971', 'SUP', '11:05', '12:20')] },
  { team: 'SQ', id: '210112', name: 'NATTHAYA K.', pos: 'SNR PSA', posGroup: 'SNR', shift: '04:00-13:00', bucket: 'working', ot: 2, otType: 'POST', otTime: '13:00-15:00',
    flights: [f('SQ979', 'CT1/GK', '07:30', '08:40')] },
  { team: 'SQ', id: '210220', name: 'WIROJ T.', pos: 'PSA', posGroup: 'PSA', shift: '04:00-13:00', bucket: 'working',
    flights: [f('SQ979', 'CT', '07:30', '08:40')] },
  { team: 'SQ', id: '210301', name: 'KANYA S.', pos: 'PSA', posGroup: 'PSA', shift: '04:00-13:00', bucket: 'working',
    flights: [f('SQ979', 'CT', '07:30', '08:40')] },
  { team: 'SQ', id: '210377', name: 'PRAYUT M.', pos: 'PSA', posGroup: 'PSA', shift: 'X', bucket: 'off' },
  { team: 'SQ', id: '210410', name: 'DUANGJAI L.', pos: 'PSA', posGroup: 'PSA', shift: 'SL', bucket: 'sick' },
  { team: 'SQ', id: '210512', name: 'ARTHIT C.', pos: 'PSA', posGroup: 'PSA', shift: 'X', bucket: 'ot_off', ot: 6, otTime: '06:00-12:00',
    flights: [f('SQ971', 'GATE', '11:05', '12:20')] },

  // ── QR ──────────────────────────────────────────────────────────────────
  { team: 'QR', id: '220011', name: 'CHALERM R.', pos: 'PSS', posGroup: 'PSS', shift: '05:00-14:00', bucket: 'working',
    flights: [f('QR835', 'SUP', '08:15', '09:30')] },
  { team: 'QR', id: '220078', name: 'SUDARAT W.', pos: 'SNR PSA', posGroup: 'SNR', shift: '05:00-14:00', bucket: 'working', ot: 1.5, otType: 'POST', otTime: '14:00-15:30',
    flights: [f('QR835', 'FC', '08:15', '09:30')] },
  { team: 'QR', id: '220140', name: 'NIRAN P.', pos: 'PSA', posGroup: 'PSA', shift: '05:00-14:00', bucket: 'working',
    flights: [f('QR835', 'CT/G', '08:15', '09:30')] },
  { team: 'QR', id: '220155', name: 'PIMCHANOK A.', pos: 'PSA', posGroup: 'PSA', shift: '05:00-14:00', bucket: 'working',
    flights: [f('QR835', 'CT/G', '08:15', '09:30')] },
  { team: 'QR', id: '220190', name: 'THANES B.', pos: 'PSA', posGroup: 'PSA', shift: 'VAC', bucket: 'vac' },
  { team: 'QR', id: '220233', name: 'WARUNEE J.', pos: 'PSA', posGroup: 'PSA', shift: 'X', bucket: 'off' },

  // ── EK ──────────────────────────────────────────────────────────────────
  { team: 'EK', id: '230009', name: 'KRIT S.', pos: 'PSS', posGroup: 'PSS', shift: '03:30-12:30', bucket: 'working',
    flights: [f('EK373', 'SPVR', '06:00', '07:15'), f('EK385', 'SPVR', '10:40', '11:55')] },
  { team: 'EK', id: '230044', name: 'MALEE T.', pos: 'PSA', posGroup: 'PSA', shift: '03:30-12:30', bucket: 'working',
    flights: [f('EK373', 'CT/G', '06:00', '07:15')] },
  { team: 'EK', id: '230087', name: 'SAKDA P.', pos: 'PSA', posGroup: 'PSA', shift: '03:30-12:30', bucket: 'working',
    flights: [f('EK373', 'ARR', '06:00', '07:15')] },
  { team: 'EK', id: '230112', name: 'JIRAPORN N.', pos: 'PSA', posGroup: 'PSA', shift: '03:30-12:30', bucket: 'working', ot: 3, otType: 'POST', otTime: '12:30-15:30',
    flights: [f('EK385', 'GK/BIR', '10:40', '11:55')] },
  { team: 'EK', id: '230145', name: 'BOONMEE K.', pos: 'PSA', posGroup: 'PSA', shift: 'X', bucket: 'off' },

  // ── AK ──────────────────────────────────────────────────────────────────
  { team: 'AK', id: '240020', name: 'PHONGSAK D.', pos: 'PSS', posGroup: 'PSS', shift: '05:30-14:30', bucket: 'working',
    flights: [f('AK887', 'SPVR G', '09:00', '10:10')] },
  { team: 'AK', id: '240051', name: 'RATCHANEE O.', pos: 'PSA', posGroup: 'PSA', shift: '05:30-14:30', bucket: 'working',
    flights: [f('AK887', 'C', '09:00', '10:10')] },
  { team: 'AK', id: '240066', name: 'WICHAI L.', pos: 'PSA', posGroup: 'PSA', shift: '05:30-14:30', bucket: 'working',
    flights: [f('AK887', 'C', '09:00', '10:10')] },
  { team: 'AK', id: '240099', name: 'SIRIPORN T.', pos: 'PSA', posGroup: 'PSA', shift: 'SL', bucket: 'sick' },

  // ── PG ──────────────────────────────────────────────────────────────────
  { team: 'PG', id: '250015', name: 'ANUCHA W.', pos: 'PSS', posGroup: 'PSS', shift: '06:00-15:00', bucket: 'working',
    flights: [f('PG211', 'SUP', '08:30', '09:00'), f('PG215', 'GM', '12:10', '12:40')] },
  { team: 'PG', id: '250048', name: 'KultIDA P.', pos: 'PSA', posGroup: 'PSA', shift: '06:00-15:00', bucket: 'working',
    flights: [f('PG211', 'G', '08:30', '09:00')] },
  { team: 'PG', id: '250072', name: 'SOMPONG R.', pos: 'PSA', posGroup: 'PSA', shift: 'X', bucket: 'off' },

  // ── Porter (skipped by SLA) ───────────────────────────────────────────────
  { team: 'PORTER', id: '', name: 'CHAIYO S.', pos: 'PORTER', posGroup: 'Porter', shift: '06:00-15:00', bucket: 'working' },
  { team: 'PORTER', id: '', name: 'MANOP K.', pos: 'PORTER', posGroup: 'Porter', shift: 'X', bucket: 'off' },
];

export const SAMPLE_RECORDS: RosterRecord[] = SEEDS.map(rec);
