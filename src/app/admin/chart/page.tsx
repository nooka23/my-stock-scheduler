'use client';

import { useState, useEffect, useCallback } from 'react';
import StockChart from '@/components/StockChart';
import Link from 'next/link';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';
import { 
  calculateEMA, 
  calculateWMA, 
  calculateKeltner, 
  calculateMACD 
} from '@/utils/indicators';

// 1. 데이터 타입 정의
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
  ema20?: number;
  wma150?: number;
  keltner?: { upper: number; lower: number; middle: number };
  macd?: { macd: number; signal: number; histogram: number };
};

type MyProfile = {
  nickname: string;
  is_admin: boolean;
};

export default function ChartPage() {
  const supabase = createClientComponentClient();
  const router = useRouter();
  
  // 상태 관리
  const [data, setData] = useState<ChartData[]>([]);
  const [currentCompany, setCurrentCompany] = useState<Company>({ name: '삼성전자', code: '005930' });
  const [companyList, setCompanyList] = useState<Company[]>([]);
  
  const [inputCompany, setInputCompany] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [filteredCompanies, setFilteredCompanies] = useState<Company[]>([]);

  const [userProfile, setUserProfile] = useState<MyProfile | null>(null);

  // 2. 회사 목록 가져오기
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

  // [신규] 유저 프로필 가져오기
  useEffect(() => {
    const getUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { data } = await supabase
          .from('profiles')
          .select('nickname, is_admin')
          .eq('id', session.user.id)
          .single();
        setUserProfile(data as MyProfile);
      }
    };
    getUser();
  }, [supabase]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  // 3. 주가 데이터 가져오기 및 지표 계산
  const fetchStockData = useCallback(async (code: string) => {
    try {
      console.log(`🔍 [${code}] 데이터 다운로드 및 분석 시작...`);
      
      // JSON 파일 다운로드
      const jsonPromise = supabase.storage
        .from('stocks')
        .download(`${code}.json?t=${Date.now()}`);

      // 최근 60일치 데이터 (v2 테이블)
      const dbPromise = supabase
        .from('daily_prices_v2')
        .select('date, open, high, low, close, volume')
        .eq('code', code)
        .order('date', { ascending: false }) 
        .limit(60); 

      // 최근 60일치 RS 데이터 (v2 랭킹 테이블)
      const rsPromise = supabase
        .from('rs_rankings_v2')
        .select('date, rank_weighted')
        .eq('code', code)
        .order('date', { ascending: false })
        .limit(60);

      // 병렬 실행
      const [jsonResult, dbResult, rsResult] = await Promise.all([jsonPromise, dbPromise, rsPromise]);

      let chartData: any[] = [];

      if (jsonResult.data) {
        const textData = await jsonResult.data.text();
        chartData = JSON.parse(textData);
      }

      const dataMap = new Map();

      // 1. JSON 데이터 병합
      chartData.forEach(item => {
        if (item.time) {
            let o = Number(item.open);
            let h = Number(item.high);
            let l = Number(item.low);
            const c = Number(item.close);

            if (o === 0 && h === 0 && l === 0) {
                o = c; h = c; l = c;
            }

            dataMap.set(item.time, {
                ...item,
                open: o,
                high: h,
                low: l,
                close: c,
                volume: Number(item.volume),
                rs: item.rs !== null ? Number(item.rs) : undefined
            });
        }
      });

      // 2. DB 데이터 병합
      if (dbResult.data && dbResult.data.length > 0) {
        dbResult.data.forEach(row => {
            const time = row.date;
            if (!time) return;

            const existing = dataMap.get(time) || {};
            const merged = { ...existing, time };

            let o = Number(row.open);
            let h = Number(row.high);
            let l = Number(row.low);
            const c = Number(row.close);
            const v = Number(row.volume);

            if (o === 0 && h === 0 && l === 0) {
                o = c; h = c; l = c;
            }

            merged.open = o;
            merged.high = h;
            merged.low = l;
            merged.close = c;
            merged.volume = v;
            
            dataMap.set(time, merged);
        });
      }

      // 3. RS 데이터 병합
      if (rsResult.data && rsResult.data.length > 0) {
        rsResult.data.forEach(row => {
            const time = row.date;
            if (!time) return;

            const existing = dataMap.get(time);
            if (existing) {
                existing.rs = row.rank_weighted;
                dataMap.set(time, existing);
            }
        });
      }

      // 4. 최종 정렬
      chartData = Array.from(dataMap.values()).sort((a: any, b: any) => {
        return new Date(a.time).getTime() - new Date(b.time).getTime();
      });

      // 기술적 지표 계산
      if (chartData.length > 0) {
        const ema20 = calculateEMA(chartData, 20);
        const wma150 = calculateWMA(chartData, 150);
        const keltner = calculateKeltner(chartData, 20, 2.25);
        const macd = calculateMACD(chartData, 3, 10, 16);

        chartData = chartData.map((d, i) => ({
          ...d,
          ema20: ema20[i],
          wma150: wma150[i],
          keltner: keltner[i],
          macd: macd[i],
        }));
      }

      setData(chartData);

    } catch (e) {
      console.error("데이터 로딩 실패:", e);
      setData([]);
    }
  }, [supabase]);

  useEffect(() => {
    fetchStockData(currentCompany.code);
    setInputCompany(currentCompany.name);
  }, [currentCompany, fetchStockData]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputCompany(value);
    
    if (value.trim() !== '') {
      const lower = value.toLowerCase();
      const filtered = companyList.filter(c => 
        c.name.toLowerCase().includes(lower) || c.code.includes(value)
      );
      setFilteredCompanies(filtered);
      setShowDropdown(true);
    } else { 
      setShowDropdown(false); 
    }
  };

  const selectCompany = (comp: Company) => {
    setCurrentCompany(comp);
    setShowDropdown(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b px-6 py-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-6">
          <h1 className="text-2xl font-bold text-blue-800">📊 차트 분석 (beta)</h1>
          
          <div className="relative w-72">
            <input 
              type="text" 
              className="w-full border border-gray-300 p-2 pl-3 rounded-lg text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              value={inputCompany}
              onChange={handleSearchChange}
              onFocus={() => inputCompany && setShowDropdown(true)}
              placeholder="종목명 또는 코드 검색..."
            />
            
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

        <div className="flex items-center gap-6">
            <nav className="flex gap-6 text-lg">
            <Link href="/" className="text-gray-400 hover:text-blue-600 font-bold transition-colors">🗓️ 스케줄러</Link>
            <Link href="/discovery" className="text-gray-400 hover:text-blue-600 font-bold transition-colors">🔍 종목발굴</Link>
            <span className="text-blue-600 font-bold border-b-2 border-blue-600 cursor-default">📊 차트(Admin)</span>
            </nav>

            {userProfile && (
                <div className="flex items-center gap-3 border-l pl-6">
                <span className="text-sm text-gray-600">
                    <b>{userProfile.nickname}</b>님
                    {userProfile.is_admin && <span className="ml-1 text-[10px] bg-purple-100 text-purple-700 px-1 rounded border border-purple-200">ADMIN</span>}
                </span>
                
                {userProfile.is_admin && (
                    <div className="flex gap-2">
                    <button onClick={() => router.push('/admin')} className="text-sm bg-blue-100 text-blue-700 px-3 py-1 rounded hover:bg-blue-200 font-bold">
                        ⚙️ 관리자
                    </button>
                    </div>
                )}
                
                <button onClick={handleLogout} className="text-sm bg-gray-200 px-3 py-1 rounded hover:bg-gray-300">로그아웃</button>
                </div>
            )}
        </div>
      </header>

      <main className="flex-1 p-6 flex flex-col gap-4">
        <div className="bg-white p-6 rounded-xl shadow-md border flex-1 min-h-[500px] relative flex flex-col">
          <div className="mb-4 flex items-baseline gap-2">
            <h2 className="text-2xl font-bold text-gray-800">{currentCompany.name}</h2>
            <span className="text-lg text-gray-500 font-medium">({currentCompany.code})</span>
          </div>
          
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
