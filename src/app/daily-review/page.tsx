import { koreanDate } from '@/lib/daily-review-market';
export const dynamic = 'force-dynamic';
import type { Metadata } from 'next';
import DailyReview from './review';

export const metadata: Metadata = {
  title: '데일리 리뷰 · My Stock Scheduler',
  description: '시장 뉴스부터 지수까지, 하루의 시장을 순서대로 확인하는 리뷰 화면 시안',
};

export default function DailyReviewPage() {
  return <DailyReview initialDate={koreanDate()} />;
}
