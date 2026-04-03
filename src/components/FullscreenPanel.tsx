'use client';

import { useEffect, useRef, useState } from 'react';

type Props = {
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
};

export default function FullscreenPanel({ children, className = '', contentClassName = '' }: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsFullscreen(document.fullscreenElement === panelRef.current);
      window.dispatchEvent(new Event('resize'));
    };

    document.addEventListener('fullscreenchange', syncFullscreenState);
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState);
  }, []);

  const toggleFullscreen = async () => {
    if (!panelRef.current) return;

    if (document.fullscreenElement === panelRef.current) {
      await document.exitFullscreen();
      return;
    }

    await panelRef.current.requestFullscreen();
  };

  return (
    <div
      ref={panelRef}
      className={`relative min-h-0 overflow-hidden rounded-[20px] border border-[var(--border)] bg-white ${isFullscreen ? 'h-screen w-screen rounded-none border-0' : 'h-full'} ${className}`}
    >
      <div className="pointer-events-none absolute right-3 top-3 z-20">
        <button
          type="button"
          onClick={toggleFullscreen}
          className="pointer-events-auto rounded-full border border-[var(--border)] bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-sm)] backdrop-blur hover:bg-white"
        >
          {isFullscreen ? '전체화면 종료' : '차트 크게 보기'}
        </button>
      </div>
      <div className={`min-h-0 ${isFullscreen ? 'h-full w-full bg-white p-4 md:p-6' : 'h-full'} ${contentClassName}`}>
        {children}
      </div>
    </div>
  );
}
