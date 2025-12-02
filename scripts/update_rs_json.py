import os
import pandas as pd
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv
import json
import time
import io

# 1. 설정 로드
load_dotenv('.env.local')
url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_KEY")

if not url or not key:
    print("Error: 키 설정 확인 필요")
    exit()

supabase: Client = create_client(url, key)

print("🚀 JSON 파일 RS지수 업데이트 시작 (대공사)...")

# ---------------------------------------------------------
# 1. 파일 목록 가져오기
# ---------------------------------------------------------
print("1. 저장된 파일 목록 조회 중...")
# Storage API는 한 번에 많은 리스트를 가져오기 어려우므로, 
# 'companies' 테이블(이미 DB에 있음)을 이용해서 코드 리스트를 확보합니다.
response = supabase.table("companies").select("code, name").range(0, 9999).execute()
target_stocks = response.data

print(f"   - 총 {len(target_stocks)}개 종목 대상")

# ---------------------------------------------------------
# 2. 전체 데이터 다운로드 (메모리에 적재)
# ---------------------------------------------------------
print("2. 모든 JSON 파일 다운로드 중 (시간이 꽤 걸립니다)...")

all_data_frames = []
download_count = 0

for idx, stock in enumerate(target_stocks):
    code = stock['code']
    
    if idx % 100 == 0:
        print(f"   [{idx}/{len(target_stocks)}] 다운로드 진행 중...")

    try:
        # 파일 다운로드 (메모리로)
        res = supabase.storage.from_("stocks").download(f"{code}.json")
        
        # JSON -> DataFrame 변환
        # res는 binary 데이터이므로 decode 필요
        json_str = res.decode('utf-8')
        df = pd.read_json(io.StringIO(json_str))
        
        # 코드 컬럼 추가 (나중에 피벗팅을 위해)
        df['code'] = code
        all_data_frames.append(df)
        download_count += 1
        
    except Exception as e:
        # 파일이 없거나 에러나면 패스 (상장폐지 등)
        continue

print(f"✅ 다운로드 완료: {download_count}개 파일 확보")

if not all_data_frames:
    print("다운로드된 데이터가 없습니다. update_prices_json.py를 먼저 실행했나요?")
    exit()

# ---------------------------------------------------------
# 3. 가중 RS 지수 대량 계산 (수정됨)
# ---------------------------------------------------------
print("🧮 3. 전체 역사적 가중 RS 지수 계산 중...")

full_df = pd.concat(all_data_frames)
full_df['date'] = pd.to_datetime(full_df['time'])
pivot_df = full_df.pivot(index='date', columns='code', values='close')

# ★ [수정] 4분기 가중 합산 로직 적용
price_now = pivot_df
price_3m = pivot_df.shift(63)
price_6m = pivot_df.shift(126)
price_9m = pivot_df.shift(189)
price_12m = pivot_df.shift(252)

# 각 구간별 수익률
ret_q1 = (price_now - price_3m) / price_3m
ret_q2 = (price_3m - price_6m) / price_6m
ret_q3 = (price_6m - price_9m) / price_9m
ret_q4 = (price_9m - price_12m) / price_12m

# 가중 합산
weighted_score = (0.4 * ret_q1) + (0.2 * ret_q2) + (0.2 * ret_q3) + (0.2 * ret_q4)

# 랭킹 산정
rs_df = weighted_score.rank(axis=1, pct=True) * 99
rs_df = rs_df.fillna(0).round().astype(int).clip(1, 99)

print("✅ 가중 RS 계산 완료! 업로드 준비합니다.")

# ---------------------------------------------------------
# 4. 파일별 병합 및 재업로드
# ---------------------------------------------------------
print("💾 4. 각 파일에 RS 추가 후 재업로드 시작 (가장 오래 걸림)...")

# RS 데이터프레임을 다시 길게 변환 (Stack)
rs_long = rs_df.stack().reset_index()
rs_long.columns = ['date', 'code', 'rs']
# 날짜를 문자열로 변환 (기존 JSON 포맷인 YYYY-MM-DD와 맞추기 위해)
rs_long['time_str'] = rs_long['date'].dt.strftime('%Y-%m-%d')

# 검색 속도를 위해 { (code, time): rs } 형태의 딕셔너리로 변환
# 이렇게 하면 매핑 속도가 엄청 빨라짐
print("   - 고속 매핑을 위한 인덱싱 중...")
rs_dict = {}
# to_dict('records')는 느리므로 zip 사용
for c, t, r in zip(rs_long['code'], rs_long['time_str'], rs_long['rs']):
    rs_dict[(c, t)] = r

print("   - 업로드 시작...")

# 원래 데이터프레임 리스트를 순회하며 업데이트
for idx, df in enumerate(all_data_frames):
    code = df['code'].iloc[0] # 이 데이터프레임의 주인 코드
    
    if idx % 50 == 0:
        print(f"   [{idx}/{len(all_data_frames)}] 재업로드 중...")

    try:
        # RS 컬럼 추가
        # map 함수를 써서 rs_dict에서 점수를 찾아 넣음. 없으면 0
        df['rs'] = df['time'].map(lambda t: rs_dict.get((code, t), None))
        
        # 'code', 'date' 임시 컬럼 제거 (저장할 땐 필요 없음)
        save_df = df.drop(columns=['code', 'date'], errors='ignore')
        
        # NaN 처리 (RS 없는 초기 데이터 등) -> null로 두면 차트에서 안 그려짐 (깔끔)
        # JSON 변환
        json_data = save_df.to_json(orient='records')

        # 재업로드 (덮어쓰기)
        # 429 에러 방지 로직 포함
        for attempt in range(5):
            try:
                supabase.storage.from_("stocks").upload(
                    file=json_data.encode('utf-8'),
                    path=f"{code}.json",
                    file_options={"content-type": "application/json", "upsert": "true"}
                )
                break
            except Exception as err:
                if "429" in str(err):
                    time.sleep(2 * (attempt + 1))
                elif attempt == 4:
                    print(f"      ❌ {code} 업로드 실패: {err}")
                else:
                    time.sleep(0.5)
        
        # 너무 빠르면 로컬 PC 네트워크도 막힐 수 있으니 미세한 딜레이
        time.sleep(0.02)

    except Exception as e:
        print(f"      ❌ {code} 처리 중 에러: {e}")

print("\n🎉 모든 과거 데이터 RS 업데이트 완료!")