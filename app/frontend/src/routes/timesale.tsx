import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Timer } from 'lucide-react';

export const Route = createFileRoute('/timesale')({ component: TimesalePage });

type Product = {
  id: string;
  name: string;
  price: number;
  sale_price: number | null;
  is_timesale: boolean;
  sale_ends_at: string | null;
  stock_status: '재고 있음' | '재고 부족' | '품절';
};

function useCountdown(target: Date) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = target.getTime() - now;
  const ended = diff <= 0;
  const abs = Math.abs(diff);
  return { ended, h: Math.floor((abs / 3600000) % 24), m: Math.floor((abs / 60000) % 60), s: Math.floor((abs / 1000) % 60) };
}

const pad = (n: number) => n.toString().padStart(2, '0');

function TimesalePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const saleEnd = products[0]?.sale_ends_at ? new Date(products[0].sale_ends_at) : new Date(Date.now() + 24 * 3600000);
  const { ended, h, m, s } = useCountdown(saleEnd);

  useEffect(() => {
    fetch('/api/products')
      .then((r) => r.json())
      .then((data: Product[]) => {
        setProducts(data.filter((p) => p.is_timesale));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <header className="border-b border-neutral-200">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link to="/" className="text-xl font-semibold tracking-tight">Shop<span className="text-neutral-400">ly</span></Link>
          <div className="flex items-center gap-4 text-sm text-neutral-600">
            <Link to="/" className="hover:text-neutral-900">전체 상품</Link>
            <Link to="/checkout" className="hover:text-neutral-900">주문/결제</Link>
          </div>
        </nav>
      </header>

      <section className="border-b border-neutral-200 bg-neutral-50">
        <div className="mx-auto flex max-w-6xl flex-col items-center px-4 py-10 sm:px-6">
          <div className="flex items-center gap-2">
            <Timer className="h-5 w-5 text-red-500" />
            {ended
              ? <span className="rounded-full bg-neutral-200 px-3 py-1 text-xs font-semibold text-neutral-700">타임세일 종료</span>
              : <span className="rounded-full bg-red-500 px-3 py-1 text-xs font-semibold text-white">타임세일 진행중</span>}
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">{ended ? '다음 타임세일을 기대해주세요' : '한정 타임세일'}</h1>
          <div className="mt-6 flex items-center gap-2">
            {[{ label: '시간', value: h }, { label: '분', value: m }, { label: '초', value: s }].map((t, i) => (
              <div key={t.label} className="flex items-center gap-2">
                <div className="min-w-[72px] rounded-lg border border-neutral-200 bg-white px-4 py-3 text-center">
                  <div className="text-2xl font-bold tabular-nums">{pad(t.value)}</div>
                  <div className="mt-1 text-[10px] uppercase tracking-wider text-neutral-500">{t.label}</div>
                </div>
                {i < 2 && <span className="text-xl font-bold text-neutral-400">:</span>}
              </div>
            ))}
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <h2 className="text-lg font-semibold">타임세일 상품 <span className="text-sm font-normal text-neutral-500">({products.length}개)</span></h2>
        <p className="mt-1 text-sm text-neutral-500">수량 한정 — 품절 전에 서두르세요</p>

        {loading ? (
          <p className="mt-6 text-sm text-neutral-400">상품 불러오는 중...</p>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p) => {
              const rate = p.sale_price ? Math.round(((p.price - p.sale_price) / p.price) * 100) : 0;
              const soldOut = p.stock_status === '품절';
              const low = p.stock_status === '재고 부족';
              return (
                <div key={p.id} className="flex flex-col rounded-lg border border-neutral-200 bg-white p-4 transition hover:shadow-sm">
                  <div className="flex aspect-[4/3] items-center justify-center rounded-md bg-neutral-100">
                    <svg className="h-10 w-10 text-neutral-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="1.5" /><path d="M21 15l-5-5L5 21" />
                    </svg>
                  </div>
                  <div className="mt-4 flex items-start justify-between gap-2">
                    <h3 className="text-sm font-medium line-clamp-2">{p.name}</h3>
                    {!soldOut && <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-xs font-bold text-red-500">{rate}%</span>}
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-lg font-bold text-red-500">₩{(p.sale_price ?? p.price).toLocaleString()}</span>
                    <span className="text-sm text-neutral-400 line-through">₩{p.price.toLocaleString()}</span>
                  </div>
                  <p className={`mt-2 text-xs ${soldOut ? 'text-red-500' : low ? 'text-amber-600' : 'text-green-600'}`}>
                    {p.stock_status}
                  </p>
                  <Link to="/products/$productId" params={{ productId: p.id }}
                    className={`mt-4 w-full rounded-md px-4 py-2.5 text-center text-sm font-medium transition ${soldOut ? 'cursor-not-allowed bg-neutral-300 text-neutral-500' : 'bg-neutral-900 text-white hover:bg-neutral-800'}`}>
                    {soldOut ? '품절' : '구매하기'}
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <footer className="border-t border-neutral-200">
        <div className="mx-auto max-w-6xl px-4 py-6 text-xs text-neutral-500 sm:px-6">
          © {new Date().getFullYear()} Shoply
        </div>
      </footer>
    </div>
  );
}
