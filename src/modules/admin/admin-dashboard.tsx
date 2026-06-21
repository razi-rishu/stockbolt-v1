/**
 * StockBolt Admin — platform-owner dashboard (cross-tenant).
 *
 * Reached only via the /admin route, which is guarded by RequirePlatformAdmin.
 * All data comes from the get_admin_dashboard RPC, which itself refuses any
 * caller that isn't in platform_admins — so this is never customer-reachable.
 */
import { useQuery } from '@tanstack/react-query';
import { formatDate } from '@/lib/locale';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import type { AdminDashboard } from '@/data/adapter';

function fmtNum(n: number): string {
  return Number(n ?? 0).toLocaleString('en-US');
}
function fmtBytes(b: number): string {
  const n = Number(b ?? 0);
  if (n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

interface Tile {
  label: string;
  value: string;
  hint?: string;
  stub?: boolean;
  accent?: string;
}

export default function AdminDashboardPage() {
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useQuery<AdminDashboard>({
    queryKey: ['admin_dashboard'],
    queryFn: () => getAdapter().admin.getDashboard(),
    refetchOnWindowFocus: false,
  });

  const d = data;
  const tiles: Tile[] = d ? [
    { label: 'Total Companies',    value: fmtNum(d.total_companies),   accent: '#7c3aed' },
    { label: 'Active Companies',   value: fmtNum(d.active_companies),  hint: 'Posted activity in last 30 days', accent: '#059669' },
    { label: 'New Registrations',  value: fmtNum(d.new_registrations), hint: 'Last 30 days', accent: '#2563eb' },
    { label: 'Total Users',        value: fmtNum(d.total_users) },
    { label: 'Total Invoices',     value: fmtNum(d.total_invoices) },
    { label: 'Total Products',     value: fmtNum(d.total_products) },
    { label: 'Database Usage',     value: fmtBytes(d.database_bytes) },
    { label: 'Storage Usage',      value: fmtBytes(d.storage_bytes) },
    { label: 'Failed Logins',      value: fmtNum(d.failed_logins_30d), hint: 'Last 30 days', accent: d.failed_logins_30d > 0 ? '#dc2626' : undefined },
    { label: 'Subscription Status', value: d.subscription_status ?? 'Not set up yet', stub: d.subscription_status == null },
    { label: 'Error Logs',          value: d.error_logs_count == null ? 'Not set up yet' : fmtNum(d.error_logs_count), stub: d.error_logs_count == null },
    { label: 'Support Tickets',     value: d.support_tickets_open == null ? 'Not set up yet' : fmtNum(d.support_tickets_open), stub: d.support_tickets_open == null },
  ] : [];

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg,#0f172a 0%,#1e293b 60%,#312e81 100%)', padding: '28px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
        <span style={{ fontSize: '22px' }}>🛡️</span>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: '#fff', letterSpacing: '-.01em' }}>StockBolt Admin</h1>
        <span style={{ marginInlineStart: '8px', padding: '3px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 700, background: 'rgba(124,58,237,.25)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,.5)' }}>
          PLATFORM OWNER
        </span>
        <button
          onClick={() => navigate('/dashboard')}
          style={{ marginInlineStart: 'auto', fontSize: '12px', color: '#cbd5e1', background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)', borderRadius: '8px', padding: '6px 12px', cursor: 'pointer' }}
        >← Back to app</button>
      </div>
      <p style={{ margin: '0 0 22px', fontSize: '12.5px', color: '#94a3b8' }}>
        Cross-tenant overview. Visible only to platform owners.
        {d?.generated_at && <span> · as of {d.generated_at.replace('T', ' ').replace('Z', ' UTC')}</span>}
      </p>

      {isLoading && <p style={{ color: '#cbd5e1' }}>Loading platform metrics…</p>}
      {isError && (
        <div style={{ background: 'rgba(220,38,38,.15)', border: '1px solid rgba(248,113,113,.4)', color: '#fecaca', borderRadius: '10px', padding: '14px 16px', fontSize: '13px' }}>
          {String((error as Error)?.message ?? 'Failed to load admin metrics.')}
        </div>
      )}

      {d && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 230px), 1fr))', gap: '16px' }}>
            {tiles.map((t) => (
              <div key={t.label} style={{
                background: 'rgba(255,255,255,.06)', backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255,255,255,.12)', borderRadius: '14px', padding: '18px 18px 16px',
                boxShadow: '0 8px 24px rgba(0,0,0,.18)',
              }}>
                <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#94a3b8' }}>{t.label}</div>
                <div style={{ marginTop: '8px', fontSize: t.stub ? '14px' : '26px', fontWeight: t.stub ? 500 : 800, color: t.stub ? '#64748b' : (t.accent ?? '#f8fafc'), fontStyle: t.stub ? 'italic' : 'normal' }}>
                  {t.value}
                </div>
                {t.hint && <div style={{ marginTop: '4px', fontSize: '11px', color: '#64748b' }}>{t.hint}</div>}
              </div>
            ))}
          </div>

          {/* Recent registrations */}
          <div style={{ marginTop: '26px', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: '14px', overflow: 'hidden' }}>
            <div style={{ padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,.1)', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#cbd5e1' }}>
              Recent Registrations
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', color: '#e2e8f0' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#94a3b8', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                  <th style={{ padding: '8px 18px' }}>Company</th>
                  <th style={{ padding: '8px 18px' }}>Registered</th>
                  <th style={{ padding: '8px 18px', textAlign: 'right' }}>Users</th>
                </tr>
              </thead>
              <tbody>
                {d.recent_companies.length === 0 && (
                  <tr><td colSpan={3} style={{ padding: '14px 18px', color: '#64748b' }}>No companies yet.</td></tr>
                )}
                {d.recent_companies.map((c) => (
                  <tr key={c.id} style={{ borderTop: '1px solid rgba(255,255,255,.06)' }}>
                    <td style={{ padding: '10px 18px', fontWeight: 600 }}>{c.name}</td>
                    <td style={{ padding: '10px 18px', color: '#94a3b8' }}>{formatDate(c.created_at)}</td>
                    <td style={{ padding: '10px 18px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(c.users)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
