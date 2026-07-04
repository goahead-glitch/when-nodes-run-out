import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { getToken, USER_KEY, apiFetch } from '@/lib/auth';

export const Route = createFileRoute('/admin')({ component: AdminPage });

type Product = {
  id: string; name: string; price: number; sale_price: number | null;
  is_timesale: boolean; sale_ends_at: string | null;
  stock_status: string; total_available: number;
};

type TimesaleStatus = { total: number; timesale: number; saleEndsAt: string | null };

function AdminPage() {
  const navigate = useNavigate();
  const [authorized, setAuthorized] = useState(false);
  const [status, setStatus] = useState<TimesaleStatus | null>(null);
  const [timesaleProducts, setTimesaleProducts] = useState<Product[]>([]);
  const [discountRate, setDiscountRate] = useState(40);
  const [durationHours, setDurationHours] = useState(1);
  const [count, setCount] = useState(20);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) { navigate({ to: '/login' }); return; }
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) { navigate({ to: '/' }); return; }
    const user = JSON.parse(raw) as { email: string };
    if (user.email !== 'admin@shoply.com') { navigate({ to: '/' }); return; }
    setAuthorized(true);
    fetchStatus();
  }, []);

  async function fetchStatus() {
    try {
      const res = await fetch('/api/products');
      const data = await res.json() as Product[];
      const timesale = data.filter((p) => p.is_timesale);
      setStatus({ total: data.length, timesale: timesale.length, saleEndsAt: timesale[0]?.sale_ends_at ?? null });
      setTimesaleProducts(timesale);
    } catch { /* ignore */ }
  }

  async function startTimesale() {
    setLoading(true);
    setMsg('');
    try {
      const res = await apiFetch('/api/products/timesale/start', {
        method: 'POST',
        body: JSON.stringify({ count, discountRate, durationHours }),
      });
      const data = await res.json() as { ok: boolean; updated: number; saleEndsAt: string };
      if (data.ok) {
        setMsg(`✓ 타임세일 시작 — ${data.updated}개 상품, ${discountRate}% 할인, ${durationHours}시간`);
        fetchStatus();
      }
    } catch { setMsg('오류가 발생했습니다.'); }
    setLoading(false);
  }

  async function stopTimesale() {
    setLoading(true);
    setMsg('');
    try {
      const res = await apiFetch('/api/products/timesale/stop', {
        method: 'POST',
      });
      const data = await res.json() as { ok: boolean; stopped: number };
      if (data.ok) {
        setMsg(`✓ 타임세일 종료 — ${data.stopped}개 상품 정상가 복구`);
        fetchStatus();
      }
    } catch { setMsg('오류가 발생했습니다.'); }
    setLoading(false);
  }

  if (!authorized) return null;

  const totalStock = timesaleProducts.reduce((s, p) => s + p.total_available, 0);
  const soldOutCount = timesaleProducts.filter((p) => p.stock_status === '품절').length;

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <header className="border-b border-neutral-200">
        <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link to="/" className="text-xl font-semibold tracking-tight">Shop<span className="text-neutral-400">ly</span></Link>
          <span className="rounded-full bg-neutral-900 px-3 py-1 text-xs font-medium text-white">어드민</span>
        </nav>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-12 space-y-8">
        <h1 className="text-2xl font-semibold">타임세일 제어판</h1>

        {/* 현재 상태 */}
        {status && (
          <section className="rounded-lg border border-neutral-200 p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-neutral-500">현재 상태</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { label: '전체 상품', value: `${status.total}개` },
                { label: '타임세일 진행', value: `${status.timesale}개`, highlight: status.timesale > 0 },
                { label: '총 재고', value: `${totalStock.toLocaleString()}개`, highlight: totalStock < 500 },
                { label: '품절 상품', value: `${soldOutCount}개`, highlight: soldOutCount > 0 },
              ].map((s) => (
                <div key={s.label} className="rounded-lg bg-neutral-50 p-4 text-center">
                  <p className="text-xs text-neutral-500">{s.label}</p>
                  <p className={`mt-1 text-xl font-bold ${s.highlight ? 'text-red-500' : 'text-neutral-900'}`}>{s.value}</p>
                </div>
              ))}
            </div>
            {status.saleEndsAt && (
              <p className="mt-3 text-xs text-neutral-500">
                종료 예정: {new Date(status.saleEndsAt).toLocaleString('ko-KR')}
              </p>
            )}
          </section>
        )}

        {/* 타임세일 상품 목록 */}
        {timesaleProducts.length > 0 && (
          <section className="rounded-lg border border-neutral-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
              <h2 className="text-base font-semibold">타임세일 상품 목록</h2>
              <span className="text-xs text-neutral-500">총 재고 {totalStock.toLocaleString()}개</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">상품명</th>
                    <th className="px-4 py-3 text-right font-medium">정가</th>
                    <th className="px-4 py-3 text-right font-medium">세일가</th>
                    <th className="px-4 py-3 text-right font-medium">할인율</th>
                    <th className="px-4 py-3 text-right font-medium">남은 재고</th>
                    <th className="px-4 py-3 text-center font-medium">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {timesaleProducts.map((p) => {
                    const rate = p.sale_price ? Math.round((1 - p.sale_price / p.price) * 100) : 0;
                    const stockColor = p.stock_status === '품절' ? 'text-red-500' : p.stock_status === '재고 부족' ? 'text-amber-600' : 'text-green-600';
                    return (
                      <tr key={p.id} className="border-t border-neutral-100 hover:bg-neutral-50">
                        <td className="px-4 py-3 font-medium line-clamp-1 max-w-[200px]">{p.name}</td>
                        <td className="px-4 py-3 text-right text-neutral-500">₩{p.price.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-medium text-red-500">₩{(p.sale_price ?? p.price).toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-bold text-red-500">{rate}%</td>
                        <td className="px-4 py-3 text-right font-medium">{p.total_available.toLocaleString()}개</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-xs font-medium ${stockColor}`}>{p.stock_status}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-neutral-50 border-t border-neutral-200">
                  <tr>
                    <td colSpan={4} className="px-4 py-3 text-xs text-neutral-500">합계</td>
                    <td className="px-4 py-3 text-right text-sm font-bold">{totalStock.toLocaleString()}개</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        )}

        {/* 타임세일 시작 */}
        <section className="rounded-lg border border-neutral-200 p-6">
          <h2 className="mb-4 text-base font-semibold">타임세일 시작 (시나리오 2 트리거)</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="mb-1 block text-xs text-neutral-600">대상 상품 수</label>
                <input type="number" min={1} max={500} value={count} onChange={(e) => setCount(Number(e.target.value))}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-neutral-600">할인율 (%)</label>
                <input type="number" min={1} max={99} value={discountRate} onChange={(e) => setDiscountRate(Number(e.target.value))}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-neutral-600">지속 시간 (시간)</label>
                <input type="number" min={0.5} max={24} step={0.5} value={durationHours} onChange={(e) => setDurationHours(Number(e.target.value))}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
              </div>
            </div>

            <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
              <strong>시나리오 2 주의:</strong> 타임세일 시작 직후 Locust로 트래픽을 발생시킵니다. Redis 캐시가 자동 무효화됩니다.
            </div>

            <button type="button" onClick={startTimesale} disabled={loading}
              className="w-full rounded-md bg-red-500 py-3 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50">
              {loading ? '처리 중...' : `타임세일 시작 — ${count}개 상품 ${discountRate}% 할인`}
            </button>
          </div>
        </section>

        {/* 타임세일 종료 */}
        <section className="rounded-lg border border-neutral-200 p-6">
          <h2 className="mb-4 text-base font-semibold">타임세일 종료</h2>
          <p className="mb-4 text-sm text-neutral-600">모든 타임세일 상품을 정상가로 복구하고 Redis 캐시를 무효화합니다.</p>
          <button type="button" onClick={stopTimesale} disabled={loading}
            className="w-full rounded-md border border-neutral-300 py-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">
            {loading ? '처리 중...' : '전체 타임세일 종료'}
          </button>
        </section>

        {/* 실험 전 체크리스트 */}
        <section className="rounded-lg border border-neutral-200 p-6">
          <h2 className="mb-4 text-base font-semibold">실험 전 체크리스트</h2>
          <ul className="space-y-2 text-sm text-neutral-700">
            {[
              'DB reserved = 0 확인 (SELECT COUNT(*) FROM inventory WHERE reserved != 0)',
              'Redis dbsize = 0 확인 (TTL 만료 대기 또는 FLUSHALL)',
              '타임세일 상품 재고 수준 확인 (위 테이블)',
              '양쪽 환경(온프레미스/EKS) 동시 타임세일 시작',
              'Locust 스크립트 동일 버전 확인 후 동시 실행',
              'Prometheus scrape 정상 확인',
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5 shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        {msg && (
          <div className={`rounded-md px-4 py-3 text-sm ${msg.startsWith('✓') ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
            {msg}
          </div>
        )}
      </main>
    </div>
  );
}
