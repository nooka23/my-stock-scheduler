'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useParams, useRouter } from 'next/navigation';

type IndexType = 'industry' | 'theme';

type CompanyItem = {
  code: string;
  name: string;
  marcap: number | null;
};

type IndexMeta = {
  id: number;
  code: string;
  name: string;
};

const CHUNK_SIZE = 1000;

export default function MarketIndexConstituentsPage() {
  const supabase = createClientComponentClient();
  const params = useParams<{ type: string; code: string }>();
  const router = useRouter();

  const [meta, setMeta] = useState<IndexMeta | null>(null);
  const [items, setItems] = useState<CompanyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);

      const type = params?.type as IndexType;
      const code = params?.code;

      if (!type || !code || (type !== 'industry' && type !== 'theme')) {
        setError('잘못된 접근입니다.');
        setLoading(false);
        return;
      }

      const indexTable = type === 'industry' ? 'industries' : 'themes';
      const linkTable = type === 'industry' ? 'company_industries' : 'company_themes';
      const idColumn = type === 'industry' ? 'industry_id' : 'theme_id';

      const { data: metaRow, error: metaError } = await supabase
        .from(indexTable)
        .select('id, code, name')
        .eq('code', code)
        .maybeSingle();

      if (metaError || !metaRow) {
        setError('업종/테마 정보를 찾을 수 없습니다.');
        setLoading(false);
        return;
      }

      setMeta(metaRow);

      const { data: linkRows, error: linkError } = await supabase
        .from(linkTable)
        .select('company_code')
        .eq(idColumn, metaRow.id);

      if (linkError) {
        setError('구성 종목을 불러오지 못했습니다.');
        setLoading(false);
        return;
      }

      const codes = Array.from(
        new Set((linkRows || []).map((row: any) => row.company_code).filter(Boolean))
      );

      const infoMap = new Map<string, { name: string; marcap: number | null }>();

      for (let i = 0; i < codes.length; i += CHUNK_SIZE) {
        const chunk = codes.slice(i, i + CHUNK_SIZE);
        const { data: companiesData } = await supabase
          .from('companies')
          .select('code, name, marcap')
          .in('code', chunk);

        companiesData?.forEach((c: any) => {
          infoMap.set(c.code, { name: c.name, marcap: c.marcap });
        });
      }

      const merged = codes.map(code => {
        const info = infoMap.get(code);
        return {
          code,
          name: info?.name || '알 수 없음',
          marcap: info?.marcap ?? null
        };
      });

      const deduped = Array.from(
        new Map(merged.map(item => [item.code, item])).values()
      );

      setItems(deduped);
      setLoading(false);
    };

    load();
  }, [params, supabase]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = items;
    if (q) {
      list = list.filter(item =>
        item.name.toLowerCase().includes(q) || item.code.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      const am = a.marcap ?? -1;
      const bm = b.marcap ?? -1;
      if (am !== bm) return bm - am;
      return a.name.localeCompare(b.name);
    });
  }, [items, query]);

  const formatMarcap = (value: number | null) => {
    if (!value || value <= 0) return '-';
    return Math.round(value / 100000000).toLocaleString();
  };

  const title = meta
    ? `${meta.name} (${meta.code})`
    : params?.code || '';

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {title} 구성 종목
          </h1>
          <p className="text-sm text-gray-500">
            {meta?.name ? `총 ${items.length.toLocaleString()}개 종목` : '목록을 불러오는 중입니다.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push('/market-index')}
          className="w-fit rounded-full bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200"
        >
          ← 시장 지수로 돌아가기
        </button>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="text-sm font-semibold text-gray-700">구성 종목 리스트</div>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="종목명 또는 코드 검색..."
            className="w-full md:w-72 rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="mt-4">
          {loading && (
            <div className="text-sm text-gray-500">목록 로딩 중...</div>
          )}
          {!loading && error && (
            <div className="text-sm text-red-500">{error}</div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="text-sm text-gray-500">표시할 종목이 없습니다.</div>
          )}
          {!loading && !error && filtered.length > 0 && (
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-gray-400">
                    <th className="py-2 pr-2">번호</th>
                    <th className="py-2 pr-2">종목명</th>
                    <th className="py-2 pr-2">종목코드</th>
                    <th className="py-2 pr-2 text-right">시총(억)</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item, idx) => (
                    <tr key={item.code} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="py-2 pr-2 text-gray-500">{idx + 1}</td>
                      <td className="py-2 pr-2 font-medium text-gray-800">{item.name}</td>
                      <td className="py-2 pr-2 text-gray-600">{item.code}</td>
                      <td className="py-2 pr-2 text-right text-gray-700">
                        {formatMarcap(item.marcap)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
