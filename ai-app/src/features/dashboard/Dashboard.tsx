import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Agg, RosterResult } from '../../types';
import { CI, PSA_POS_ORDER } from '../../constants';

function KpiHero({ T }: { T: Agg }) {
  const work = T.working + T.ot_off;
  const attPct = T.staff > 0 ? Math.round((work / T.staff) * 100) : 0;
  const avg = T.otPeople > 0 ? Math.round((T.otHours / T.otPeople) * 10) / 10 : 0;
  const cards = [
    { ico: '👥', c: CI.royal, val: T.staff, lbl: 'Total Staff', sub: 'พนักงานทั้งหมด', trend: '' },
    { ico: '✅', c: CI.good, val: work, lbl: 'Working', sub: 'มาปฏิบัติงาน', trend: attPct + '%' },
    { ico: '⬛', c: CI.grey, val: T.off, lbl: 'OFF', sub: 'วันหยุด', trend: '' },
    { ico: '🟡', c: CI.yellow, val: T.ot_off, lbl: 'OT OFF', sub: 'ทำ OT วันหยุด', trend: T.otOffHrs + 'h' },
    { ico: '⏰', c: CI.red, val: T.otPeople, lbl: 'OT · People', sub: 'พนักงานทำ OT', trend: '' },
    { ico: '⏱️', c: CI.bosch, val: T.otHours, lbl: 'OT · Hours', sub: 'ชั่วโมง OT รวม', trend: avg + 'h/คน' },
  ];
  return (
    <div className="kpis">
      {cards.map((d) => (
        <div className="kpi" key={d.lbl} style={{ ['--c' as any]: d.c }}>
          <div className="kpi__top">
            <div className="kpi__ico" style={{ ['--c' as any]: d.c }}>
              {d.ico}
            </div>
            {d.trend && <div className="kpi__trend">{d.trend}</div>}
          </div>
          <div className="kpi__val tnum">{d.val}</div>
          <div className="kpi__lbl">{d.lbl}</div>
          <div className="kpi__sub">{d.sub}</div>
        </div>
      ))}
    </div>
  );
}

function ManpowerTable({ res, order }: { res: RosterResult; order: string[] }) {
  return (
    <div className="tablecard">
      <div className="tablecard__hd">
        <h3>📌 Manpower by Team</h3>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>ทีม</th>
              <th>Total</th>
              <th>Working</th>
              <th>OFF</th>
              <th>Vac</th>
              <th>OT-Off</th>
              <th>OT ก่อน</th>
              <th>OT หลัง</th>
              <th>%Working</th>
            </tr>
          </thead>
          <tbody>
            {order.map((t) => {
              const b = res.teams[t];
              const work = b.working + b.ot_off;
              const pct = b.staff > 0 ? Math.round((work / b.staff) * 100) : 0;
              return (
                <tr key={t}>
                  <td className="b">{t}</td>
                  <td className="tnum">{b.staff}</td>
                  <td className="tnum">
                    <b>{work}</b>
                  </td>
                  <td className="tnum">{b.off}</td>
                  <td className="tnum">{b.leave}</td>
                  <td className="tnum">{b.ot_off > 0 ? `${b.ot_off} (${b.otOffHrs}h)` : '·'}</td>
                  <td className="tnum">{b.otPre > 0 ? `${b.otPre} (${b.otPreHrs}h)` : '·'}</td>
                  <td className="tnum">{b.otPost > 0 ? `${b.otPost} (${b.otPostHrs}h)` : '·'}</td>
                  <td style={{ minWidth: 90 }}>
                    <div className="barmini">
                      <i style={{ width: pct + '%' }} />
                      <b>{pct}%</b>
                    </div>
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

function PositionTable({ res }: { res: RosterResult }) {
  const order = PSA_POS_ORDER.filter((p) => res.positions[p]);
  return (
    <div className="tablecard">
      <div className="tablecard__hd">
        <h3>👥 By Position</h3>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>ตำแหน่ง</th>
              <th>Total</th>
              <th>Work</th>
              <th>OT-Off</th>
              <th>Off</th>
              <th>Sick</th>
              <th>Leave</th>
              <th>OT ก่อน</th>
              <th>OT หลัง</th>
            </tr>
          </thead>
          <tbody>
            {order.map((p) => {
              const b = res.positions[p];
              return (
                <tr key={p}>
                  <td className="b">{p}</td>
                  <td className="tnum">{b.staff}</td>
                  <td className="tnum">
                    <b>{b.working + b.ot_off}</b>
                  </td>
                  <td className="tnum">{b.ot_off > 0 ? `${b.ot_off} (${b.otOffHrs}h)` : '·'}</td>
                  <td className="tnum">{b.off}</td>
                  <td className="tnum">{b.sick}</td>
                  <td className="tnum">{b.leave}</td>
                  <td className="tnum">{b.otPre > 0 ? `${b.otPre} (${b.otPreHrs}h)` : '·'}</td>
                  <td className="tnum">{b.otPost > 0 ? `${b.otPost} (${b.otPostHrs}h)` : '·'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Dashboard({ res }: { res: RosterResult }) {
  const T = res.totals;
  const teamOrder = Object.keys(res.teams).sort(
    (a, b) => res.teams[b].working + res.teams[b].ot_off - (res.teams[a].working + res.teams[a].ot_off),
  );

  const teamData = teamOrder.map((t) => ({
    name: t,
    Working: res.teams[t].working + res.teams[t].ot_off,
    Total: res.teams[t].staff,
  }));
  const statusData = [
    { name: 'Working', value: T.working + T.ot_off, fill: CI.teal },
    { name: 'OFF', value: T.off, fill: CI.grey },
    { name: 'Sick', value: T.sick, fill: CI.red },
    { name: 'Leave', value: T.leave, fill: CI.yellow },
  ];
  const otData = [
    { name: 'ก่อนกะ', คน: T.otPre, ชม: T.otPreHrs, fill: CI.yellow },
    { name: 'หลังกะ', คน: T.otPost, ชม: T.otPostHrs, fill: CI.royal },
    { name: 'OT OFF', คน: T.ot_off, ชม: T.otOffHrs, fill: CI.red },
  ];

  return (
    <div>
      <KpiHero T={T} />

      <div className="grid grid--charts" style={{ marginTop: 16 }}>
        <div className="panel">
          <div className="panel__hd">
            <h3>📊 Working / Total ต่อทีม</h3>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={teamData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="Working" fill={CI.teal} radius={[5, 5, 0, 0]} />
              <Bar dataKey="Total" fill="#c9d6e8" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="panel">
          <div className="panel__hd">
            <h3>🧭 ภาพรวมสถานะ</h3>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={80} paddingAngle={2}>
                {statusData.map((d, i) => (
                  <Cell key={i} fill={d.fill} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid--charts" style={{ marginTop: 16 }}>
        <div className="panel">
          <div className="panel__hd">
            <h3>⏱️ OT แยกประเภท (คน / ชม.)</h3>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={otData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="คน" fill={CI.bosch} radius={[6, 6, 0, 0]} />
              <Bar dataKey="ชม" fill={CI.sky} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="panel">
          <div className="otsplit">
            <div className="otrow">
              <span>⏱️ OT ก่อนกะ</span>
              <b className="tnum">
                {T.otPre} คน · {T.otPreHrs}h
              </b>
            </div>
            <div className="otrow">
              <span>⏱️ OT หลังกะ</span>
              <b className="tnum">
                {T.otPost} คน · {T.otPostHrs}h
              </b>
            </div>
            <div className="otrow">
              <span>⏱️ OT OFF</span>
              <b className="tnum">
                {T.ot_off} คน · {T.otOffHrs}h
              </b>
            </div>
            <div className="otrow">
              <span>รวม OT</span>
              <b className="tnum">
                {T.otPeople} คน · {T.otHours}h
              </b>
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <ManpowerTable res={res} order={teamOrder} />
      </div>
      <div style={{ marginTop: 16 }}>
        <PositionTable res={res} />
      </div>
    </div>
  );
}
