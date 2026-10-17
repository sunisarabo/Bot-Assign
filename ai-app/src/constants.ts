// Corporate identity palette (matches WebDashboard.gs `CI`).
export const CI = {
  royal: '#1D428A',
  bosch: '#236192',
  sky: '#4EC3E0',
  teal: '#3FBCBE',
  yellow: '#FEC909',
  red: '#D92526',
  grey: '#7C878F',
  good: '#1BA37A',
  sub: '#5a6b86',
};

export const MONW = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export const DOWW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

export const PSA_POS_ORDER = ['PSS', 'SNR', 'PSA', 'Globlex', 'AdminD', 'Porter', 'Crewsign', 'DIR', 'MGR', 'Assist'];

// Per-airline daily SLA requirement [SUP, CI, ARR, GATE, total] — from SLA.gs `SLA_RQ`.
export const SLA_RQ: Record<string, [number, number, number, number, number]> = {
  '3K': [2, 4, 1, 2, 8], '3U': [2, 4, 1, 2, 8], '6B': [2, 5, 2, 2, 10], '6E': [2, 5, 1, 6, 9],
  '8L': [2, 4, 1, 2, 8], '8M': [2, 3, 1, 2, 7], '9C': [2, 5, 1, 2, 9], '9H': [2, 4, 1, 2, 8],
  'AF': [2, 9, 1, 2, 13], 'AI': [2, 6, 1, 2, 10], 'AK': [2, 3, 1, 2, 7], 'AQ': [2, 3, 1, 2, 7],
  'AY': [2, 5, 1, 2, 9], 'BY': [2, 5, 2, 2, 10], 'C6': [2, 4, 1, 2, 8], 'CA': [2, 6, 1, 2, 10],
  'CX': [2, 6, 2, 2, 11], 'CZ': [2, 6, 1, 2, 10], 'DE': [2, 6, 2, 2, 11], 'DK': [2, 7, 1, 2, 11],
  'DV': [2, 4, 1, 2, 8], 'EK': [2, 7, 3, 2, 13], 'EO': [2, 6, 1, 2, 10], 'EY': [2, 9, 1, 2, 13],
  'FM': [2, 4, 1, 2, 8], 'FY': [2, 4, 1, 2, 8], 'G2': [2, 6, 1, 2, 10], 'G8': [2, 4, 1, 2, 8],
  'G9': [2, 4, 1, 2, 8], 'HB': [2, 4, 1, 2, 8], 'HH': [2, 4, 1, 2, 8], 'HO': [2, 4, 1, 2, 8],
  'HU': [2, 6, 1, 2, 10], 'HX': [2, 5, 1, 2, 9], 'HY': [2, 5, 1, 2, 9], 'IT': [2, 4, 1, 2, 8],
  'JQ': [2, 7, 1, 3, 11], 'KC': [2, 5, 1, 2, 9], 'KE': [2, 8, 1, 2, 12], 'KY': [2, 3, 1, 2, 7],
  'LJ': [2, 4, 1, 2, 8], 'LO': [2, 6, 1, 2, 10], 'LY': [2, 8, 1, 2, 12], 'MH': [2, 4, 1, 2, 8],
  'MU': [2, 4, 1, 2, 8], 'N0': [2, 5, 1, 2, 9], 'N4': [2, 6, 1, 2, 10], 'NO': [2, 6, 1, 2, 10],
  'OD': [2, 5, 1, 2, 9], 'OM': [2, 4, 1, 2, 8], 'OQ': [2, 4, 1, 2, 8], 'OV': [2, 4, 1, 2, 8],
  'OZ': [2, 6, 1, 2, 10], 'PG': [2, 0, 1, 2, 5], 'PN': [2, 4, 1, 2, 8], 'QR': [2, 9, 2, 2, 14],
  'QZ': [1, 3, 1, 1, 7], 'S7': [2, 4, 1, 2, 8], 'SG': [2, 4, 1, 2, 8], 'SQ': [2, 5, 1, 2, 9],
  'SU': [2, 8, 1, 2, 12], 'TK': [2, 8, 4, 2, 15], 'TR': [2, 6, 1, 2, 10], 'U6': [2, 4, 1, 2, 8],
  'UO': [2, 4, 2, 2, 9], 'VJ': [2, 5, 1, 2, 9], 'W5': [2, 7, 1, 2, 11], 'WK': [2, 6, 1, 2, 10],
  'WY': [2, 7, 1, 2, 11], 'WZ': [2, 6, 1, 2, 10], 'ZF': [2, 6, 1, 2, 10], 'ZH': [2, 4, 1, 2, 8],
};

export const SLA_ALIAS: Record<string, string> = {
  '8M': 'QZ', 'VN': 'HY', '3K': 'JQ', 'HB': 'HX', 'WZ': 'ZF', 'N4': 'EO', 'C6': 'LO',
  'G2': 'LO', 'H4': 'LO', 'ZH': 'CA', 'PN': 'CA', 'OQ': 'CA', 'GX': 'CA', 'KX': 'CA',
  '8H': 'CA', '9H': 'CA', 'BK': 'CA', 'PVT': 'PRIVATE',
};

// Airline → check-in system (SLA.gs `AIRLINE_SYS`, trimmed to the common carriers).
export const AIRLINE_SYS: Record<string, string> = {
  'SQ': 'Altea', 'CX': 'Altea', 'LY': 'Altea', 'QR': 'Altea', 'EK': 'AS Connect', 'SU': 'ASTRA',
  'AK': 'Gonow', 'QZ': 'Gonow', 'PG': 'Altea', 'TR': 'Gonow', 'TK': 'TOYA', 'WY': 'Sabre',
  'KE': 'Altea', 'EY': 'Altea', 'JQ': 'Gonow', 'CA': 'TravelSky', 'VJ': 'iPort', 'W5': 'AVIA',
};
