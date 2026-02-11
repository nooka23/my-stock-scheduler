'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import IndexLineChart from '@/components/IndexLineChart';

type IndexType = 'industry' | 'theme';

type IndexOption = {
  id: number;
  code: string;
  name: string;
};

type IndexRow = {
  date: string;
  index_value: number;
};

type RankRow = {
  indexType: IndexType;
  code: string;
  name: string;
  lastValue: number | null;
  weekReturn: number | null;
  monthReturn: number | null;
  threeMonthReturn: number | null;
  yearReturn: number | null;
};

type ConstituentsStat = {
  count: number;
  marcapSum: number;
};

type LeaderRow = {
  code: string;
  name: string;
  leader_score: number;
  trading_value: number;
  ret_1d: number;
  ret_rank: number;
  rank_amount_60: number;
  rank_rs: number;
  theme: string;
  industry: string;
};

const CHUNK_SIZE = 1000;
const MARCAP_SUM_THRESHOLD = 200_000_000_000_000;

const buildStatKey = (type: IndexType, code: string) => `${type}:${code}`;

const buildReturn = (first: number | null, last: number | null) => {
  if (first === null || last === null || first === 0) return null;
  return ((last - first) / first) * 100;
};

export default function MarketIndexPage() {
  const supabase = createClientComponentClient();

  const [selectedType, setSelectedType] = useState<IndexType | null>(null);
  const [industryOptions, setIndustryOptions] = useState<IndexOption[]>([]);
  const [themeOptions, setThemeOptions] = useState<IndexOption[]>([]);
  const [industryRanks, setIndustryRanks] = useState<RankRow[]>([]);
  const [themeRanks, setThemeRanks] = useState<RankRow[]>([]);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string>('');
  const [pageTab, setPageTab] = useState<'indices' | 'leaders'>('leaders');
  const [viewMode, setViewMode] = useState<'chart' | 'constituents'>('chart');
  const [chartRows, setChartRows] = useState<IndexRow[]>([]);
  const [loadingRanks, setLoadingRanks] = useState<boolean>(false);
  const [loadingChart, setLoadingChart] = useState<boolean>(false);
  const [sortKey, setSortKey] = useState<'week' | 'month' | 'threeMonth' | 'year'>('week');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [constituents, setConstituents] = useState<
    { code: string; name: string; marcap: number | null }[]
  >([]);
  const [loadingConstituents, setLoadingConstituents] = useState<boolean>(false);
  const [constituentsError, setConstituentsError] = useState<string | null>(null);
  const [constituentsQuery, setConstituentsQuery] = useState<string>('');
  const [minCountEnabled, setMinCountEnabled] = useState<boolean>(false);
  const [minMarcapEnabled, setMinMarcapEnabled] = useState<boolean>(false);
  const [industryStats, setIndustryStats] = useState<Map<string, ConstituentsStat> | null>(
    null
  );
  const [themeStats, setThemeStats] = useState<Map<string, ConstituentsStat> | null>(null);
  const [loadingStats, setLoadingStats] = useState<boolean>(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [leaderRows, setLeaderRows] = useState<LeaderRow[]>([]);
  const [leaderDate, setLeaderDate] = useState<string>('');
  const [leaderLoading, setLeaderLoading] = useState<boolean>(false);
  const [leaderError, setLeaderError] = useState<string | null>(null);
  const [leaderQuery, setLeaderQuery] = useState<string>('');

  useEffect(() => {
    const loadOptions = async () => {
      const [{ data: industryData }, { data: themeData }] = await Promise.all([
        supabase.from('industries').select('id, code, name').order('name').range(0, 5000),
        supabase.from('themes').select('id, code, name').order('name').range(0, 5000)
      ]);

      if (industryData) {
        setIndustryOptions(
          industryData.map(item => ({ id: item.id, code: item.code, name: item.name }))
        );
      }
      if (themeData) {
        setThemeOptions(
          themeData.map(item => ({ id: item.id, code: item.code, name: item.name }))
        );
      }
    };

    loadOptions();
  }, [supabase]);

  useEffect(() => {
    const loadRanks = async () => {
      setLoadingRanks(true);
      try {
        const [{ data: latestIndustry }, { data: latestTheme }] = await Promise.all([
          supabase
            .from('equal_weight_indices')
            .select('date')
            .eq('index_type', 'industry')
            .order('date', { ascending: false })
            .limit(1),
          supabase
            .from('equal_weight_indices')
            .select('date')
            .eq('index_type', 'theme')
            .order('date', { ascending: false })
            .limit(1)
        ]);

        const latestIndustryDate = latestIndustry?.[0]?.date;
        const latestThemeDate = latestTheme?.[0]?.date;

        if (latestIndustryDate) {
          const industryRanks = await buildRanks(
            supabase,
            'industry',
            latestIndustryDate,
            industryOptions
          );
          setIndustryRanks(industryRanks);
        }

        if (latestThemeDate) {
          const themeRanks = await buildRanks(
            supabase,
            'theme',
            latestThemeDate,
            themeOptions
          );
          setThemeRanks(themeRanks);
        }
      } finally {
        setLoadingRanks(false);
      }
    };

    if (industryOptions.length || themeOptions.length) {
      loadRanks();
    }
  }, [supabase, industryOptions, themeOptions]);

  useEffect(() => {
    if (!selectedType || !selectedCode) {
      setChartRows([]);
      return;
    }

    const loadChart = async () => {
      setLoadingChart(true);
      try {
        const rows: IndexRow[] = [];
        let offset = 0;
        const pageSize = 1000;
        while (true) {
          const { data, error } = await supabase
            .from('equal_weight_indices')
            .select('date, index_value')
            .eq('index_type', selectedType)
            .eq('index_code', selectedCode)
            .order('date', { ascending: true })
            .range(offset, offset + pageSize - 1);

          if (error || !data || data.length === 0) break;
          rows.push(...data);
          if (data.length < pageSize) break;
          offset += pageSize;
        }

        setChartRows(rows);
      } finally {
        setLoadingChart(false);
      }
    };

    loadChart();
  }, [selectedType, selectedCode, supabase]);

  useEffect(() => {
    if (!minCountEnabled && !minMarcapEnabled) return;
    loadStats('industry');
    loadStats('theme');
  }, [minCountEnabled, minMarcapEnabled, industryOptions, themeOptions]);

  useEffect(() => {
    if (pageTab !== 'leaders') return;
    const loadLeaders = async () => {
      setLeaderLoading(true);
      setLeaderError(null);
      try {
        const { data: latestRows } = await supabase
          .from('leader_stocks_daily')
          .select('date')
          .order('date', { ascending: false })
          .limit(1);

        const latestDate = latestRows?.[0]?.date;
        if (!latestDate) {
          setLeaderRows([]);
          setLeaderDate('');
          return;
        }

        setLeaderDate(latestDate);

        const { data: leaderData, error: leaderErr } = await supabase
          .from('leader_stocks_daily')
          .select('code, leader_score, trading_value, ret_1d, ret_rank, rank_amount_60, rank_rs')
          .eq('date', latestDate)
          .order('leader_score', { ascending: false })
          .limit(200);

        if (leaderErr) {
          throw leaderErr;
        }

        const codes = leaderData?.map(row => row.code) || [];
        const infoMap = new Map<string, { name: string }>();

        for (let i = 0; i < codes.length; i += CHUNK_SIZE) {
          const chunk = codes.slice(i, i + CHUNK_SIZE);
          const { data: companiesData } = await supabase
            .from('companies')
            .select('code, name')
            .in('code', chunk);

          companiesData?.forEach((c: any) => {
            infoMap.set(c.code, { name: c.name });
          });
        }

        const themeMap = new Map<string, string[]>();
        const industryMap = new Map<string, string[]>();

        const themeIdToName = new Map<number, string>();
        const industryIdToName = new Map<number, string>();

        for (let i = 0; i < codes.length; i += CHUNK_SIZE) {
          const chunk = codes.slice(i, i + CHUNK_SIZE);
          const { data: themeLinks } = await supabase
            .from('company_themes')
            .select('company_code, theme_id')
            .in('company_code', chunk);

          const themeIds = Array.from(
            new Set((themeLinks || []).map((row: any) => row.theme_id).filter(Boolean))
          ) as number[];

          for (let j = 0; j < themeIds.length; j += CHUNK_SIZE) {
            const idChunk = themeIds.slice(j, j + CHUNK_SIZE);
            const { data: themeRows } = await supabase
              .from('themes')
              .select('id, name')
              .in('id', idChunk);
            themeRows?.forEach((row: any) => {
              themeIdToName.set(row.id, row.name);
            });
          }

          themeLinks?.forEach((row: any) => {
            const name = themeIdToName.get(row.theme_id);
            if (!name) return;
            const list = themeMap.get(row.company_code) || [];
            if (!list.includes(name)) list.push(name);
            themeMap.set(row.company_code, list);
          });

          const { data: industryLinks } = await supabase
            .from('company_industries')
            .select('company_code, industry_id')
            .in('company_code', chunk);

          const industryIds = Array.from(
            new Set((industryLinks || []).map((row: any) => row.industry_id).filter(Boolean))
          ) as number[];

          for (let j = 0; j < industryIds.length; j += CHUNK_SIZE) {
            const idChunk = industryIds.slice(j, j + CHUNK_SIZE);
            const { data: industryRows } = await supabase
              .from('industries')
              .select('id, name')
              .in('id', idChunk);
            industryRows?.forEach((row: any) => {
              industryIdToName.set(row.id, row.name);
            });
          }

          industryLinks?.forEach((row: any) => {
            const name = industryIdToName.get(row.industry_id);
            if (!name) return;
            const list = industryMap.get(row.company_code) || [];
            if (!list.includes(name)) list.push(name);
            industryMap.set(row.company_code, list);
          });
        }

        const merged =
          leaderData?.map(row => ({
            code: row.code,
            name: infoMap.get(row.code)?.name || '이름없음',
            leader_score: Number(row.leader_score ?? 0),
            trading_value: Number(row.trading_value ?? 0),
            ret_1d: Number(row.ret_1d ?? 0),
            ret_rank: Number(row.ret_rank ?? 0),
            rank_amount_60: Number(row.rank_amount_60 ?? 0),
            rank_rs: Number(row.rank_rs ?? 0),
            theme: (themeMap.get(row.code) || []).slice(0, 2).join(', '),
            industry: (industryMap.get(row.code) || []).slice(0, 2).join(', ')
          })) || [];

        setLeaderRows(merged);
      } catch (err) {
        console.error('leader load failed:', err);
        setLeaderError('오늘의 선도주 데이터를 불러오지 못했습니다.');
      } finally {
        setLeaderLoading(false);
      }
    };

    loadLeaders();
  }, [pageTab, supabase]);

  const activeRanks = useMemo(() => {
    const source = [...industryRanks, ...themeRanks];
    const keyMap: Record<typeof sortKey, keyof RankRow> = {
      week: 'weekReturn',
      month: 'monthReturn',
      threeMonth: 'threeMonthReturn',
      year: 'yearReturn'
    };
    const key = keyMap[sortKey];
    const sorted = [...source].sort((a, b) => {
      const av = a[key] ?? (sortDir === 'asc' ? Infinity : -Infinity);
      const bv = b[key] ?? (sortDir === 'asc' ? Infinity : -Infinity);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return sorted;
  }, [industryRanks, themeRanks, sortKey, sortDir]);

  const activeStats = useMemo(() => {
    const combined = new Map<string, ConstituentsStat>();
    const mergeInto = (source: Map<string, ConstituentsStat> | null) => {
      if (!source) return;
      source.forEach((value, key) => {
        combined.set(key, value);
      });
    };
    mergeInto(industryStats);
    mergeInto(themeStats);
    return combined;
  }, [industryStats, themeStats]);

  const visibleRanks = useMemo(() => {
    if (!minCountEnabled && !minMarcapEnabled) {
      return activeRanks;
    }
    if (!activeStats) {
      return activeRanks;
    }
    return activeRanks.filter(row => {
      const stat = activeStats.get(buildStatKey(row.indexType, row.code));
      if (!stat) return false;
      if (minCountEnabled && stat.count <= 10) return false;
      if (minMarcapEnabled && stat.marcapSum < MARCAP_SUM_THRESHOLD) return false;
      return true;
    });
  }, [activeRanks, activeStats, minCountEnabled, minMarcapEnabled]);

  const activeSelectionLabel =
    selectedName ? `${selectedName}${selectedCode ? ` (${selectedCode})` : ''}` : '';

  const filteredConstituents = useMemo(() => {
    const q = constituentsQuery.trim().toLowerCase();
    let list = constituents;
    if (q) {
      list = list.filter(
        item =>
          item.name.toLowerCase().includes(q) || item.code.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      const am = a.marcap ?? -1;
      const bm = b.marcap ?? -1;
      if (am !== bm) return bm - am;
      return a.name.localeCompare(b.name);
    });
  }, [constituents, constituentsQuery]);

  const filteredLeaders = useMemo(() => {
    const q = leaderQuery.trim().toLowerCase();
    let list = leaderRows;
    if (q) {
      list = list.filter(
        item => item.name.toLowerCase().includes(q) || item.code.toLowerCase().includes(q)
      );
    }
    return list;
  }, [leaderRows, leaderQuery]);

  const leaderTopGroups = useMemo(() => {
    const industryCounts = new Map<string, number>();
    const themeCounts = new Map<string, number>();

    filteredLeaders.forEach(row => {
      const industries = (row.industry || '')
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);
      const themes = (row.theme || '')
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);

      industries.forEach(name => {
        industryCounts.set(name, (industryCounts.get(name) || 0) + 1);
      });
      themes.forEach(name => {
        themeCounts.set(name, (themeCounts.get(name) || 0) + 1);
      });
    });

    const topIndustries = Array.from(industryCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    const topThemes = Array.from(themeCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    return { topIndustries, topThemes };
  }, [filteredLeaders]);

  const formatMarcap = (value: number | null) => {
    if (!value || value <= 0) return '-';
    return Math.round(value / 100000000).toLocaleString();
  };

  const formatTradingValue = (value: number) => {
    if (!value || value <= 0) return '-';
    return Math.round(value / 100000000).toLocaleString();
  };

  const handleSelect = (row: RankRow, type: IndexType) => {
    setSelectedType(type);
    setSelectedCode(row.code);
    setSelectedName(row.name);
    setViewMode('chart');
  };

  const loadConstituents = async (type: IndexType, code: string, name: string) => {
    setSelectedType(type);
    setSelectedCode(code);
    setSelectedName(name);
    setViewMode('constituents');
    setConstituents([]);
    setConstituentsError(null);
    setConstituentsQuery('');
    setLoadingConstituents(true);

    try {
      const options = type === 'industry' ? industryOptions : themeOptions;
      const option = options.find(item => item.code === code);
      if (!option) {
        setConstituentsError('업종/테마 정보를 찾을 수 없습니다.');
        return;
      }

      const linkTable = type === 'industry' ? 'company_industries' : 'company_themes';
      const idColumn = type === 'industry' ? 'industry_id' : 'theme_id';

      const { data: linkRows, error: linkError } = await supabase
        .from(linkTable)
        .select('company_code')
        .eq(idColumn, option.id);

      if (linkError) {
        setConstituentsError('구성 종목을 불러오지 못했습니다.');
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

      setConstituents(
        codes.map(code => {
          const info = infoMap.get(code);
          return {
            code,
            name: info?.name || '알 수 없음',
            marcap: info?.marcap ?? null
          };
        })
      );
    } finally {
      setLoadingConstituents(false);
    }
  };

  const loadStats = async (type: IndexType) => {
    const options = type === 'industry' ? industryOptions : themeOptions;
    if (options.length === 0) return;
    if (type === 'industry' && industryStats) return;
    if (type === 'theme' && themeStats) return;

    setLoadingStats(true);
    setStatsError(null);

    try {
      const idToCode = new Map(options.map(item => [item.id, item.code]));
      const linkTable = type === 'industry' ? 'company_industries' : 'company_themes';
      const idColumn = type === 'industry' ? 'industry_id' : 'theme_id';

      const links: { code: string; companyCode: string }[] = [];
      const companyCodes = new Set<string>();
      let offset = 0;
      const pageSize = 1000;

      let failed = false;
      while (true) {
        const { data: page, error } = await supabase
          .from(linkTable)
          .select(`${idColumn}, company_code`)
          .range(offset, offset + pageSize - 1);

        if (error) {
          setStatsError('필터 계산 중 오류가 발생했습니다.');
          failed = true;
          break;
        }
        if (!page || page.length === 0) break;

        page.forEach((row: any) => {
          const code = idToCode.get(row[idColumn]);
          const companyCode = row.company_code;
          if (!code || !companyCode) return;
          links.push({ code, companyCode });
          companyCodes.add(companyCode);
        });

        if (page.length < pageSize) break;
        offset += pageSize;
      }

      if (failed) return;

      const marcapMap = new Map<string, number>();
      const codeList = Array.from(companyCodes);
      for (let i = 0; i < codeList.length; i += CHUNK_SIZE) {
        const chunk = codeList.slice(i, i + CHUNK_SIZE);
        const { data: companiesData } = await supabase
          .from('companies')
          .select('code, marcap')
          .in('code', chunk);

        companiesData?.forEach((c: any) => {
          marcapMap.set(c.code, c.marcap ?? 0);
        });
      }

      const stats = new Map<string, ConstituentsStat>();
      links.forEach(link => {
        const marcap = marcapMap.get(link.companyCode) ?? 0;
        const key = buildStatKey(type, link.code);
        const current = stats.get(key) || { count: 0, marcapSum: 0 };
        current.count += 1;
        current.marcapSum += marcap;
        stats.set(key, current);
      });

      if (type === 'industry') {
        setIndustryStats(stats);
      } else {
        setThemeStats(stats);
      }
    } catch (err) {
      console.error('통계 계산 실패:', err);
      setStatsError('필터 계산 중 오류가 발생했습니다.');
    } finally {
      setLoadingStats(false);
    }
  };

  const handleSort = (key: 'week' | 'month' | 'threeMonth' | 'year') => {
    if (sortKey === key) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const sortIcon = (key: 'week' | 'month' | 'threeMonth' | 'year') => {
    if (sortKey !== key) return '↕';
    return sortDir === 'asc' ? '↑' : '↓';
  };

  return (
    <div className="h-full overflow-hidden">
      <div className="p-6 flex h-full flex-col gap-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">시장 지수</h1>
            <p className="text-sm text-gray-500">최근 상승률 기준 업종·테마 순위를 함께 확인하세요.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-white p-1 text-xs shadow-sm">
              <button
                type="button"
                onClick={() => setPageTab('indices')}
                className={`rounded-full px-4 py-1.5 font-semibold ${
                  pageTab === 'indices'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-800'
                }`}
              >
                지수
              </button>
              <button
                type="button"
                onClick={() => setPageTab('leaders')}
                className={`rounded-full px-4 py-1.5 font-semibold ${
                  pageTab === 'leaders'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-800'
                }`}
              >
                오늘의 선도주
              </button>
            </div>
            <span className="hidden md:inline-block text-xs text-gray-400">
              탭을 눌러 화면을 전환하세요
            </span>
          </div>
        </div>

        {pageTab === 'indices' && (
          <div className="flex flex-1 gap-4 min-h-0">
          <div className="w-[30%] rounded-lg border border-gray-200 bg-white p-4 flex flex-col min-h-0">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-700">
                업종/테마 상승률 순위
              </div>
              {activeSelectionLabel && (
                <div className="text-xs text-blue-600">선택됨: {activeSelectionLabel}</div>
              )}
            </div>
            <div className="mt-3 flex flex-col gap-2 text-xs text-gray-600">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="accent-blue-600"
                  checked={minCountEnabled}
                  onChange={e => setMinCountEnabled(e.target.checked)}
                />
                구성 종목 10개 이하 제외
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="accent-blue-600"
                  checked={minMarcapEnabled}
                  onChange={e => setMinMarcapEnabled(e.target.checked)}
                />
                구성 종목 시가총액 합 200조 미만 제외
              </label>
              {(minCountEnabled || minMarcapEnabled) && loadingStats && (
                <div className="text-[11px] text-gray-400">필터 계산 중...</div>
              )}
              {(minCountEnabled || minMarcapEnabled) && statsError && (
                <div className="text-[11px] text-red-500">{statsError}</div>
              )}
            </div>

            <div className="mt-4 flex-1 min-h-0 overflow-y-auto">
              {loadingRanks && (
                <div className="text-sm text-gray-500">순위 계산 중...</div>
              )}
              {!loadingRanks && visibleRanks.length === 0 && (
                <div className="text-sm text-gray-500">표시할 데이터가 없습니다.</div>
              )}
              {!loadingRanks && visibleRanks.length > 0 && (
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-gray-400">
                      <th className="py-2 pr-2">순위</th>
                      <th className="py-2 pr-2">이름</th>
                      <th className="py-2 pr-2 text-right">
                        <button
                          className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-700"
                          onClick={() => handleSort('week')}
                        >
                          최근 1주 <span className="text-xs">{sortIcon('week')}</span>
                        </button>
                      </th>
                      <th className="py-2 pr-2 text-right">
                        <button
                          className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-700"
                          onClick={() => handleSort('month')}
                        >
                          최근 1달 <span className="text-xs">{sortIcon('month')}</span>
                        </button>
                      </th>
                      <th className="py-2 pr-2 text-right">
                        <button
                          className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-700"
                          onClick={() => handleSort('threeMonth')}
                        >
                          최근 3달 <span className="text-xs">{sortIcon('threeMonth')}</span>
                        </button>
                      </th>
                      <th className="py-2 pr-2 text-right">
                        <button
                          className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-700"
                          onClick={() => handleSort('year')}
                        >
                          최근 1년 <span className="text-xs">{sortIcon('year')}</span>
                        </button>
                      </th>
                      <th className="py-2 pr-2 text-right">최신 지수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRanks.map((row, idx) => {
                      const weekCls =
                        row.weekReturn !== null && row.weekReturn >= 0
                          ? 'text-green-600'
                          : 'text-red-600';
                      const monthCls =
                        row.monthReturn !== null && row.monthReturn >= 0
                          ? 'text-green-600'
                          : 'text-red-600';
                      const threeMonthCls =
                        row.threeMonthReturn !== null && row.threeMonthReturn >= 0
                          ? 'text-green-600'
                          : 'text-red-600';
                      const yearCls =
                        row.yearReturn !== null && row.yearReturn >= 0
                          ? 'text-green-600'
                          : 'text-red-600';
                      const isSelected =
                        selectedType === row.indexType && selectedCode === row.code;
                      return (
                        <tr
                          key={`${row.code}-${idx}`}
                          className={`border-b last:border-0 cursor-pointer hover:bg-gray-50 ${
                            isSelected ? 'bg-blue-50' : ''
                          }`}
                        onClick={() => handleSelect(row, row.indexType)}
                        >
                          <td className="py-2 pr-2">{idx + 1}</td>
                          <td className="py-2 pr-2">
                            <button
                              type="button"
                              className={`block w-full text-left text-blue-600 hover:underline ${
                                isSelected ? 'font-semibold' : ''
                              }`}
                              onClick={e => {
                                e.stopPropagation();
                              handleSelect(row, row.indexType);
                              }}
                              aria-pressed={isSelected}
                            >
                              {row.name}
                            </button>
                          </td>
                          <td className={`py-2 pr-2 text-right ${weekCls}`}>
                            {row.weekReturn !== null ? `${row.weekReturn.toFixed(2)}%` : '-'}
                          </td>
                          <td className={`py-2 pr-2 text-right ${monthCls}`}>
                            {row.monthReturn !== null ? `${row.monthReturn.toFixed(2)}%` : '-'}
                          </td>
                          <td className={`py-2 pr-2 text-right ${threeMonthCls}`}>
                            {row.threeMonthReturn !== null
                              ? `${row.threeMonthReturn.toFixed(2)}%`
                              : '-'}
                          </td>
                          <td className={`py-2 pr-2 text-right ${yearCls}`}>
                            {row.yearReturn !== null ? `${row.yearReturn.toFixed(2)}%` : '-'}
                          </td>
                          <td className="py-2 pr-2 text-right">
                            {row.lastValue !== null ? row.lastValue.toFixed(2) : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="w-[70%] rounded-lg border border-gray-200 bg-white p-4 flex flex-col min-h-0">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-700">
                  {viewMode === 'chart' ? '차트' : '구성 종목'}
                </div>
                <div className="text-xs text-gray-500">
                  {selectedName ? `${selectedName} (${selectedCode})` : '업종/테마를 선택하세요.'}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-full bg-gray-100 p-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setViewMode('chart')}
                    className={`rounded-full px-3 py-1 ${
                      viewMode === 'chart' ? 'bg-blue-600 text-white' : 'text-gray-600'
                    }`}
                  >
                    차트
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedCode && selectedType) {
                        loadConstituents(selectedType, selectedCode, selectedName);
                        return;
                      }
                      setViewMode('constituents');
                    }}
                    className={`rounded-full px-3 py-1 ${
                      viewMode === 'constituents'
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-600'
                    }`}
                  >
                    구성 종목
                  </button>
                </div>
                {viewMode === 'chart' && (
                  <div className="text-xs text-gray-500">전체 기간 표시</div>
                )}
                {viewMode === 'constituents' && (
                  <input
                    value={constituentsQuery}
                    onChange={e => setConstituentsQuery(e.target.value)}
                    placeholder="종목명 또는 코드 검색..."
                    className="w-full md:w-64 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                  />
                )}
              </div>
            </div>

            <div className="mt-4 flex-1 min-h-0">
              {viewMode === 'chart' && !selectedCode && (
                <div className="flex h-full items-center justify-center text-sm text-gray-500">
                  순위 테이블에서 업종/테마를 선택하세요.
                </div>
              )}
              {viewMode === 'chart' && selectedCode && loadingChart && (
                <div className="flex h-full items-center justify-center text-sm text-gray-500">
                  차트 로딩 중...
                </div>
              )}
              {viewMode === 'chart' && selectedCode && !loadingChart && chartRows.length === 0 && (
                <div className="flex h-full items-center justify-center text-sm text-gray-500">
                  표시할 데이터가 없습니다.
                </div>
              )}
              {viewMode === 'chart' && selectedCode && !loadingChart && chartRows.length > 0 && (
                <div className="h-full min-h-[320px]">
                  <IndexLineChart
                    data={chartRows.map(row => ({
                      time: row.date,
                      value: row.index_value
                    }))}
                    wmaPeriod={150}
                  />
                </div>
              )}
              {viewMode === 'constituents' && !selectedCode && (
                <div className="flex h-full items-center justify-center text-sm text-gray-500">
                  업종/테마 이름을 클릭하면 구성 종목이 표시됩니다.
                </div>
              )}
              {viewMode === 'constituents' && selectedCode && loadingConstituents && (
                <div className="flex h-full items-center justify-center text-sm text-gray-500">
                  구성 종목 로딩 중...
                </div>
              )}
              {viewMode === 'constituents' &&
                selectedCode &&
                !loadingConstituents &&
                constituentsError && (
                  <div className="flex h-full items-center justify-center text-sm text-red-500">
                    {constituentsError}
                  </div>
                )}
              {viewMode === 'constituents' &&
                selectedCode &&
                !loadingConstituents &&
                !constituentsError && (
                  <div className="h-full min-h-0 overflow-y-auto rounded-md border border-gray-100">
                    {filteredConstituents.length === 0 ? (
                      <div className="flex h-full items-center justify-center text-sm text-gray-500">
                        표시할 종목이 없습니다.
                      </div>
                    ) : (
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
                          {filteredConstituents.map((item, idx) => (
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
                    )}
                  </div>
                )}
            </div>
          </div>
        </div>
        )}

        {pageTab === 'leaders' && (
          <div className="flex-1 rounded-lg border border-gray-200 bg-white p-4 flex flex-col min-h-0">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-700">오늘의 선도주</div>
                <div className="text-xs text-gray-500">
                  {leaderDate ? `기준일: ${leaderDate}` : '데이터 없음'}
                </div>
                <div className="text-xs text-gray-400">
                  거래대금 상위 200, RS 지수 상위 500 종목 중 다음 계산식에 따라 순위를 메긴
                  페이지 입니다.
                </div>
                <div className="text-xs text-gray-400">
                  계산식: 1일 상승률 랭크×0.4 + 거래대금 랭크×0.4 + RS(가중치)×0.2
                </div>
              </div>
              <input
                value={leaderQuery}
                onChange={e => setLeaderQuery(e.target.value)}
                placeholder="종목명/코드 검색.."
                className="w-full md:w-64 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
              />
            </div>

            <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-gray-600">업종 Top 10</span>
                  {leaderTopGroups.topIndustries.length === 0 && (
                    <span className="text-gray-400">-</span>
                  )}
                  {leaderTopGroups.topIndustries.map(([name, count]) => (
                    <span
                      key={`ind-${name}`}
                      className="rounded-full bg-white px-2 py-0.5 text-gray-700 shadow-sm"
                    >
                      {name} ({count})
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-gray-600">테마 Top 10</span>
                  {leaderTopGroups.topThemes.length === 0 && (
                    <span className="text-gray-400">-</span>
                  )}
                  {leaderTopGroups.topThemes.map(([name, count]) => (
                    <span
                      key={`theme-${name}`}
                      className="rounded-full bg-white px-2 py-0.5 text-gray-700 shadow-sm"
                    >
                      {name} ({count})
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 flex-1 min-h-0 overflow-y-auto">
              {leaderLoading && (
                <div className="flex h-full items-center justify-center text-sm text-gray-500">
                  선도주 데이터 로딩 중..
                </div>
              )}
              {!leaderLoading && leaderError && (
                <div className="flex h-full items-center justify-center text-sm text-red-500">
                  {leaderError}
                </div>
              )}
              {!leaderLoading && !leaderError && filteredLeaders.length === 0 && (
                <div className="flex h-full items-center justify-center text-sm text-gray-500">
                  표시할 선도주 데이터가 없습니다.
                </div>
              )}
              {!leaderLoading && !leaderError && filteredLeaders.length > 0 && (
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-gray-400">
                      <th className="py-2 pr-2">순위</th>
                      <th className="py-2 pr-2 border-l border-gray-200 pl-3">종목명</th>
                      <th className="py-2 pr-2 border-l border-gray-200 pl-3">코드</th>
                      <th className="py-2 pr-2 text-right border-l border-gray-200 pl-3">
                        리더 점수
                      </th>
                      <th className="py-2 pr-2 text-right border-l border-gray-200 pl-3">
                        당일 수익률
                      </th>
                      <th className="py-2 pr-2 text-right border-l border-gray-200 pl-3">
                        RS
                      </th>
                      <th className="py-2 pr-2 text-right border-l border-gray-200 pl-3">
                        거래대금(억)
                      </th>
                      <th className="py-2 pr-2 border-l border-gray-200 pl-3">업종</th>
                      <th className="py-2 pr-2 border-l border-gray-200 pl-3">테마</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLeaders.map((row, idx) => {
                      const retCls =
                        row.ret_1d !== null && row.ret_1d >= 0
                          ? 'text-green-600'
                          : 'text-red-600';
                      return (
                        <tr key={`${row.code}-${idx}`} className="border-b last:border-0">
                          <td className="py-2 pr-2 text-gray-500">{idx + 1}</td>
                          <td className="py-2 pr-2 font-medium text-gray-800 border-l border-gray-200 pl-3">
                            {row.name}
                          </td>
                          <td className="py-2 pr-2 text-gray-600 border-l border-gray-200 pl-3">
                            {row.code}
                          </td>
                          <td className="py-2 pr-2 text-right text-gray-700 border-l border-gray-200 pl-3">
                            {row.leader_score.toFixed(1)}
                          </td>
                          <td
                            className={`py-2 pr-2 text-right border-l border-gray-200 pl-3 ${retCls}`}
                          >
                            {row.ret_1d.toFixed(2)}%
                          </td>
                          <td className="py-2 pr-2 text-right text-gray-700 border-l border-gray-200 pl-3">
                            {row.rank_rs}
                          </td>
                          <td className="py-2 pr-2 text-right text-gray-700 border-l border-gray-200 pl-3">
                            {formatTradingValue(row.trading_value)}
                          </td>
                          <td className="py-2 pr-2 text-gray-700 border-l border-gray-200 pl-3">
                            {row.industry || '-'}
                          </td>
                          <td className="py-2 pr-2 text-gray-700 border-l border-gray-200 pl-3">
                            {row.theme || '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

async function buildRanks(
  supabase: ReturnType<typeof createClientComponentClient>,
  indexType: IndexType,
  latestDate: string,
  options: IndexOption[]
) {
  const latest = new Date(latestDate);
  const weekStart = new Date(latest);
  weekStart.setDate(latest.getDate() - 7);
  const monthStart = new Date(latest);
  monthStart.setDate(latest.getDate() - 30);
  const threeMonthStart = new Date(latest);
  threeMonthStart.setDate(latest.getDate() - 90);
  const yearStart = new Date(latest);
  yearStart.setDate(latest.getDate() - 365);

  const weekStartStr = weekStart.toISOString().split('T')[0];
  const monthStartStr = monthStart.toISOString().split('T')[0];
  const threeMonthStartStr = threeMonthStart.toISOString().split('T')[0];
  const yearStartStr = yearStart.toISOString().split('T')[0];

  const data: { index_code: string; date: string; index_value: number }[] = [];
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data: page, error } = await supabase
      .from('equal_weight_indices')
      .select('index_code, date, index_value')
      .eq('index_type', indexType)
      .gte('date', yearStartStr)
      .lte('date', latestDate)
      .order('date', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error || !page || page.length === 0) break;
    data.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }

  if (data.length === 0) return [];

  const nameMap = new Map(options.map(item => [item.code, item.name]));
  const byCode = new Map<string, IndexRow[]>();

  data.forEach(row => {
    const code = row.index_code;
    const list = byCode.get(code) || [];
    list.push({ date: row.date, index_value: row.index_value });
    byCode.set(code, list);
  });

  const ranks: RankRow[] = [];
  byCode.forEach((list, code) => {
    list.sort((a, b) => a.date.localeCompare(b.date));
    const latestValue = list[list.length - 1]?.index_value ?? null;
    const weekSlice = list.filter(item => item.date >= weekStartStr);
    const monthSlice = list.filter(item => item.date >= monthStartStr);
    const threeMonthSlice = list.filter(item => item.date >= threeMonthStartStr);
    const yearSlice = list.filter(item => item.date >= yearStartStr);

    const weekFirst = weekSlice[0]?.index_value ?? null;
    const weekLast = weekSlice[weekSlice.length - 1]?.index_value ?? null;
    const monthFirst = monthSlice[0]?.index_value ?? null;
    const monthLast = monthSlice[monthSlice.length - 1]?.index_value ?? null;
    const threeMonthFirst = threeMonthSlice[0]?.index_value ?? null;
    const threeMonthLast = threeMonthSlice[threeMonthSlice.length - 1]?.index_value ?? null;
    const yearFirst = yearSlice[0]?.index_value ?? null;
    const yearLast = yearSlice[yearSlice.length - 1]?.index_value ?? null;

    ranks.push({
      indexType,
      code,
      name: nameMap.get(code) || code,
      lastValue: latestValue,
      weekReturn: buildReturn(weekFirst, weekLast),
      monthReturn: buildReturn(monthFirst, monthLast),
      threeMonthReturn: buildReturn(threeMonthFirst, threeMonthLast),
      yearReturn: buildReturn(yearFirst, yearLast)
    });
  });

  ranks.sort((a, b) => (b.weekReturn ?? -Infinity) - (a.weekReturn ?? -Infinity));
  return ranks;
}
