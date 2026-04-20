// src/utils/patternDetectors.ts
// 패턴 감지 엔진 — 새 패턴은 ALL_DETECTORS 배열에만 추가하면 됨

export type OHLCV = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type PatternResult = {
  id: string;
  label: string;   // 전체 이름 (툴팁 등)
  short: string;   // 짧은 뱃지 텍스트
  detected: boolean;
  meta?: Record<string, number>;  // 감지 시 조건별 수치 (패턴마다 정의)
};

export type PatternDetector = {
  id: string;
  label: string;
  short: string;
  minBars: number;
  detect: (data: OHLCV[]) => { detected: boolean; meta?: Record<string, number> };
};

// ─── 내부 헬퍼 ──────────────────────────────────────────────────────────────

function trailingSMA(closes: number[], period: number): number {
  if (closes.length < period) return NaN;
  let sum = 0;
  for (let i = closes.length - period; i < closes.length; i++) sum += closes[i];
  return sum / period;
}

// 일봉 → 주봉 집계 (날짜 없이 인덱스 기반, 5거래일 = 1주)
function toWeekly(daily: OHLCV[]): OHLCV[] {
  const weeks: OHLCV[] = [];
  for (let i = 0; i < daily.length; i += 5) {
    const slice = daily.slice(i, Math.min(i + 5, daily.length));
    if (slice.length === 0) continue;
    weeks.push({
      open: slice[0].open,
      high: Math.max(...slice.map((d) => d.high)),
      low: Math.min(...slice.map((d) => d.low)),
      close: slice[slice.length - 1].close,
      volume: slice.reduce((s, d) => s + d.volume, 0),
    });
  }
  return weeks;
}

// ─── V자 필터 ────────────────────────────────────────────────────────────────

const V_SHAPE = {
  bottomThresholdPct: 0.04, // 바닥 존 정의: 저점 대비 +4% 이내
  btr_hard: 0.08,           // bottomTimeRatio hard penalty threshold
  btr_soft: 0.15,           // bottomTimeRatio soft penalty threshold
  sym_hard: 0.25,           // symmetryTime hard penalty threshold
  sym_soft: 0.40,           // symmetryTime soft penalty threshold
  slope_hard: 0.30,         // slopeSymmetry hard penalty threshold
  slope_soft: 0.50,         // slopeSymmetry soft penalty threshold
};

/**
 * V자 형태 여부를 페널티 점수로 판단한다.
 * @returns isHardReject=true: 명백한 V자 → 해당 컵 후보 기각
 *          penalty: 0이면 완벽한 U자, 높을수록 V자에 가까움
 */
function vShapePenalty(
  cupData: OHLCV[],
  cupBottom: number,
): { penalty: number; isHardReject: boolean } {
  const cupLen = cupData.length;

  // 바닥 인덱스: 전체 컵에서 low가 가장 낮은 주
  let bIdx = 0;
  for (let i = 1; i < cupLen; i++) {
    if (cupData[i].low < cupData[bIdx].low) bIdx = i;
  }

  // [1] BottomTimeRatio — 바닥 zone에 머문 주 비율
  const bzPrice = cupBottom * (1 + V_SHAPE.bottomThresholdPct);
  let bzCount = 0;
  for (const bar of cupData) {
    if (bar.close <= bzPrice) bzCount++;
  }
  const btr = bzCount / cupLen;

  // [2] SymmetryTime — 좌측 하락 기간 vs 우측 회복 기간
  const lDur = bIdx;                    // B - L
  const rDur = (cupLen - 1) - bIdx;    // R - B
  const symTime =
    lDur > 0 && rDur > 0
      ? Math.min(lDur, rDur) / Math.max(lDur, rDur)
      : 0;

  // [3] SlopeSymmetry — 좌측 하락 속도 vs 우측 회복 속도
  const pL = cupData[0].close;
  const pB = cupBottom;
  const pR = cupData[cupLen - 1].close;
  const sL = (pL - pB) / Math.max(1, lDur);
  const sR = (pR - pB) / Math.max(1, rDur);
  const slopeSym =
    sL > 0 && sR > 0
      ? Math.min(sL, sR) / Math.max(sL, sR)
      : 0;

  // [4] CurvatureProxy (보조) — 바닥 중앙 기울기 vs 양끝 기울기
  let curvatureAdj = 0;
  const edgeLen = Math.max(1, Math.floor(cupLen / 5));
  if (cupLen >= edgeLen * 3) {
    const slopeAbs = (seg: OHLCV[]) =>
      seg.length > 1
        ? Math.abs(seg[seg.length - 1].close - seg[0].close) / (seg.length - 1)
        : 0;
    const edgeAvg =
      (slopeAbs(cupData.slice(0, edgeLen)) + slopeAbs(cupData.slice(-edgeLen))) / 2;
    const midSlope = slopeAbs(cupData.slice(edgeLen, cupLen - edgeLen));
    if (edgeAvg > 0) {
      const ratio = midSlope / edgeAvg;
      if (ratio < 0.5) curvatureAdj = -0.5; // 바닥이 평탄 → U자 보너스
      if (ratio > 1.5) curvatureAdj = +0.5; // 바닥이 가파름 → V자 페널티
    }
  }

  // [5] 페널티 합산
  let penalty = curvatureAdj;
  let bigHits = 0;

  if (btr < V_SHAPE.btr_hard) { penalty += 2; bigHits++; }
  else if (btr < V_SHAPE.btr_soft) { penalty += 1; }

  if (symTime < V_SHAPE.sym_hard) { penalty += 2; bigHits++; }
  else if (symTime < V_SHAPE.sym_soft) { penalty += 1; }

  if (slopeSym < V_SHAPE.slope_hard) { penalty += 2; bigHits++; }
  else if (slopeSym < V_SHAPE.slope_soft) { penalty += 1; }

  // 세 지표가 동시에 나쁘거나 누적 페널티가 5 이상이면 명백한 V자
  return {
    penalty,
    isHardReject: bigHits >= 3 || penalty >= 5,
  };
}

// ─── 컵앤핸들 (William O'Neil) ───────────────────────────────────────────────
// 기준 (주봉 기준):
//  1. 컵 기간: 7~65주
//  2. 컵 깊이: 12~33%
//  3. 컵 왼쪽 이전에 30% 이상 선행 상승
//  4. 오른쪽 고점이 왼쪽 고점의 85% 이상 회복
//  5. 핸들: 조정폭 < 15%, 컵 하단 중간선 위 유지
//  6. 현재가가 핸들 고점 92% 이상 (돌파 직전)
//  7. V자 필터: BottomTimeRatio / SymmetryTime / SlopeSymmetry 페널티 기반
function detectCupAndHandle(data: OHLCV[]): { detected: boolean; meta?: Record<string, number> } {
  const weekly = toWeekly(data);
  const n = weekly.length;

  // 최소: 선행 구간 7주 + 컵 최소 7주 + 핸들 1주 = 15주
  if (n < 15) return { detected: false };

  // 핸들: 최근 1~6주 탐색
  for (let handleLen = 1; handleLen <= Math.min(6, n - 14); handleLen++) {
    const handleData = weekly.slice(-handleLen);
    const handleLow = Math.min(...handleData.map((d) => d.low));
    const handleHigh = Math.max(...handleData.map((d) => d.high));

    // 현재가가 핸들 고점 92% 이상 (돌파 직전)
    const current = weekly[n - 1].close;
    if (current < handleHigh * 0.92) continue;

    // 핸들 가격 하락: 1주면 음봉, 2주 이상이면 마지막 종가 < 첫 종가
    if (handleLen === 1) {
      if (handleData[0].close >= handleData[0].open) continue;
    } else {
      if (handleData[handleLen - 1].close >= handleData[0].close) continue;
    }

    // 거래량 증가 없음: 핸들 평균 거래량 <= 핸들 직전 5주 평균 × 1.1
    const preHandleData = weekly.slice(-(handleLen + 5), -handleLen);
    if (preHandleData.length >= 3) {
      const handleAvgVol = handleData.reduce((s, d) => s + d.volume, 0) / handleData.length;
      const preAvgVol = preHandleData.reduce((s, d) => s + d.volume, 0) / preHandleData.length;
      if (handleAvgVol > preAvgVol * 1.1) continue;
    }

    // 10주 이동평균선 위: 핸들 저점 >= 핸들 이전 기준 10주 MA
    const ma10Window = weekly.slice(0, n - handleLen);
    if (ma10Window.length >= 10) {
      const ma10 = ma10Window.slice(-10).reduce((s, d) => s + d.close, 0) / 10;
      if (handleLow < ma10) continue;
    }

    // 컵: 7~65주 탐색
    const cupEnd = n - handleLen;
    const maxCupLen = Math.min(65, cupEnd - 7); // 선행 구간 최소 7주 확보

    if (maxCupLen < 7) continue;

    for (let cupLen = 7; cupLen <= maxCupLen; cupLen++) {
      const cupStart = cupEnd - cupLen;
      const cupData = weekly.slice(cupStart, cupEnd);
      const priorData = weekly.slice(0, cupStart);

      if (priorData.length < 7) continue;

      // 컵 구조: 왼쪽 1/3 / 바닥 1/3 / 오른쪽 1/3
      const third = Math.max(1, Math.floor(cupLen / 3));
      const leftSide = cupData.slice(0, third);
      const midSide = cupData.slice(third, cupLen - third);
      const rightSide = cupData.slice(cupLen - third);

      if (leftSide.length < 1 || midSide.length < 1 || rightSide.length < 1) continue;

      const leftRim = Math.max(...leftSide.map((d) => d.high));
      const cupBottom = Math.min(...midSide.map((d) => d.low));
      const rightRim = Math.max(...rightSide.map((d) => d.high));

      // 컵 깊이: 12~33%
      const depth = (leftRim - cupBottom) / leftRim;
      if (depth < 0.12 || depth > 0.5) continue;

      // 중간부(바닥 구간) 전체가 림보다 충분히 낮아야 함
      // 중간부 최고 고가가 leftRim * (1 - depth * 0.40) 이하여야 컵 모양 성립
      // 예) 깊이 20% → 중간부 고가가 림 대비 8% 이상 낮아야 함
      //     깊이 33% → 중간부 고가가 림 대비 13% 이상 낮아야 함
      const midHighMax = Math.max(...midSide.map((d) => d.high));
      if (midHighMax > leftRim * (1 - depth * 0.40)) continue;

      // 오른쪽 고점이 왼쪽 고점의 80~110% 사이
      if (rightRim < leftRim * 0.80 || rightRim > leftRim * 1.10) continue;

      // 핸들 하락 조건:
      //  [최소] 우측 림 대비 5% 이상 하락해야 핸들로 인정 (너무 얕은 조정은 제외)
      //  [최대] 컵 깊이의 1/3 이내 하락만 허용 (너무 깊은 조정은 핸들이 아님)
      const cupDepthPrice = leftRim - cupBottom;          // 컵 깊이 (가격 기준)
      const maxHandleDrop = cupDepthPrice / 3;            // 허용 최대 하락폭
      if (rightRim <= 0) continue;
      if (handleLow > rightRim * 0.95) continue;          // 최소 5% 하락 미충족
      if (handleLow < rightRim - maxHandleDrop) continue; // 컵 깊이 1/3 초과 하락

      // 핸들이 컵 하단 중간선 위 유지
      const cupMidPrice = cupBottom + (leftRim - cupBottom) * 0.50;
      if (handleLow < cupMidPrice) continue;

      // 선행 상승: 컵 왼쪽 rim이 선행 구간 저점 대비 30% 이상 상승
      const priorLow = Math.min(...priorData.map((d) => d.low));
      if (priorLow <= 0) continue;
      if ((leftRim - priorLow) / priorLow < 0.30) continue;

      // V자 필터
      const vShape = vShapePenalty(cupData, cupBottom);
      if (vShape.isHardReject) continue;

      return {
        detected: true,
        meta: {
          priorGain:      (leftRim - priorLow) / priorLow,
          cupWeeks:       cupLen,
          cupDepth:       depth,
          rightRimRatio:  rightRim / leftRim,
          vPenalty:       vShape.penalty,
          handleWeeks:    handleLen,
          handleDrop:     rightRim > 0 ? (rightRim - handleLow) / rightRim : 0,
        },
      };
    }
  }

  return { detected: false };
}

// ─── 트렌드 템플레이트 (Mark Minervini) ────────────────────────────────────
// 기준 (일봉 기준):
//  1. 현재가 > SMA150 & SMA200
//  2. SMA150 > SMA200
//  3. SMA200이 20봉 이상 우상향 (기울기 > 0)
//  4. SMA50 > SMA150 & SMA200
//  5. 현재가 > SMA50
//  6. 현재가 >= 52주 저점(250봉) × 130%
//  7. 현재가 >= 52주 고점(250봉) × 75%
function detectTrendTemplate(data: OHLCV[]): { detected: boolean; meta?: Record<string, number> } {
  const n = data.length;
  if (n < 200) return { detected: false };

  const closes = data.map((d) => d.close);
  const current = closes[n - 1];

  const ma50  = trailingSMA(closes, 50);
  const ma150 = trailingSMA(closes, 150);
  const ma200 = trailingSMA(closes, 200);

  if (isNaN(ma50) || isNaN(ma150) || isNaN(ma200)) return { detected: false };

  // 1. 현재가 > SMA150 & SMA200
  if (current <= ma150 || current <= ma200) return { detected: false };

  // 2. SMA150 > SMA200
  if (ma150 <= ma200) return { detected: false };

  // 3. SMA200이 20봉 이상 우상향
  const ma200prev = trailingSMA(closes.slice(0, n - 20), 200);
  if (isNaN(ma200prev) || ma200 <= ma200prev) return { detected: false };

  // 4. SMA50 > SMA150 & SMA200
  if (ma50 <= ma150 || ma50 <= ma200) return { detected: false };

  // 5. 현재가 > SMA50
  if (current <= ma50) return { detected: false };

  // 52주 = 250거래일 (데이터 부족 시 전체 사용)
  const yearData = data.slice(-250);
  const yearLow  = Math.min(...yearData.map((d) => d.low));
  const yearHigh = Math.max(...yearData.map((d) => d.high));

  // 6. 현재가 >= 52주 저점 × 130%
  if (current < yearLow * 1.30) return { detected: false };

  // 7. 현재가 >= 52주 고점 × 75%
  if (current < yearHigh * 0.75) return { detected: false };

  return {
    detected: true,
    meta: {
      ma50,
      ma150,
      ma200,
      ma200Slope: ma200 - ma200prev,
      distFromYearLow:  (current - yearLow)  / yearLow,
      distFromYearHigh: (current - yearHigh) / yearHigh,
    },
  };
}

// ─── VCP (Mark Minervini) ────────────────────────────────────────────────────
// 기준 (일봉 기준):
//  1. 2T ~ 6T: 스윙 고점 → 저점을 1사이클(T)로 계산
//  2. 첫 번째 T: 고점 대비 20~50% 하락
//  3. 각 T의 조정폭(depth)이 이전 T보다 작음 (수축)
//  4. 각 T의 저점 >= 직전 T 저점 × 95% (higher lows, 최대 5% 이내 하락)
//  5. 현재가가 VCP 시작 고점의 85%~105% 범위
//  6. ATR%: 각 T 구간의 평균 변동성이 우측으로 갈수록 감소
//  7. 거래량 수축: 현재 거래량 < 50일 평균 거래량
//  8. 마지막 저점이 최근 40일 이내, 현재가 > 마지막 저점
function detectVCP(data: OHLCV[]): { detected: boolean; meta?: Record<string, number> } {
  // data[n-1]이 최신봉. 최근 325 거래일(약 65주)만 잘라 쓴다.
  // 너무 오래된 구간까지 보면 이미 끝난 VCP가 재감지될 수 있기 때문.
  const daily = data.slice(-325);
  const n = daily.length;
  if (n < 60) return { detected: false };

  // SW = 5: 스윙 고점/저점을 인정하려면 양쪽으로 5봉이 모두 낮아야(높아야) 한다.
  // 일봉 노이즈를 걸러내기 위해 주봉(SW=3)보다 넓게 잡는다.
  const SW = 5;


  // ── 50일 평균 거래량 ──────────────────────────────────────────────────────
  // 거래량 수축 판단 기준선. 단일 봉이 아닌 최근 5일 평균과 비교한다.
  // → 뉴스·리밸런싱 등 단발성 거래량 급증으로 패턴이 탈락하는 것을 방지.
  const vol50 = daily.slice(-50).reduce((s, d) => s + d.volume, 0) / 50;
  const recentAvgVol = daily.slice(-5).reduce((s, d) => s + d.volume, 0) / 5;

  // ── 스윙 고점 / 저점 탐지 ────────────────────────────────────────────────
  // i 기준으로 앞뒤 SW봉을 전부 확인한다.
  //   isHi: 앞뒤 5봉 중 어느 봉의 high도 i봉 high보다 "엄격히 높은" 봉이 없어야 고점
  //   isLo: 앞뒤 5봉 중 어느 봉의 low도 i봉 low보다 "엄격히 낮은" 봉이 없어야 저점
  // ※ 부등호를 >= / <= 대신 > / < 로 완화: 동일 고가·저가(상한가 연속 등)가 나와도
  //   스윙으로 인정한다. 연속 동점은 alt 교대 정리 단계에서 가장 극단값 하나로 압축됨.
  // 양쪽 SW봉이 필요하므로 탐지 가능 범위는 [SW, n-SW-1].
  type Swing = { idx: number; price: number; isHigh: boolean };
  const swings: Swing[] = [];

  for (let i = SW; i < n - SW; i++) {
    let isHi = true, isLo = true;
    for (let j = 1; j <= SW; j++) {
      if (daily[i - j].high > daily[i].high || daily[i + j].high > daily[i].high) isHi = false;
      if (daily[i - j].low  < daily[i].low  || daily[i + j].low  < daily[i].low)  isLo = false;
    }
    if (isHi) swings.push({ idx: i, price: daily[i].high, isHigh: true });
    else if (isLo) swings.push({ idx: i, price: daily[i].low,  isHigh: false });
  }

  // ── 교대 시퀀스 정리 ─────────────────────────────────────────────────────
  // raw swings에는 고점-고점, 저점-저점이 연속으로 나올 수 있다.
  // 예) H1 H2(더 높음) → alt에는 H2만 남긴다 (더 극단적인 값 우선).
  // 결과: H → L → H → L → ... 교대 배열이 된다.
  const alt: Swing[] = [];
  for (const pt of swings) {
    if (alt.length === 0) { alt.push(pt); continue; }
    const last = alt[alt.length - 1];
    if (last.isHigh === pt.isHigh) {
      // 같은 타입이면 더 극단적인 값으로 교체
      if (pt.isHigh ? pt.price > last.price : pt.price < last.price) {
        alt[alt.length - 1] = pt;
      }
    } else {
      alt.push(pt);
    }
  }

  const current = daily[n - 1].close;

  // ── VCP 시작점: 52주 최고가에 해당하는 스윙 고점을 앵커로 고정 ─────────────
  // 컵핸들의 left rim 방식과 동일: 패턴 시작은 해당 기간 최고가여야 한다.
  // 낮은 스윙 고점에서 시작하면 피벗도 낮게 잡히는 문제를 방지한다.
  const yearHigh = Math.max(...daily.slice(-250).map((d) => d.high));

  // alt에서 52주 최고가의 93% 이상인 스윙 고점 중 가장 오래된 것을 시작점으로 선택
  // (더블탑처럼 비슷한 고점이 여럿 있을 때 첫 번째가 패턴의 실질적 시작)
  // ※ 임계값 변경 이력:
  //   0.97 → 0.90: 급등 꼬리(wick)로 만들어진 52주 고점이 SW=5를 통과 못해 앵커 누락
  //   0.90 → 0.93: 0.90은 너무 낮아 패턴 시작점보다 훨씬 이른/낮은 고점이 앵커가 되는 오탐 유발.
  //                실질적인 wick 허용 범위는 ±7% 이내이므로 0.93이 적절한 절충값.
  let anchorIdx = -1;
  for (let s = 0; s < alt.length; s++) {
    if (alt[s].isHigh && alt[s].price >= yearHigh * 0.93) {
      anchorIdx = s;
      break;
    }
  }
  if (anchorIdx === -1) return { detected: false };

  // ── 앵커부터 H→L 쌍(T) 수집 ─────────────────────────────────────────────
  // 컵핸들과 달리 루프 없이 단일 시작점에서만 탐색한다.
  const depths: number[]     = []; // 각 T의 조정폭 (고점 대비 하락률)
  const highPrices: number[] = []; // 각 T의 고점 가격
  const lowPrices: number[]  = []; // 각 T의 저점 가격
  const highIdxs: number[]   = []; // 각 T의 고점 인덱스
  const lowIdxs: number[]    = []; // 각 T의 저점 인덱스
  let i = anchorIdx;

  // alt[i]=고점, alt[i+1]=저점 쌍을 순서대로 수집.
  // 쌍이 깨지면(고점 다음이 고점이면) 중단.
  while (i + 1 < alt.length && depths.length < 6) {
    if (!alt[i].isHigh || alt[i + 1].isHigh) break;
    const h = alt[i].price;
    const l = alt[i + 1].price;
    depths.push((h - l) / h);  // 조정폭 = (고점 - 저점) / 고점
    highPrices.push(h);
    lowPrices.push(l);
    highIdxs.push(alt[i].idx);
    lowIdxs.push(alt[i + 1].idx);
    i += 2; // 다음 H→L 쌍으로 이동
  }

  const t = depths.length;
  if (t < 2 || t > 6) return { detected: false };

  // ── T-독립 사전 체크 (tCand에 관계없이 항상 동일한 조건) ──────────────────

  // [1] 첫 번째 T 조정폭: 20~50%
  // 20% 미만이면 의미 있는 조정이 아닌 노이즈,
  // 50% 초과면 VCP가 아닌 대형 붕괴로 본다.
  if (depths[0] < 0.20 || depths[0] > 0.50) return { detected: false };

  // [4] 현재가가 VCP 시작 고점(첫 T 고점 ≈ 52주 고점)의 85%~105%
  // 85% 미만: 주가가 너무 많이 빠져 VCP 범위를 벗어남.
  // 105% 초과: 이미 돌파해버린 상태라 감지 시점이 지남.
  // ※ startPrice는 항상 highPrices[0]이므로 tCand와 무관하게 공통 적용.
  const startPrice = highPrices[0];
  if (current < startPrice * 0.85 || current > startPrice * 1.05) return { detected: false };

  // [5] 거래량 수축: 최근 5일 평균 거래량 < 50일 평균 거래량
  // ※ 단일 봉이 아닌 5일 평균으로 비교: 뉴스·옵션만기 등 단발성 거래량 급증이
  //   있는 날에도 패턴이 유지된다. 50일 평균 대비 최근 5일이 적어야 "dry-up" 확인.
  if (recentAvgVol >= vol50) return { detected: false };

  // ── fallback 루프: 수집된 T 개수부터 시작해 2T까지 재시도 ──────────────────
  // T 수가 많을수록 더 강한 수축 패턴이므로 최대 T부터 검증한다.
  // 마지막 T 하나가 조건을 약간 벗어난 경우, 그 T를 제외한 직전 패턴을 인정.
  // (예: 3T 수집 → 3T 검증 실패 → 2T 재검증 → 통과 시 tCount=2로 반환)
  for (let tCand = t; tCand >= 2; tCand--) {

    // [2] 조정폭 수축 (5% 여유 허용)
    // ※ 완전 엄격(depths[k] >= depths[k-1]) 대신 5% 이내 역전은 허용한다.
    // T2 12.0% → T3 12.3% 같은 미세 노이즈를 실질적 수축 패턴으로 인정.
    // 5% 초과 역전은 진짜 수축 실패로 보고 기각.
    let valid = true;
    for (let k = 1; k < tCand; k++) {
      if (depths[k] > depths[k - 1] * 1.05) { valid = false; break; }
    }
    if (!valid) continue;

    // [3] Higher lows: 각 T 저점 >= 직전 T 저점 × 92%
    // 저점이 직전 저점보다 8% 넘게 낮아지면 기각.
    // ※ 기존 95%(5% 허용) → 92%(8% 허용)로 완화: 변동성이 큰 종목에서 저점이
    //   소폭 더 낮아지는 케이스도 실질적 VCP로 인정. 10% 초과는 추세 붕괴로 본다.
    for (let k = 1; k < tCand; k++) {
      if (lowPrices[k] < lowPrices[k - 1] * 0.92) { valid = false; break; }
    }
    if (!valid) continue;

    // [6] 시의성: 마지막 저점(tCand 기준)이 최근 40일 이내
    // SW=5 특성상 감지 가능한 최신 저점은 n-6봉. 여기서 40일 이내면 진행 중으로 판단.
    // ※ tCand가 줄면 더 이른 저점을 보게 되어 조건이 느슨해짐 — 의도된 동작.
    if (n - 1 - lowIdxs[tCand - 1] > 40) continue;

    // [7] 회복 중: 현재가 > 마지막 저점(tCand 기준)
    // 아직 바닥을 벗어나지 못했다면 감지하지 않는다.
    if (current <= lowPrices[tCand - 1]) continue;

    // 마지막 T의 고점 = 돌파 피벗 (이 가격을 넘으면 breakout)
    const pivotHigh = highPrices[tCand - 1];

    // [8] 피벗 고점 대비 5% 이상 상승한 경우 이미 돌파한 것으로 보고 제외
    if (current > pivotHigh * 1.05) continue;

    // ── 모든 조건 통과 → 패턴 확정 ──────────────────────────────────────────
    return {
      detected: true,
      meta: {
        tCount:        tCand,
        t1Depth:       depths[0],
        lastDepth:     depths[tCand - 1],
        pivotHigh,
        distFromPivot: (pivotHigh - current) / pivotHigh, // 피벗까지 남은 거리
        volRatio:      recentAvgVol / vol50,               // 1 미만이면 거래량 수축 중 (5일 평균 기준)
        patternDays:   lowIdxs[tCand - 1] - highIdxs[0],  // 패턴 기간(거래일)
      },
    };
  }

  return { detected: false };
}

// ─── 스퀘어 박스 (William O'Neil) ────────────────────────────────────────────
// 기준 (주봉 기준):
//  1. 선행 상승: 박스 직전 10주 저점 대비 박스 고점이 20% 이상 상승
//  2. 박스 기간: 3~6주
//  3. 박스 깊이: (고점 - 저점) / 저점 < 15%
//  4. 현재가가 박스 고점의 95% 이상 (돌파 직전)
//  5. 거래량 수축: 박스 평균 거래량 <= 직전 5주 평균
function detectSquareBox(data: OHLCV[]): { detected: boolean; meta?: Record<string, number> } {
  const weekly = toWeekly(data);
  const n = weekly.length;

  // 최소: 선행 구간 5주 + 박스 최소 3주 = 8주
  if (n < 8) return { detected: false };

  const current = weekly[n - 1].close;

  for (let boxLen = 3; boxLen <= Math.min(6, n - 5); boxLen++) {
    const boxData = weekly.slice(-boxLen);
    const boxHigh = Math.max(...boxData.map((d) => d.high));
    const boxLow  = Math.min(...boxData.map((d) => d.low));

    // 박스 깊이: < 15%
    const depth = (boxHigh - boxLow) / boxLow;
    if (depth >= 0.15) continue;

    // 현재가가 박스 고점 95% 이상 (돌파 직전)
    if (current < boxHigh * 0.95) continue;

    // 선행 상승: 박스 직전 10주 저점 대비 박스 고점 20% 이상
    const priorWindow = weekly.slice(Math.max(0, n - boxLen - 10), n - boxLen);
    if (priorWindow.length < 3) continue;
    const priorLow = Math.min(...priorWindow.map((d) => d.low));
    if (priorLow <= 0 || (boxHigh - priorLow) / priorLow < 0.20) continue;

    // 거래량 수축: 박스 평균 <= 직전 5주 평균
    const preBoxData = weekly.slice(-(boxLen + 5), -boxLen);
    if (preBoxData.length >= 3) {
      const boxAvgVol = boxData.reduce((s, d) => s + d.volume, 0) / boxData.length;
      const preAvgVol = preBoxData.reduce((s, d) => s + d.volume, 0) / preBoxData.length;
      if (boxAvgVol > preAvgVol) continue;
    }

    return {
      detected: true,
      meta: {
        boxWeeks:        boxLen,
        boxDepth:        depth,
        priorGain:       (boxHigh - priorLow) / priorLow,
        distFromBoxHigh: (boxHigh - current) / boxHigh,
      },
    };
  }

  return { detected: false };
}

// ─── 하이 타이트 플래그 (William O'Neil) ─────────────────────────────────────
// 기준 (주봉 기준):
//  1. 폴(Pole): 4~8주 내 100% 이상 급등
//  2. 플래그: 3~5주 동안 폴 고점 대비 10~25% 조정 (하락 방향)
//  3. 플래그 평균 거래량 < 폴 평균 거래량
//  4. 현재가가 플래그 고점의 90% 이상 (돌파 직전)
function detectHighTightFlag(data: OHLCV[]): { detected: boolean; meta?: Record<string, number> } {
  const weekly = toWeekly(data);
  const n = weekly.length;

  // 최소: 폴 최소 4주 + 플래그 최소 3주 = 7주
  if (n < 7) return { detected: false };

  const current = weekly[n - 1].close;

  for (let flagLen = 3; flagLen <= Math.min(5, n - 4); flagLen++) {
    const flagData = weekly.slice(-flagLen);
    const flagHigh = Math.max(...flagData.map((d) => d.high));
    const flagLow  = Math.min(...flagData.map((d) => d.low));

    // 플래그는 하락 방향이어야 함: 마지막 종가 < 첫 시가
    if (flagData[flagLen - 1].close >= flagData[0].open) continue;

    // 현재가가 플래그 고점 90% 이상
    if (current < flagHigh * 0.90) continue;

    for (let poleLen = 4; poleLen <= Math.min(8, n - flagLen); poleLen++) {
      const poleData = weekly.slice(n - flagLen - poleLen, n - flagLen);
      if (poleData.length < 4) continue;

      const poleStartPrice = poleData[0].open;
      const poleHigh = Math.max(...poleData.map((d) => d.high));

      if (poleStartPrice <= 0) continue;

      // 폴 상승: 100% 이상
      const poleGain = (poleHigh - poleStartPrice) / poleStartPrice;
      if (poleGain < 1.0) continue;

      // 플래그 조정폭: 10~25% (폴 고점 대비)
      const flagDrop = (poleHigh - flagLow) / poleHigh;
      if (flagDrop < 0.10 || flagDrop > 0.25) continue;

      // 거래량 수축: 플래그 평균 < 폴 평균
      const flagAvgVol = flagData.reduce((s, d) => s + d.volume, 0) / flagData.length;
      const poleAvgVol = poleData.reduce((s, d) => s + d.volume, 0) / poleData.length;
      if (flagAvgVol >= poleAvgVol) continue;

      return {
        detected: true,
        meta: {
          poleWeeks:        poleLen,
          poleGain,
          flagWeeks:        flagLen,
          flagDrop,
          volRatio:         flagAvgVol / poleAvgVol,   // 1 미만이면 거래량 수축 중
          distFromFlagHigh: (flagHigh - current) / flagHigh,
        },
      };
    }
  }

  return { detected: false };
}

// ─── 패턴 레지스트리 ─────────────────────────────────────────────────────────
// 새 패턴을 추가할 때는 이 배열에만 넣으면 됨

export const CUP_HANDLE_DETECTOR: PatternDetector = {
  id: 'cup_handle',
  label: '컵앤핸들',
  short: 'C&H',
  minBars: 75,   // 15주 × 5거래일 (선행7주 + 컵최소7주 + 핸들1주)
  detect: detectCupAndHandle,
};

export const TREND_TEMPLATE_DETECTOR: PatternDetector = {
  id: 'trend_template',
  label: '트렌드 템플레이트',
  short: 'TT',
  minBars: 250,
  detect: detectTrendTemplate,
};

export const VCP_DETECTOR: PatternDetector = {
  id: 'vcp',
  label: 'VCP',
  short: 'VCP',
  minBars: 100,   // ~20주 (2T 최소 구성 여유)
  detect: detectVCP,
};

export const SQUARE_BOX_DETECTOR: PatternDetector = {
  id: 'square_box',
  label: '스퀘어 박스',
  short: 'SB',
  minBars: 40,   // 8주 × 5거래일
  detect: detectSquareBox,
};

export const HIGH_TIGHT_FLAG_DETECTOR: PatternDetector = {
  id: 'high_tight_flag',
  label: '하이 타이트 플래그',
  short: 'HTF',
  minBars: 35,   // 7주 × 5거래일
  detect: detectHighTightFlag,
};

export const ALL_DETECTORS: PatternDetector[] = [
  CUP_HANDLE_DETECTOR,
  TREND_TEMPLATE_DETECTOR,
  VCP_DETECTOR,
  SQUARE_BOX_DETECTOR,
  HIGH_TIGHT_FLAG_DETECTOR,
];

// ─── 공개 API ────────────────────────────────────────────────────────────────

/**
 * 지정한 OHLCV 배열(시간순, 오래된 것 먼저)에 대해 모든 패턴 감지기를 실행한다.
 * @param data  시간순 OHLCV 배열 (data[n-1]이 최신봉)
 * @param detectors  실행할 감지기 목록 (기본값: ALL_DETECTORS)
 */
export function runDetectors(
  data: OHLCV[],
  detectors: PatternDetector[] = ALL_DETECTORS
): PatternResult[] {
  return detectors.map((d) => {
    if (data.length < d.minBars) {
      return { id: d.id, label: d.label, short: d.short, detected: false };
    }
    const { detected, meta } = d.detect(data);
    return { id: d.id, label: d.label, short: d.short, detected, meta };
  });
}
