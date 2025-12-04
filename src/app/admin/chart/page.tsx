'use client';

import { useState, useEffect, useCallback } from 'react';
import StockChart from '@/components/StockChart';
import Link from 'next/link';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { 
  calculateEMA, 
  calculateWMA, 
  calculateKeltner, 
  calculateMACD 
} from '@/utils/indicators';

// 1. 데이터 타입 정의 (StockChart.tsx와 동일하게 맞춤)
type Company = {
  code: string;
  name: string;
};

type ChartData = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  rs?: number;
  // 기술적 지표 필드 추가
  ema20?: number;
  wma150?: number;
  keltner?: { upper: number; lower: number; middle: number };
  macd?: { macd: number; signal: number; histogram: number };
};

export default function ChartPage() {
  const supabase = createClientComponentClient();
  
  // 상태 관리
  const [data, setData] = useState<ChartData[]>([]);
  const [currentCompany, setCurrentCompany] = useState<Company>({ name: '삼성전자', code: '005930' });
  const [companyList, setCompanyList] = useState<Company[]>([]);
  
  // 검색 기능 관련 상태
  const [inputCompany, setInputCompany] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [filteredCompanies, setFilteredCompanies] = useState<Company[]>([]);

  // 2. 회사 목록 가져오기 (초기 1회)
  useEffect(() => {
    const fetchCompanies = async () => {
      const { data } = await supabase
        .from('companies')
        .select('*')
        .order('name', { ascending: true })
        .range(0, 9999);
        
      if (data) setCompanyList(data as Company[]);
    };
    fetchCompanies();
  }, [supabase]);

  // 3. 주가 데이터 가져오기 및 지표 계산 (핵심 로직)
  const fetchStockData = useCallback(async (code: string) => {
    try {
      console.log(`🔍 [${code}] 데이터 다운로드 및 분석 시작...`);
      
      // JSON 파일 다운로드와 최신 DB 조회를 동시에 수행 (병렬 처리)
      const jsonPromise = supabase.storage
        .from('stocks')
        .download(`${code}.json?t=${Date.now()}`);

      // 최근 60일치 데이터만 DB에서 가져옴 (JSON과 병합용)
      const dbPromise = supabase
        .from('daily_prices')
        .select('date_str, open, high, low, close, volume, rs_rating')
        .eq('code', code)
        .order('date_str', { ascending: false }) // 최신순으로 정렬하여
        .limit(60); // 최근 60개를 가져옴

      // 병렬 실행
      const [jsonResult, dbResult] = await Promise.all([jsonPromise, dbPromise]);

      let chartData: any[] = [];

      // JSON 파싱 (과거 데이터)
      if (jsonResult.data) {
        const textData = await jsonResult.data.text();
        chartData = JSON.parse(textData);
      }

      // DB 데이터 병합 (최신 데이터)
      // DB에서 가져온 데이터 형식을 chartData 형식으로 변환
      if (dbResult.data && dbResult.data.length > 0) {
        // 1. 기존 JSON 데이터를 Map에 넣음
        const dataMap = new Map();
        chartData.forEach(item => {
            // JSON 데이터도 안전하게 변환
            if (item.time) {
                dataMap.set(item.time, {
                    ...item,
                    open: Number(item.open),
                    high: Number(item.high),
                    low: Number(item.low),
                    close: Number(item.close),
                    volume: Number(item.volume),
                    rs: item.rs !== null ? Number(item.rs) : undefined
                });
            }
        });

        // 2. DB 데이터를 Map에 덮어씌움 (null 값 체크하여 보존)
        dbResult.data.forEach(row => {
            const time = row.date_str;
            if (!time) return;

            // 기존 데이터 가져오기 (없으면 빈 객체)
            const existing = dataMap.get(time) || {};
            const merged = { ...existing, time };

            // DB 값이 null이 아니면 덮어쓰고, null이면 기존 값 유지 (기존 값도 없으면 0)
            if (row.open !== null) merged.open = Number(row.open);
            else if (merged.open === undefined) merged.open = 0;

            if (row.high !== null) merged.high = Number(row.high);
            else if (merged.high === undefined) merged.high = 0;

            if (row.low !== null) merged.low = Number(row.low);
            else if (merged.low === undefined) merged.low = 0;

            if (row.close !== null) merged.close = Number(row.close);
            else if (merged.close === undefined) merged.close = 0;

            if (row.volume !== null) merged.volume = Number(row.volume);
            else if (merged.volume === undefined) merged.volume = 0;

            // RS rating은 선택적 필드
            if (row.rs_rating !== null) merged.rs = Number(row.rs_rating);
            
            dataMap.set(time, merged);
        });

        // 3. Map을 다시 배열로 변환하고 날짜순 정렬
        chartData = Array.from(dataMap.values()).sort((a: any, b: any) => {
            return new Date(a.time).getTime() - new Date(b.time).getTime();
        });
      }

      // -----------------------------------------------------------
      // ★ 기술적 지표 계산 (요청하신 파라미터 적용)
      // -----------------------------------------------------------
      if (chartData.length > 0) {
        
        // 1. 이동평균선
        // - 20일 지수이동평균 (EMA)
        const ema20 = calculateEMA(chartData, 20);
        // - 150일 가중이동평균 (WMA)
        const wma150 = calculateWMA(chartData, 150);
        
        // 2. 켈트너 채널 (Keltner Channel)
        // - 중앙: 20일 EMA
        // - 밴드 폭: ATR * 2.25
        const keltner = calculateKeltner(chartData, 20, 2.25);
        
        // 3. MACD
        // - Short: 3, Long: 10, Signal: 16
        const macd = calculateMACD(chartData, 3, 10, 16);

        // 4. 데이터 병합 (원본 데이터에 계산된 지표 추가)
        chartData = chartData.map((d, i) => ({
          ...d,
          ema20: ema20[i],
          wma150: wma150[i],
          keltner: keltner[i],
          macd: macd[i],
        }));
        
        console.log("✅ 지표 계산 완료. 최신 데이터:", chartData[chartData.length - 1]);
      }

      setData(chartData);

    } catch (e) {
      console.error("데이터 로딩 실패:", e);
      // 에러 시 빈 데이터로 초기화하거나 에러 메시지 표시 가능
      setData([]);
    }
  }, [supabase]);

  // 종목 변경 시 데이터 새로고침
  useEffect(() => {
    fetchStockData(currentCompany.code);
    setInputCompany(currentCompany.name);
  }, [currentCompany, fetchStockData]);

  // 검색어 입력 핸들러
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputCompany(value);
    
    if (value.trim() !== '') {
      const lower = value.toLowerCase();
      // 이름이나 코드로 검색
      const filtered = companyList.filter(c => 
        c.name.toLowerCase().includes(lower) || c.code.includes(value)
      );
      setFilteredCompanies(filtered);
      setShowDropdown(true);
    } else { 
      setShowDropdown(false); 
    }
  };

  // 종목 선택 핸들러
  const selectCompany = (comp: Company) => {
    setCurrentCompany(comp);
    setShowDropdown(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* 헤더 */}
      <header className="bg-white border-b px-6 py-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-6">
          <h1 className="text-2xl font-bold text-blue-800">📊 차트 분석 (beta)</h1>
          
          {/* 검색창 */}
          <div className="relative w-72">
            <input 
              type="text" 
              className="w-full border border-gray-300 p-2 pl-3 rounded-lg text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              value={inputCompany}
              onChange={handleSearchChange}
              onFocus={() => inputCompany && setShowDropdown(true)}
              // onBlur를 넣으면 클릭 전에 닫힐 수 있으므로 주의 (보통 setTimeout 사용)
              placeholder="종목명 또는 코드 검색..."
            />
            
            {/* 검색 드롭다운 */}
            {showDropdown && filteredCompanies.length > 0 && (
              <ul className="absolute z-20 w-full bg-white border mt-1 rounded-lg shadow-xl max-h-80 overflow-y-auto">
                {filteredCompanies.map((comp) => (
                  <li 
                    key={comp.code} 
                    onClick={() => selectCompany(comp)} 
                    className="p-3 hover:bg-blue-50 cursor-pointer text-sm flex justify-between items-center border-b last:border-none"
                  >
                    <span className="font-bold text-gray-700">{comp.name}</span>
                    <span className="text-gray-400 text-xs bg-gray-100 px-2 py-1 rounded">{comp.code}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* 네비게이션 */}
        <div className="flex gap-6 text-lg">
          <Link href="/" className="text-gray-400 hover:text-blue-600 font-bold transition-colors">🗓️ 스케줄러</Link>
          <span className="text-blue-600 font-bold border-b-2 border-blue-600 cursor-default">📊 차트</span>
        </div>
      </header>

      {/* 메인 컨텐츠 */}
      <main className="flex-1 p-6 flex flex-col gap-4">
        <div className="bg-white p-6 rounded-xl shadow-md border flex-1 min-h-[500px] relative flex flex-col">
          
          {/* 종목 정보 헤더 */}
          <div className="mb-4 flex items-baseline gap-2">
            <h2 className="text-2xl font-bold text-gray-800">{currentCompany.name}</h2>
            <span className="text-lg text-gray-500 font-medium">({currentCompany.code})</span>
          </div>
          
          {/* 차트 영역 */}
          <div className="flex-1 w-full relative">
            {data.length > 0 ? (
              <StockChart data={data} />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 bg-gray-50 rounded-lg">
                <p className="text-lg font-bold mb-2">
                  {inputCompany ? '데이터 로딩중...' : '종목을 검색해주세요'}
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}