'use client';

// Removed Link and usePathname as they are no longer needed for tabs
// import Link from 'next/link';
// import { usePathname } from 'next/navigation';

export default function MHLayout({ children }: { children: React.ReactNode }) {
  // const pathname = usePathname(); // No longer needed

  // Removed tabs array as it is no longer needed
  // const tabs = [
  //   { name: '📊 차트 분석', path: '/admin/MH/chart' },
  //   { name: '💰 거래대금 상위', path: '/admin/MH/volume' },
  //   { name: '📈 업종 지수 관리', path: '/admin/MH/index' },
  // ];

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Removed the navigation div */}
      <div className="flex-1 overflow-hidden relative flex flex-col">
        {children}
      </div>
    </div>
  );
}
