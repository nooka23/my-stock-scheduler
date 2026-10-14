import { koreanDate } from '@/lib/daily-review-market';
export const dynamic = 'force-dynamic';
import type { Metadata } from 'next';
import DailyReview from '../review';

export const metadata: Metadata = {
  title: '모바일 데일리 리뷰 · My Stock Scheduler',
  description: '모바일 화면 구성으로 보는 데일리 리뷰',
};

export default function MobileDailyReviewPage() {
  return <DailyReview initialDate={koreanDate()} mobilePreview />;
}
