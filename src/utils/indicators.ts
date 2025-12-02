// src/utils/indicators.ts

// SMA 계산
export const calculateSMA = (data: any[], count: number) => {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < count - 1) {
      result.push(NaN);
      continue;
    }
    let sum = 0;
    for (let j = 0; j < count; j++) {
      sum += data[i - j].close;
    }
    result.push(sum / count);
  }
  return result;
};

// EMA 계산
export const calculateEMA = (data: any[], count: number) => {
  const result: number[] = [];
  const k = 2 / (count + 1);
  
  let initialSum = 0;
  for(let i=0; i<count; i++) initialSum += data[i].close;
  let prevEma = initialSum / count;
  
  for(let i=0; i<count-1; i++) result.push(NaN);
  result.push(prevEma);

  for (let i = count; i < data.length; i++) {
    const close = data[i].close;
    const ema = close * k + prevEma * (1 - k);
    result.push(ema);
    prevEma = ema;
  }
  return result;
};

// WMA 계산
export const calculateWMA = (data: any[], count: number) => {
  const result: number[] = [];
  const denominator = (count * (count + 1)) / 2;

  for (let i = 0; i < data.length; i++) {
    if (i < count - 1) {
      result.push(NaN);
      continue;
    }
    
    let numerator = 0;
    for (let j = 0; j < count; j++) {
      numerator += data[i - j].close * (count - j);
    }
    result.push(numerator / denominator);
  }
  return result;
};

// ATR 계산 (내부용)
const calculateATR = (data: any[], period: number) => {
  const trs = [0];
  for(let i=1; i<data.length; i++) {
    const high = data[i].high;
    const low = data[i].low;
    const prevClose = data[i-1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
  }

  const result: number[] = [];
  for(let i=0; i<data.length; i++) {
    if(i < period - 1) {
      result.push(NaN);
      continue;
    }
    let sum = 0;
    for(let j=0; j<period; j++) sum += trs[i-j];
    result.push(sum / period);
  }
  return result;
};

// 켈트너 채널
export const calculateKeltner = (data: any[], period = 20, multiplier = 2.25) => {
  const ema = calculateEMA(data, period);
  const atr = calculateATR(data, 10); 

  return data.map((_, i) => {
    // 하나라도 NaN이면 전체 NaN 처리
    if (isNaN(ema[i]) || isNaN(atr[i])) return { upper: NaN, lower: NaN, middle: NaN };
    return {
      middle: ema[i],
      upper: ema[i] + atr[i] * multiplier,
      lower: ema[i] - atr[i] * multiplier,
    };
  });
};

// MACD 계산 (빨간 줄 해결)
export const calculateMACD = (data: any[], fast = 3, slow = 10, signal = 16) => {
  const fastEMA = calculateEMA(data, fast);
  const slowEMA = calculateEMA(data, slow);
  
  const macdLine = fastEMA.map((val, i) => val - slowEMA[i]);
  
  const signalLine: number[] = []; // 명시적 타입 선언
  const k = 2 / (signal + 1);
  
  let startIdx = 0;
  while(startIdx < macdLine.length && isNaN(macdLine[startIdx])) startIdx++;
  startIdx += signal; 

  // signal 계산 전까지는 NaN으로 채움
  for(let i=0; i<startIdx; i++) signalLine.push(NaN);

  if (startIdx < macdLine.length) {
      let sum = 0;
      for(let i=startIdx-signal; i<startIdx; i++) sum += macdLine[i];
      let prevSignal = sum / signal;
      signalLine.push(prevSignal); // startIdx 위치에 값 넣기

      for(let i=startIdx + 1; i<data.length; i++) {
        const currentMacd = macdLine[i];
        const sig = currentMacd * k + prevSignal * (1 - k);
        signalLine.push(sig);
        prevSignal = sig;
      }
  } else {
      // 데이터가 너무 짧아서 계산 불가능한 경우 나머지 채움
      while(signalLine.length < data.length) signalLine.push(NaN);
  }

  return data.map((_, i) => {
    const m = macdLine[i];
    const s = signalLine[i];
    
    // 안전한 연산: 둘 다 숫자일 때만 뺄셈, 아니면 NaN
    const isValid = !isNaN(m) && !isNaN(s);
    
    return {
      macd: m,
      signal: s,
      histogram: isValid ? m - s : NaN // ★ 여기서 빨간 줄 해결
    };
  });
};