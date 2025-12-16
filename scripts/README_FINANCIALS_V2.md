# 재무 데이터 수집 시스템 v2

기존 네이버 데이터만 사용하던 방식에서 **DART API(실제 재무 분기별)** + **네이버(예측치 연간)**를 결합한 방식으로 개선

## 📋 개요

- **실제 발표 데이터**: DART API 사용 (2011년 Q1 ~ 2025년 Q3, 분기별)
- **향후 예측치**: 네이버 금융(WiseReport) 사용 (2026년 이후, 연간)
- **새 테이블**: `company_financials_v2` (기존 테이블과 분리하여 테스트)

## 🚀 사용 방법

### 1. DART API 키 발급

1. [DART 오픈 API 사이트](https://opendart.fss.or.kr/) 접속
2. 회원가입 후 로그인
3. **인증키 발급/관리** 메뉴에서 API 키 발급
4. `.env.local` 파일에 다음 내용 추가:

```bash
# DART API Key (https://opendart.fss.or.kr/)
DART_API_KEY=your_api_key_here
```

### 2. 데이터베이스 테이블 생성

```bash
# Supabase SQL Editor에서 실행
psql -f scripts/create_financials_v2_table.sql
```

또는 Supabase Dashboard > SQL Editor에서 `create_financials_v2_table.sql` 파일 내용 실행

### 3. 실제 재무 데이터 수집 (DART) - 분기별

```bash
python scripts/update_financials_dart.py
```

- 2011년 Q1 ~ 2025년 Q3까지 실제 발표된 재무제표 수집
- 분기별 데이터 (Q1, Q2, Q3, Q4)
- 연결재무제표 우선, 없으면 개별재무제표 사용
- `data_source='dart'`, `quarter=1~4`로 저장
- **주의**: 종목 수 × 연도 × 분기만큼 API 호출이 발생 (약 2000종목 × 15년 × 4분기 = 120,000회)

### 4. 예측치 수집 (네이버) - 연간

```bash
python scripts/update_financials_forecast.py
```

- 2026년 이후 예측 데이터 수집 (연간)
- `data_source='forecast'`, `quarter=0`으로 저장

## 📊 테이블 구조

```sql
company_financials_v2
├── company_code (종목코드)
├── year (회계연도)
├── quarter (분기: 1~4=분기별, 0=연간 예측치) ⭐
├── revenue (매출액, 억원) 💰
├── op_income (영업이익, 억원) 💰
├── net_income (당기순이익, 억원) 💰
├── assets (자산총계, 억원) 💰
├── equity (자본총계, 억원) 💰
├── shares_outstanding (발행주식수, 주)
├── data_source ('dart' 또는 'forecast') ⭐
├── is_consolidated (연결재무제표 여부)
└── PRIMARY KEY (company_code, year, quarter, data_source)
```

**⚠️ 중요: 모든 금액 데이터는 억원 단위로 저장됩니다**
- DART API: 백만원 → 억원 (÷ 100)
- 네이버: 이미 억원 단위

## 🔍 데이터 확인

```sql
-- 특정 종목의 분기별 실제 데이터와 연간 예측치 모두 조회
SELECT
    year,
    quarter,
    data_source,
    revenue as revenue_억원,
    op_income as op_income_억원
FROM company_financials_v2
WHERE company_code = '005930'  -- 삼성전자
ORDER BY year, quarter, data_source;

-- 특정 연도의 분기별 데이터만 조회
SELECT
    year,
    quarter,
    revenue as revenue_억원,
    op_income as op_income_억원,
    is_consolidated
FROM company_financials_v2
WHERE company_code = '005930' AND year = 2024 AND data_source = 'dart'
ORDER BY quarter;

-- 예측치만 조회 (quarter=0)
SELECT
    company_code,
    year,
    revenue as revenue_억원,
    op_income as op_income_억원
FROM company_financials_v2
WHERE data_source = 'forecast' AND quarter = 0
ORDER BY company_code, year;

-- 최근 4분기 데이터 조회 (예: 2024 Q4, 2025 Q1~Q3)
SELECT
    year,
    quarter,
    revenue as revenue_억원,
    op_income as op_income_억원
FROM company_financials_v2
WHERE company_code = '005930'
  AND data_source = 'dart'
  AND (year = 2024 OR year = 2025)
ORDER BY year, quarter;
```

## 📝 주의사항

1. **DART API 제한**
   - 일일 호출 횟수 제한 있음 (보통 10,000회)
   - 2011~2025년, 약 2000종목 × 15년 × 4분기 = **약 120,000회** API 호출 필요
   - **여러 날에 걸쳐 나눠서 실행** 권장
   - 스크립트 중단 시 이어서 실행 가능 (upsert 방식)

2. **데이터 품질**
   - 일부 종목은 DART에 등록되지 않음 (비상장, ETF 등)
   - 예측치는 증권사 컨센서스이므로 정확도 보장 안 됨
   - 분기별 데이터는 누적 실적임 (Q4는 연간 실적과 동일)

3. **기존 테이블과 분리**
   - `company_financials_v2`는 테스트용 새 테이블
   - 검증 후 기존 테이블(`company_financials`) 마이그레이션 고려

4. **실행 시간**
   - DART 수집: API 호출 간격 0.3초 × 120,000회 = 약 10시간
   - 네이버 수집: 크롤링 1초 × 2000종목 = 약 30분

## 🔄 애플리케이션 코드 수정

기존 코드에서 `company_financials_v2` 사용하도록 수정 필요:

```typescript
// Before
const { data } = await supabase
  .from('company_financials')
  .select('*')
  .eq('company_code', code);

// After - 분기별 실제 데이터와 연간 예측치 모두 가져오기
const { data } = await supabase
  .from('company_financials_v2')
  .select('*')
  .eq('company_code', code)
  .order('year', { ascending: true })
  .order('quarter', { ascending: true });

// 특정 연도 Q4 데이터만 (연간 실적)
const { data } = await supabase
  .from('company_financials_v2')
  .select('*')
  .eq('company_code', code)
  .eq('quarter', 4)
  .eq('data_source', 'dart')
  .order('year', { ascending: true });

// 연간 예측치만 (quarter=0)
const { data } = await supabase
  .from('company_financials_v2')
  .select('*')
  .eq('company_code', code)
  .eq('quarter', 0)
  .eq('data_source', 'forecast')
  .order('year', { ascending: true });
```

## 🎯 다음 단계

1. ⬜ 테이블 생성 (`create_financials_v2_table.sql`)
2. ⬜ DART 스크립트 실행 (여러 날 나눠서)
   - 일일 API 제한(10,000회)을 고려하여 약 50종목씩 실행 권장
   - 스크립트 수정: `companies = companies[0:50]`
3. ⬜ 네이버 예측치 스크립트 실행
4. ⬜ 데이터 검증 (위의 SQL 쿼리 사용)
5. ⬜ admin/MH/index 페이지를 `company_financials_v2` 사용하도록 수정
6. ⬜ 테스트 완료 후 기존 테이블 마이그레이션 고려

## 💡 분할 실행 팁

DART API 일일 제한(10,000회)을 고려한 실행 방법:

```python
# update_financials_dart.py 수정
# 매일 50개 종목씩 실행 (50종목 × 15년 × 4분기 = 3,000회)

# 1일차: 0~49
companies = companies[0:50]

# 2일차: 50~99
companies = companies[50:100]

# 3일차: 100~149
companies = companies[100:150]

# ... 약 40일에 걸쳐 전체 수집
```
