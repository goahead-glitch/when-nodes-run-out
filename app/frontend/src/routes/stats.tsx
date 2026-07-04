import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/auth';

export const Route = createFileRoute('/stats')({
  component: StatsPage,
});

type ReasonCode = 'INSUFFICIENT_STOCK' | 'PAYMENT_GATEWAY_ERROR' | 'TIMEOUT';
type RecentOrder = { time: string; product: string; size: string; status: 'SUCCESS' | 'FAILED'; reason: ReasonCode | null };
type StatsResponse = { total: number; success: number; failed: number; rate: number; recent: RecentOrder[] };

const REASON_LABEL: Record<ReasonCode, string> = {
  INSUFFICIENT_STOCK: '재고 부족',
  PAYMENT_GATEWAY_ERROR: '결제 오류',
  TIMEOUT: '서버 응답 없음',
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('ko-KR', { hour12: false });
}

function rateColor(rate: number) {
  if (rate >= 90) return { bar: 'bg-emerald-500', text: 'text-emerald-600' };
  if (rate >= 50) return { bar: 'bg-amber-500', text: 'text-amber-600' };
  return { bar: 'bg-red-500', text: 'text-red-600' };
}

function StatsPage() {
  const [data, setData] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await apiFetch('/api/stats');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json() as StatsResponse;
        if (!cancelled) { setData(json); setError(null); }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'error');
      }
    };
    load();
    const id = setInterval(load, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const total = data?.total ?? 0;
  const success = data?.success ?? 0;
  const failed = data?.failed ?? 0;
  const rate = data?.rate ?? 0;
  const recent = data?.recent ?? [];
  const color = rateColor(rate);

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <header className="border-b border-neutral-200">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="text-xl font-semibold tracking-tight">Shop<span className="text-neutral-400">ly</span></Link>
          <nav className="flex items-center gap-5 text-sm text-neutral-600">
            <Link to="/" className="hover:text-neutral-900">홈</Link>
            <Link to="/timesale" className="hover:text-neutral-900">타임세일</Link>
            <Link to="/stats" className="font-medium text-neutral-900">현황</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold">실시간 주문 현황</h1>
            <p className="mt-1 text-sm text-neutral-500">3초마다 자동으로 갱신됩니다.</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            실시간
          </div>
        </div>

        {error && <p className="mb-4 text-xs text-red-600">불러오기 오류: {error}</p>}

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            { label: '전체 주문 수', value: `${total.toLocaleString()}건` },
            { label: '성공 주문 수', value: `${success.toLocaleString()}건`, cls: 'text-emerald-600' },
            { label: '실패 주문 수', value: `${failed.toLocaleString()}건`, cls: 'text-red-600' },
            { label: '성공률', value: `${rate}%`, cls: color.text },
          ].map((c) => (
            <div key={c.label} className="rounded-lg border border-neutral-200 p-5">
              <div className="text-xs text-neutral-500">{c.label}</div>
              <div className={`mt-2 text-2xl font-semibold ${c.cls ?? 'text-neutral-900'}`}>{c.value}</div>
            </div>
          ))}
        </section>

        <section className="mt-8 rounded-lg border border-neutral-200 p-6">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">성공률</span>
            <span className={`font-medium ${color.text}`}>{rate}%</span>
          </div>
          <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-neutral-100">
            <div className={`h-full ${color.bar} transition-all duration-500`} style={{ width: `${rate}%` }} />
          </div>
        </section>

        <section className="mt-8">
          <h2 className="mb-4 text-lg font-semibold">실시간 주문 리스트</h2>
          <div className="overflow-hidden rounded-lg border border-neutral-200">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  {['주문 시각', '상품명', '사이즈', '상태', '실패 사유'].map((h) => (
                    <th key={h} className="px-4 py-3 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-neutral-400">아직 주문 데이터가 없습니다.</td></tr>
                ) : (
                  recent.map((o, i) => (
                    <tr key={`${o.time}-${i}`} className="border-t border-neutral-100">
                      <td className="px-4 py-3 text-neutral-600">{formatTime(o.time)}</td>
                      <td className="px-4 py-3">{o.product}</td>
                      <td className="px-4 py-3 text-neutral-600">{o.size}</td>
                      <td className="px-4 py-3">
                        {o.status === 'SUCCESS'
                          ? <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">성공</span>
                          : <span className="inline-flex rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">실패</span>}
                      </td>
                      <td className="px-4 py-3 text-neutral-500">{o.reason ? REASON_LABEL[o.reason] : '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
