'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function MHLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const tabs = [
    { name: '📊 차트 분석', path: '/admin/MH/chart' },
    { name: '💰 거래대금 상위', path: '/admin/MH/volume' },
    { name: '📈 업종 지수 관리', path: '/admin/MH/index' },
  ];

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="bg-white border-b px-6 py-3 flex gap-4 shadow-sm z-30 shrink-0">
        {tabs.map((tab) => {
          const isActive = pathname === tab.path;
          return (
            <Link
              key={tab.path}
              href={tab.path}
              className={`px-4 py-2 text-sm font-bold rounded-lg transition-all ${
                isActive
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {tab.name}
            </Link>
          );
        })}
      </div>
      <div className="flex-1 overflow-hidden relative flex flex-col">
        {children}
      </div>
    </div>
  );
}
