import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { ShoppingCart } from 'lucide-react';
import { getToken, clearAuth } from '@/lib/auth';

export const Route = createFileRoute('/')({ component: Index });

type Product = {
  id: string;
  name: string;
  price: number;
  sale_price: number | null;
  is_timesale: boolean;
  stock_status: '재고 있음' | '재고 부족' | '품절';
};

function Index() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const isLoggedIn = !!getToken();

  useEffect(() => {
    fetch('/api/products')
      .then((r) => r.json())
      .then((data: Product[]) => { setProducts(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const stockColor = { '재고 있음': 'text-green-600', '재고 부족': 'text-amber-600', '품절': 'text-red-500' };

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <header className="border-b border-neutral-200">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <a href="/" className="text-xl font-semibold tracking-tight">Shop<span className="text-neutral-400">ly</span></a>
          <ul className="hidden items-center gap-8 text-sm text-neutral-600 md:flex">
            <li><Link to="/timesale" className="hover:text-neutral-900">타임세일</Link></li>
            <li><Link to="/stats" className="hover:text-neutral-900">현황</Link></li>
            <li><Link to="/checkout" className="hover:text-neutral-900">주문/결제</Link></li>
            {isLoggedIn ? (
              <>
                {JSON.parse(localStorage.getItem('shoply_user') ?? '{}').email === 'admin@shoply.com' && (
                  <li><Link to="/admin" className="font-medium text-red-500 hover:text-red-700">어드민</Link></li>
                )}
                <li><button onClick={() => { clearAuth(); window.location.reload(); }} className="hover:text-neutral-900">로그아웃</button></li>
              </>
            ) : (
              <li><Link to="/login" className="hover:text-neutral-900">로그인</Link></li>
            )}
          </ul>
          <Link to="/checkout" aria-label="Cart"
            className="relative inline-flex items-center gap-2 rounded-md border border-neutral-200 px-3 py-2 text-sm text-neutral-700 transition hover:bg-neutral-50">
            <ShoppingCart className="h-4 w-4" />
            <span className="hidden sm:inline">주문하기</span>
          </Link>
        </nav>
      </header>

      <section className="border-b border-neutral-200 bg-neutral-50">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 sm:px-6 md:flex-row">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">타임세일 진행 중</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">스니커즈 최대 50% 할인</h1>
            <p className="mt-2 text-sm text-neutral-600">한정 수량 · 품절 전에 서두르세요</p>
          </div>
          <Link to="/timesale"
            className="rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-800">
            타임세일 보기
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="mb-6 flex items-end justify-between">
          <h2 className="text-lg font-semibold tracking-tight md:text-xl">전체 상품</h2>
          <span className="text-sm text-neutral-500">{products.length}개</span>
        </div>

        {loading ? (
          <p className="text-sm text-neutral-400">상품 불러오는 중...</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => (
              <Link key={p.id} to="/products/$productId" params={{ productId: p.id }} className="group">
                <article>
                  <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-md bg-neutral-100 transition group-hover:bg-neutral-200">
                    {p.is_timesale && (
                      <span className="absolute left-2 top-2 rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">SALE</span>
                    )}
                    <svg className="h-10 w-10 text-neutral-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="1.5" /><path d="M21 15l-5-5L5 21" />
                    </svg>
                  </div>
                  <div className="mt-3 space-y-1">
                    <h3 className="text-sm font-medium text-neutral-900 line-clamp-2">{p.name}</h3>
                    <div className="flex items-baseline gap-2">
                      {p.is_timesale && p.sale_price ? (
                        <>
                          <p className="text-sm font-bold text-red-500">₩{p.sale_price.toLocaleString()}</p>
                          <p className="text-xs text-neutral-400 line-through">₩{p.price.toLocaleString()}</p>
                        </>
                      ) : (
                        <p className="text-sm text-neutral-700">₩{p.price.toLocaleString()}</p>
                      )}
                    </div>
                    <p className={`text-xs ${stockColor[p.stock_status]}`}>{p.stock_status}</p>
                  </div>
                </article>
              </Link>
            ))}
          </div>
        )}
      </section>

      <footer className="border-t border-neutral-200">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-xs text-neutral-500 sm:flex-row sm:px-6">
          <span>© {new Date().getFullYear()} Shoply. All rights reserved.</span>
        </div>
      </footer>
    </div>
  );
}


