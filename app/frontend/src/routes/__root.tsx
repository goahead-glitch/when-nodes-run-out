import { createRootRoute, Outlet, Link } from '@tanstack/react-router';

export const Route = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="text-center">
        <h1 className="text-7xl font-bold text-neutral-900">404</h1>
        <p className="mt-4 text-sm text-neutral-500">페이지를 찾을 수 없습니다.</p>
        <Link to="/" className="mt-6 inline-block text-sm text-neutral-900 underline">
          홈으로 돌아가기
        </Link>
      </div>
    </div>
  ),
});
