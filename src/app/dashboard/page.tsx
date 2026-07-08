'use client';

import { useEffect, useState, useCallback } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Metric {
  metric_date: string;
  watch_count: number;
  quantity_sold: number;
  revenue: number;
  price: number;
  ad_rate_percent: number | null;
  impression_count: number | null;
  click_count: number | null;
  click_through_rate: number | null;
}

interface Proposal {
  id: number;
  field: string;
  current_value: string;
  proposed_value: string;
  rationale: string;
  impact: 'high' | 'normal';
  status: string;
}

interface Listing {
  id: number;
  ebayItemId: string;
  title: string;
  categoryId: string | null;
  latestMetric: Metric | null;
  metrics: Metric[];
  proposals: Proposal[];
  latestOffer: { offer_date: string; discount_percentage: number; status: string } | null;
}

// ─── Mini Sparkline (pure SVG, no deps) ──────────────────────────────────────

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const w = 80, h = 28;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - (v / max) * h;
    return `${x},${y}`;
  });
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible' }}>
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1].split(',')[0]} cy={pts[pts.length - 1].split(',')[1]} r="3" fill={color} />
    </svg>
  );
}

// ─── CTR Gauge ───────────────────────────────────────────────────────────────

function CtrGauge({ ctr }: { ctr: number }) {
  const pct = Math.min(ctr / 5 * 100, 100); // max 5% = full
  const color = ctr < 0.5 ? '#ff4757' : ctr < 1.5 ? '#ffa502' : '#2ed573';
  const r = 20, circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width="56" height="56" viewBox="0 0 56 56">
      <circle cx="28" cy="28" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
      <circle cx="28" cy="28" r={r} fill="none" stroke={color} strokeWidth="4"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform="rotate(-90 28 28)" style={{ transition: 'stroke-dasharray 0.8s ease' }} />
      <text x="28" y="33" textAnchor="middle" fill={color} fontSize="11" fontWeight="700">
        {ctr.toFixed(1)}%
      </text>
    </svg>
  );
}

// ─── Field badge ─────────────────────────────────────────────────────────────

const FIELD_META: Record<string, { label: string; icon: string; color: string }> = {
  price:    { label: 'Prezzo',    icon: '💶', color: '#ffa502' },
  title:    { label: 'Titolo',    icon: '✏️', color: '#1e90ff' },
  category: { label: 'Categoria', icon: '🗂️', color: '#a29bfe' },
  ad_rate:  { label: 'Ads %',     icon: '📣', color: '#fd79a8' },
  offer:    { label: 'Offerta',   icon: '🎯', color: '#00cec9' },
  relist:   { label: 'Lazarus',   icon: '🧟', color: '#e17055' },
};

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [processing, setProcessing] = useState<number | null>(null);
  const [tg, setTg] = useState<any>(null);

  // Load Telegram WebApp SDK. `sdkReady` only flips to true once the script
  // has loaded AND window.Telegram.WebApp.initData is actually populated —
  // fetching before that point sends an empty initData and gets a 401.
  const [sdkReady, setSdkReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    const tryMarkReady = () => {
      const w = window as any;
      if (w.Telegram?.WebApp?.initData) {
        if (cancelled) return true;
        w.Telegram.WebApp.ready();
        w.Telegram.WebApp.expand();
        setTg(w.Telegram.WebApp);
        setSdkReady(true);
        return true;
      }
      return false;
    };

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-web-app.js';
    script.onload = () => {
      if (tryMarkReady()) return;
      // initData may populate slightly after the script's onload fires;
      // poll briefly with a hard timeout so we never hang forever.
      pollTimer = setInterval(() => {
        if (tryMarkReady() && pollTimer) {
          clearInterval(pollTimer);
        }
      }, 100);
      timeoutTimer = setTimeout(() => {
        if (pollTimer) clearInterval(pollTimer);
        if (!cancelled) setSdkReady(true); // give up waiting; fetchData will surface a real error
      }, 3000);
    };
    script.onerror = () => {
      if (!cancelled) setSdkReady(true); // SDK failed to load; fetchData will surface a real error
    };
    document.head.appendChild(script);

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
    };
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const initData = (window as any).Telegram?.WebApp?.initData ?? '';
      const url = `/api/dashboard?initData=${encodeURIComponent(initData)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Errore caricamento dati');
      const json = await res.json();
      setListings(json.listings ?? []);
      if (json.listings?.length > 0 && selectedId === null) {
        setSelectedId(json.listings[0].id);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    if (!sdkReady) return;
    fetchData();
  }, [sdkReady, fetchData]);

  const handleAction = async (proposalId: number, action: 'approve' | 'reject') => {
    setProcessing(proposalId);
    try {
      const initData = (window as any).Telegram?.WebApp?.initData ?? '';
      const res = await fetch('/api/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, proposalId, action }),
      });
      const json = await res.json();
      setActionMsg(json.message ?? (action === 'approve' ? '✅ Applicato!' : '❌ Rifiutato'));
      setTimeout(() => { setActionMsg(null); fetchData(); }, 2000);
    } catch {
      setActionMsg('⚠️ Errore durante l\'azione');
      setTimeout(() => setActionMsg(null), 2000);
    } finally {
      setProcessing(null);
    }
  };

  const selected = listings.find(l => l.id === selectedId);
  const totalProposals = listings.reduce((s, l) => s + l.proposals.length, 0);
  const totalRevenue = listings.reduce((s, l) => s + (l.latestMetric?.revenue ?? 0), 0);
  const totalWatchers = listings.reduce((s, l) => s + (l.latestMetric?.watch_count ?? 0), 0);

  // ── Theme colors matching Telegram ──
  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', sans-serif; background: var(--tg-theme-bg-color, #0f0f1a); color: var(--tg-theme-text-color, #fff); min-height: 100vh; overflow-x: hidden; }
    ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 4px; }
    .app { max-width: 430px; margin: 0 auto; padding: 0 0 80px; }
    .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%); padding: 20px 16px 16px; position: sticky; top: 0; z-index: 10; }
    .header-top { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
    .logo { width: 36px; height: 36px; background: linear-gradient(135deg, #4361ee, #7209b7); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0; }
    .header h1 { font-size: 18px; font-weight: 800; letter-spacing: -0.3px; }
    .header p { font-size: 11px; color: rgba(255,255,255,0.5); margin-top: 1px; }
    .stats-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .stat-card { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 10px; text-align: center; }
    .stat-val { font-size: 20px; font-weight: 800; line-height: 1; }
    .stat-lbl { font-size: 9px; color: rgba(255,255,255,0.45); text-transform: uppercase; letter-spacing: 0.5px; margin-top: 3px; }
    .section { padding: 14px 14px 0; }
    .section-title { font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; }
    .listing-chips { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 2px; scrollbar-width: none; }
    .listing-chips::-webkit-scrollbar { display: none; }
    .chip { flex-shrink: 0; padding: 6px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; cursor: pointer; border: 1.5px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.04); transition: all 0.2s; white-space: nowrap; max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
    .chip.active { background: linear-gradient(135deg, #4361ee, #7209b7); border-color: transparent; }
    .chip .badge { display: inline-block; background: #ff4757; color: #fff; border-radius: 8px; font-size: 9px; padding: 1px 5px; margin-left: 4px; font-weight: 700; vertical-align: middle; }
    .product-card { background: linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 100%); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 16px; margin: 12px 14px 0; }
    .product-title { font-size: 14px; font-weight: 700; line-height: 1.3; margin-bottom: 14px; }
    .metrics-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 14px; }
    .metric-box { background: rgba(255,255,255,0.04); border-radius: 10px; padding: 10px; }
    .metric-box .val { font-size: 22px; font-weight: 800; line-height: 1; }
    .metric-box .lbl { font-size: 10px; color: rgba(255,255,255,0.4); margin-top: 4px; }
    .metric-box .spark { margin-top: 6px; }
    .ctr-row { display: flex; align-items: center; gap: 14px; background: rgba(255,255,255,0.04); border-radius: 10px; padding: 10px 14px; margin-bottom: 14px; }
    .ctr-details { flex: 1; }
    .ctr-details .label { font-size: 11px; color: rgba(255,255,255,0.4); }
    .ctr-details .impressions { font-size: 16px; font-weight: 700; }
    .ctr-details .clicks { font-size: 12px; color: rgba(255,255,255,0.6); margin-top: 2px; }
    .divider { height: 1px; background: rgba(255,255,255,0.06); margin: 14px 0; }
    .proposals-list { display: flex; flex-direction: column; gap: 10px; }
    .proposal-card { border-radius: 12px; padding: 12px; border: 1px solid; }
    .proposal-card.high { background: rgba(255, 71, 87, 0.08); border-color: rgba(255, 71, 87, 0.25); }
    .proposal-card.normal { background: rgba(255, 165, 2, 0.06); border-color: rgba(255, 165, 2, 0.2); }
    .proposal-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .proposal-field-badge { font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 6px; background: rgba(255,255,255,0.08); }
    .proposal-impact { font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 600; }
    .proposal-impact.high { background: rgba(255,71,87,0.2); color: #ff4757; }
    .proposal-impact.normal { background: rgba(255,165,2,0.2); color: #ffa502; }
    .proposal-change { font-size: 12px; color: rgba(255,255,255,0.7); margin-bottom: 6px; }
    .proposal-change em { color: #fff; font-style: normal; font-weight: 600; }
    .proposal-rationale { font-size: 11px; color: rgba(255,255,255,0.5); line-height: 1.5; margin-bottom: 10px; }
    .proposal-actions { display: flex; gap: 8px; }
    .btn { flex: 1; padding: 9px; border-radius: 10px; border: none; font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.18s; }
    .btn:active { transform: scale(0.96); }
    .btn-approve { background: linear-gradient(135deg, #00b894, #00cec9); color: #fff; }
    .btn-reject { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.6); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .offer-banner { background: linear-gradient(135deg, rgba(0,206,201,0.15), rgba(0,184,148,0.1)); border: 1px solid rgba(0,206,201,0.3); border-radius: 12px; padding: 10px 14px; margin-bottom: 10px; font-size: 12px; color: rgba(255,255,255,0.8); }
    .empty-proposals { text-align: center; padding: 20px; font-size: 13px; color: rgba(255,255,255,0.35); }
    .toast { position: fixed; bottom: 90px; left: 50%; transform: translateX(-50%); background: #2d3436; color: #fff; padding: 10px 20px; border-radius: 20px; font-size: 13px; font-weight: 600; z-index: 100; white-space: nowrap; box-shadow: 0 8px 32px rgba(0,0,0,0.4); animation: fadeInUp 0.3s ease; }
    @keyframes fadeInUp { from { opacity: 0; transform: translateX(-50%) translateY(10px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
    .loading { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 60vh; gap: 14px; }
    .spinner { width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.1); border-top-color: #4361ee; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .price-pill { display: inline-block; background: rgba(46,213,115,0.12); color: #2ed573; border-radius: 6px; padding: 2px 8px; font-size: 14px; font-weight: 700; }
  `;

  if (loading) return (
    <>
      <style>{css}</style>
      <div className="loading"><div className="spinner" /><p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Caricamento...</p></div>
    </>
  );

  if (error) return (
    <>
      <style>{css}</style>
      <div className="loading"><p style={{ color: '#ff4757' }}>⚠️ {error}</p></div>
    </>
  );

  return (
    <>
      <style>{css}</style>
      <div className="app">
        {/* ── Header ── */}
        <div className="header">
          <div className="header-top">
            <div className="logo">🏪</div>
            <div>
              <h1>eBay Manager</h1>
              <p>{listings.length} inserzioni monitorate</p>
            </div>
          </div>
          <div className="stats-row">
            <div className="stat-card">
              <div className="stat-val" style={{ color: '#ffa502' }}>€{totalRevenue.toFixed(0)}</div>
              <div className="stat-lbl">Revenue oggi</div>
            </div>
            <div className="stat-card">
              <div className="stat-val" style={{ color: '#1e90ff' }}>{totalWatchers}</div>
              <div className="stat-lbl">Osservatori</div>
            </div>
            <div className="stat-card">
              <div className="stat-val" style={{ color: totalProposals > 0 ? '#ff4757' : '#2ed573' }}>{totalProposals}</div>
              <div className="stat-lbl">Proposte</div>
            </div>
          </div>
        </div>

        {/* ── Listing selector ── */}
        <div className="section">
          <div className="section-title">Inserzioni</div>
          <div className="listing-chips">
            {listings.map(l => (
              <div
                key={l.id}
                className={`chip ${l.id === selectedId ? 'active' : ''}`}
                onClick={() => setSelectedId(l.id)}
              >
                {l.title.split(' ').slice(0, 3).join(' ')}
                {l.proposals.length > 0 && <span className="badge">{l.proposals.length}</span>}
              </div>
            ))}
          </div>
        </div>

        {/* ── Product detail ── */}
        {selected && (
          <div className="product-card">
            <div className="product-title">{selected.title}</div>

            {/* Metrics */}
            {selected.latestMetric && (() => {
              const m = selected.latestMetric!;
              const priceHistory = selected.metrics.map(x => x.price);
              const watchHistory = selected.metrics.map(x => x.watch_count);
              return (
                <>
                  <div className="metrics-grid">
                    <div className="metric-box">
                      <div className="val price-pill">€{m.price.toFixed(2)}</div>
                      <div className="lbl">Prezzo</div>
                      <div className="spark"><Sparkline values={priceHistory} color="#2ed573" /></div>
                    </div>
                    <div className="metric-box">
                      <div className="val" style={{ color: '#1e90ff' }}>{m.watch_count}</div>
                      <div className="lbl">Osservatori</div>
                      <div className="spark"><Sparkline values={watchHistory} color="#1e90ff" /></div>
                    </div>
                  </div>

                  {/* CTR Block */}
                  {m.impression_count != null && (
                    <div className="ctr-row">
                      <CtrGauge ctr={m.click_through_rate ?? 0} />
                      <div className="ctr-details">
                        <div className="label">Click-Through Rate</div>
                        <div className="impressions">{(m.impression_count ?? 0).toLocaleString()} impressioni</div>
                        <div className="clicks">{(m.click_count ?? 0)} click · {m.ad_rate_percent != null ? `Ads ${m.ad_rate_percent}%` : 'Nessuna ads'}</div>
                      </div>
                    </div>
                  )}

                  {/* Active offer banner */}
                  {selected.latestOffer && selected.latestOffer.status === 'sent' && (
                    <div className="offer-banner">
                      🎯 Offerta attiva: <strong>-{selected.latestOffer.discount_percentage}%</strong> inviata il {selected.latestOffer.offer_date}
                    </div>
                  )}
                </>
              );
            })()}

            <div className="divider" />

            {/* Proposals */}
            <div className="section-title">Proposte di ottimizzazione</div>
            {selected.proposals.length === 0 ? (
              <div className="empty-proposals">✨ Nessuna proposta attiva<br />Tutto ottimizzato!</div>
            ) : (
              <div className="proposals-list">
                {selected.proposals.map(p => {
                  const meta = FIELD_META[p.field] ?? { label: p.field, icon: '🔧', color: '#aaa' };
                  return (
                    <div key={p.id} className={`proposal-card ${p.impact}`}>
                      <div className="proposal-header">
                        <span style={{ fontSize: 16 }}>{meta.icon}</span>
                        <span className="proposal-field-badge" style={{ color: meta.color }}>{meta.label}</span>
                        <span className={`proposal-impact ${p.impact}`}>{p.impact === 'high' ? '⚠️ Urgente' : 'Suggerimento'}</span>
                      </div>
                      {p.field !== 'relist' && p.field !== 'offer' && (
                        <div className="proposal-change">
                          <em>{p.current_value}</em> → <em style={{ color: meta.color }}>{p.proposed_value}</em>
                        </div>
                      )}
                      <div className="proposal-rationale">{p.rationale}</div>
                      <div className="proposal-actions">
                        <button
                          className="btn btn-approve"
                          disabled={processing === p.id}
                          onClick={() => handleAction(p.id, 'approve')}
                        >
                          {processing === p.id ? '⏳' : '✅ Approva'}
                        </button>
                        <button
                          className="btn btn-reject"
                          disabled={processing === p.id}
                          onClick={() => handleAction(p.id, 'reject')}
                        >
                          ❌ Rifiuta
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Toast ── */}
        {actionMsg && <div className="toast">{actionMsg}</div>}
      </div>
    </>
  );
}
