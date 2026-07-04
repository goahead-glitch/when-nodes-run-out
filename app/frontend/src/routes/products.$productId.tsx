import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

export const Route = createFileRoute('/products/$productId')({ component: ProductDetailPage });

type SizeStock = { size: number; available: number };
type Product = {
  id: string; name: string; price: number; description: string;
  is_timesale: boolean; sale_price: number | null; sale_ends_at: string | null;
  stock_status: '재고 있음' | '재고 부족' | '품절';
  sizes: SizeStock[];
};

function ProductDetailPage() {
  const { productId } = Route.useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSize, setSelectedSize] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/products/${productId}`)
      .then((r) => r.json())
      .then((data: Product) => { setProduct(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [productId]);

  if (loading) return <div className="flex min-h-screen items-center justify-center text-sm text-neutral-400">불러오는 중...</div>;
  if (!product) return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <p className="text-neutral-500">상품을 찾을 수 없습니다.</p>
        <Link to="/" className="mt-4 block text-sm underline">홈으로</Link>
      </div>
    </div>
  );

  const displayPrice = product.is_timesale && product.sale_price ? product.sale_price : product.price;
  const soldOut = product.stock_status === '품절';

  const handleBuy = () => {
    if (!selectedSize) { alert('사이즈를 선택해주세요.'); return; }
    navigate({ to: '/checkout', search: { productId: product.id, size: selectedSize } });
  };

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <header className="border-b border-neutral-200">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link to="/" className="text-xl font-semibold tracking-tight">Shop<span className="text-neutral-400">ly</span></Link>
          <div className="flex gap-4 text-sm text-neutral-500">
            <Link to="/" className="hover:text-neutral-900">← 전체 상품</Link>
            <Link to="/timesale" className="hover:text-neutral-900">타임세일</Link>
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
          <div className="flex aspect-square items-center justify-center rounded-lg bg-neutral-100">
            <svg className="h-20 w-20 text-neutral-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="1.5" /><path d="M21 15l-5-5L5 21" />
            </svg>
          </div>

          <div>
            {product.is_timesale && (
              <span className="inline-block rounded bg-red-500 px-2 py-0.5 text-xs font-bold text-white">타임세일</span>
            )}
            <h1 className="mt-2 text-2xl font-semibold">{product.name}</h1>
            <p className="mt-1 text-sm text-neutral-500">{product.description}</p>

            <div className="mt-4 flex items-baseline gap-3">
              <p className={`text-2xl font-bold ${product.is_timesale ? 'text-red-500' : ''}`}>
                ₩{displayPrice.toLocaleString()}
              </p>
              {product.is_timesale && product.sale_price && (
                <p className="text-base text-neutral-400 line-through">₩{product.price.toLocaleString()}</p>
              )}
            </div>

            <p className={`mt-2 text-sm font-medium ${soldOut ? 'text-red-500' : product.stock_status === '재고 부족' ? 'text-amber-600' : 'text-green-600'}`}>
              {product.stock_status}
            </p>

            <div className="mt-6">
              <p className="mb-3 text-sm font-medium">사이즈 선택</p>
              <div className="flex flex-wrap gap-2">
                {(product.sizes ?? []).map((s) => (
                  <button key={s.size} type="button" disabled={s.available === 0}
                    onClick={() => setSelectedSize(s.size)}
                    className={`relative rounded-md border px-4 py-2 text-sm transition
                      ${s.available === 0 ? 'cursor-not-allowed border-neutral-100 text-neutral-300' :
                        selectedSize === s.size ? 'border-neutral-900 bg-neutral-900 text-white' :
                        'border-neutral-200 hover:border-neutral-400'}`}>
                    {s.size}
                    {s.available > 0 && s.available <= 10 && (
                      <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[9px] font-bold text-white">{s.available}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <button type="button" onClick={handleBuy} disabled={soldOut}
              className="mt-8 w-full rounded-md bg-neutral-900 py-3 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-40">
              {soldOut ? '품절' : selectedSize ? `${selectedSize} 사이즈 구매하기` : '사이즈 선택 후 구매'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
