import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/auth';

export const Route = createFileRoute('/checkout')({
  validateSearch: (s: Record<string, unknown>) => ({
    productId: (s.productId as string) || '',
    size: s.size ? Number(s.size) : 0,
  }),
  component: CheckoutPage,
});

type Product = {
  id: string; name: string; price: number; sale_price: number | null;
  is_timesale: boolean; sizes?: { size: number; available: number }[];
};
type CartItem = { productId: string; name: string; size: number; quantity: number; unitPrice: number };
type PaymentMethod = 'card' | 'bank';
type Status = 'idle' | 'processing' | 'success' | 'failed';

function CheckoutPage() {
  const { productId: initProductId, size: initSize } = Route.useSearch();

  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedProduct, setSelectedProduct] = useState(initProductId);
  const [selectedSize, setSelectedSize] = useState<number | null>(initSize || null);
  const [quantity, setQuantity] = useState(1);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('card');
  const [status, setStatus] = useState<Status>('idle');
  const [failReason, setFailReason] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [productDetail, setProductDetail] = useState<Product | null>(null);

  useEffect(() => {
    fetch('/api/products')
      .then((r) => r.json())
      .then((data: Product[]) => {
        setProducts(data);
        if (!selectedProduct && data[0]) setSelectedProduct(data[0].id);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // 선택 상품 변경 시 상세(sizes) 조회
  useEffect(() => {
    if (!selectedProduct) return;
    setProductDetail(null);
    fetch(`/api/products/${selectedProduct}`)
      .then((r) => r.json())
      .then((data: Product) => setProductDetail(data))
      .catch(() => {});
  }, [selectedProduct]);

  // URL에서 productId + size가 넘어왔으면 자동으로 장바구니에 담기
  useEffect(() => {
    if (!initProductId || products.length === 0) return;
    const p = products.find((x) => x.id === initProductId);
    if (!p || !initSize) return;
    const unitPrice = p.is_timesale && p.sale_price ? p.sale_price : p.price;
    setCart([{ productId: p.id, name: p.name, size: initSize, quantity: 1, unitPrice }]);
  }, [initProductId, initSize, products]);

  const currentProduct = products.find((p) => p.id === selectedProduct);
  const availableSizes = productDetail?.sizes?.filter((s) => s.available > 0) ?? [];

  const addToCart = () => {
    if (!currentProduct || !selectedSize) { alert('상품과 사이즈를 선택해주세요.'); return; }
    const unitPrice = currentProduct.is_timesale && currentProduct.sale_price
      ? currentProduct.sale_price : currentProduct.price;
    setCart((prev) => [...prev, { productId: currentProduct.id, name: currentProduct.name, size: selectedSize, quantity, unitPrice }]);
    setSelectedSize(null);
    setQuantity(1);
  };

  const removeFromCart = (i: number) => setCart((prev) => prev.filter((_, j) => j !== i));

  const total = cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0);

  const handlePay = async () => {
    if (cart.length === 0) { alert('장바구니가 비어있습니다.'); return; }
    if (!name || !phone || !address) { alert('배송지 정보를 모두 입력해주세요.'); return; }
    setStatus('processing');
    setFailReason(null);
    try {
      const orderRes = await apiFetch('/api/orders', {
        method: 'POST',
        body: JSON.stringify({ items: cart.map((i) => ({ productId: i.productId, size: i.size, quantity: i.quantity })) }),
      });
      const orderData = await orderRes.json() as { orderId: string } | { message: string };
      if (!orderRes.ok || !('orderId' in orderData)) {
        setStatus('failed');
        setFailReason('message' in orderData ? orderData.message : '주문 생성 실패');
        return;
      }
      setOrderId(orderData.orderId);

      const payRes = await apiFetch('/api/payments', {
        method: 'POST',
        body: JSON.stringify({ orderId: orderData.orderId, method }),
      });
      const payData = await payRes.json() as { status: string; failedReason?: string } | { message: string };
      if (!payRes.ok || 'message' in payData) {
        setStatus('failed');
        setFailReason('message' in payData ? payData.message : '결제 처리 오류');
        return;
      }
      if (payData.status === 'PAID') { setStatus('success'); }
      else { setStatus('failed'); setFailReason(payData.failedReason ?? '결제 실패'); }
    } catch (err) {
      setStatus('failed');
      setFailReason(err instanceof Error ? err.message : '네트워크 오류');
    }
  };

  if (loading) return <div className="flex min-h-screen items-center justify-center text-sm text-neutral-400">로딩 중...</div>;

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <header className="border-b border-neutral-200">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link to="/" className="text-xl font-semibold tracking-tight">Shoply</Link>
          <nav className="flex gap-5 text-sm text-neutral-600">
            <Link to="/">홈</Link>
            <Link to="/timesale">타임세일</Link>
            <Link to="/stats">현황</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="mb-8 text-2xl font-semibold">주문/결제</h1>

        {status === 'success' ? (
          <div className="rounded-lg border border-green-200 bg-green-50 p-8 text-center">
            <p className="text-lg font-semibold text-green-700">주문이 완료되었습니다</p>
            <p className="mt-2 text-sm text-neutral-600">감사합니다. 곧 배송이 시작됩니다.</p>
            {orderId && <p className="mt-2 font-mono text-xs text-neutral-500">주문번호: {orderId}</p>}
            <Link to="/" className="mt-6 inline-block rounded-md bg-neutral-900 px-5 py-2 text-sm text-white">홈으로</Link>
          </div>
        ) : (
          <div className="space-y-6">
            {/* 상품 추가 */}
            <section className="rounded-lg border border-neutral-200 p-5">
              <h2 className="mb-4 text-base font-semibold">상품 추가</h2>
              <div className="space-y-3">
                <select value={selectedProduct} onChange={(e) => { setSelectedProduct(e.target.value); setSelectedSize(null); }}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm">
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — ₩{(p.is_timesale && p.sale_price ? p.sale_price : p.price).toLocaleString()}
                      {p.is_timesale ? ' [타임세일]' : ''}
                    </option>
                  ))}
                </select>

                <div className="flex flex-wrap gap-2">
                  {availableSizes.map((s) => (
                    <button key={s.size} type="button" onClick={() => setSelectedSize(s.size)}
                      className={`rounded-md border px-3 py-1.5 text-sm transition ${selectedSize === s.size ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 hover:border-neutral-400'}`}>
                      {s.size} ({s.available})
                    </button>
                  ))}
                  {availableSizes.length === 0 && currentProduct && <p className="text-sm text-red-500">재고 없음</p>}
                </div>

                <div className="flex items-center gap-3">
                  <label className="text-sm text-neutral-600">수량</label>
                  <input type="number" min={1} max={10} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))}
                    className="w-20 rounded-md border border-neutral-300 px-3 py-1.5 text-sm" />
                  <button type="button" onClick={addToCart}
                    className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm text-white hover:bg-neutral-800">담기</button>
                </div>
              </div>
            </section>

            {/* 장바구니 */}
            {cart.length > 0 && (
              <section className="rounded-lg border border-neutral-200 p-5">
                <h2 className="mb-4 text-base font-semibold">장바구니</h2>
                <ul className="divide-y divide-neutral-100">
                  {cart.map((item, i) => (
                    <li key={i} className="flex items-center justify-between py-3 text-sm">
                      <div>
                        <p className="font-medium">{item.name}</p>
                        <p className="mt-0.5 text-xs text-neutral-500">사이즈 {item.size} · {item.quantity}개</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <p className="font-medium">₩{(item.unitPrice * item.quantity).toLocaleString()}</p>
                        <button type="button" onClick={() => removeFromCart(i)} className="text-xs text-red-400 hover:text-red-600">삭제</button>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex items-center justify-between border-t border-neutral-200 pt-4">
                  <span className="text-sm text-neutral-600">총 결제 금액</span>
                  <span className="text-lg font-semibold">₩{total.toLocaleString()}</span>
                </div>
              </section>
            )}

            {/* 배송지 */}
            <section className="rounded-lg border border-neutral-200 p-5">
              <h2 className="mb-4 text-base font-semibold">배송지 입력</h2>
              <div className="space-y-3">
                {[
                  { label: '이름', value: name, set: setName, type: 'text', placeholder: '홍길동' },
                  { label: '연락처', value: phone, set: setPhone, type: 'tel', placeholder: '010-0000-0000' },
                  { label: '주소', value: address, set: setAddress, type: 'text', placeholder: '서울시 강남구 ...' },
                ].map((f) => (
                  <div key={f.label}>
                    <label className="mb-1 block text-xs text-neutral-600">{f.label}</label>
                    <input type={f.type} value={f.value} onChange={(e) => f.set(e.target.value)}
                      placeholder={f.placeholder}
                      className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900" />
                  </div>
                ))}
              </div>
            </section>

            {/* 결제 */}
            <section className="rounded-lg border border-neutral-200 p-5">
              <h2 className="mb-4 text-base font-semibold">결제 수단</h2>
              <div className="grid grid-cols-2 gap-3">
                {([{ v: 'card', label: '신용카드' }, { v: 'bank', label: '무통장입금' }] as { v: PaymentMethod; label: string }[]).map((opt) => (
                  <button key={opt.v} type="button" onClick={() => setMethod(opt.v)}
                    className={`rounded-md border px-4 py-3 text-sm transition-colors ${method === opt.v ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500'}`}>
                    {opt.label}
                  </button>
                ))}
              </div>

              {status === 'failed' && (
                <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  결제 실패{failReason ? ` — ${failReason}` : ''}. 다시 시도해주세요.
                </p>
              )}

              <button type="button" onClick={handlePay} disabled={status === 'processing' || cart.length === 0}
                className="mt-5 w-full rounded-md bg-neutral-900 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50">
                {status === 'processing' ? '결제 처리 중...' : `₩${total.toLocaleString()} 결제하기`}
              </button>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
