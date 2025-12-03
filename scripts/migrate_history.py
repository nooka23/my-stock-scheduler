import os
import json
import time
from supabase import create_client, Client
from dotenv import load_dotenv

# .env.local 파일 로드
load_dotenv('.env.local')

url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not url or not key:
    print("❌ 환경변수 오류: .env.local 파일에 NEXT_PUBLIC_SUPABASE_URL 및 SUPABASE_SERVICE_ROLE_KEY가 설정되어 있어야 합니다.")
    exit()

supabase: Client = create_client(url, key)

BUCKET_NAME = 'stocks'
DAYS_TO_KEEP = 60  # 최근 60일치 데이터만 DB에 복원 (주간/월간 급상승 계산용)

print(f"🚀 JSON -> DB 마이그레이션 시작 (최근 {DAYS_TO_KEEP}일치 복원)")

# 1. 종목 리스트 가져오기 (companies 테이블에서)
try:
    # 페이지네이션 없이 최대한 많이 가져오기 위해 range 설정이 필요할 수 있음 (Supabase 기본 1000개 제한)
    # 여기서는 넉넉하게 여러 번 나눠서 가져오거나 해야 하지만, 
    # 파이썬 클라이언트는 .select("*").execute() 시 기본 제한이 걸릴 수 있음.
    
    all_companies = []
    start = 0
    chunk = 1000
    while True:
        res = supabase.table("companies").select("code, name").range(start, start + chunk - 1).execute()
        if not res.data:
            break
        all_companies.extend(res.data)
        start += chunk
        if len(res.data) < chunk:
            break
            
    print(f"✅ 총 {len(all_companies)}개 종목 목록 로드 완료")
    
except Exception as e:
    print(f"❌ 종목 리스트 조회 실패: {e}")
    exit()

total_count = len(all_companies)

for idx, comp in enumerate(all_companies):
    code = comp['code']
    name = comp['name']
    
    if idx % 50 == 0:
        print(f"[{idx+1}/{total_count}] {name}({code}) 처리 중...")

    try:
        # 2. Storage에서 JSON 다운로드
        try:
            # from_() 메소드 사용 주의
            file_data = supabase.storage.from_(BUCKET_NAME).download(f"{code}.json")
        except Exception:
            # 파일이 없는 경우 (신규 상장 등) 조용히 넘어감
            continue
            
        json_str = file_data.decode('utf-8')
        data_list = json.loads(json_str)
        
        if not data_list:
            continue
            
        # 3. 데이터 필터링 (최근 N일)
        # JSON 데이터는 보통 시간순 정렬되어 있음. 뒤에서부터 N개 가져옴.
        recent_data = data_list[-DAYS_TO_KEEP:]
        
        upload_data = []
        for item in recent_data:
            # 차트용 JSON에는 'rs' 또는 'rs_rating' 키로 저장되어 있을 수 있음
            # 값이 없으면 None
            rs_val = item.get('rs') 
            if rs_val is None:
                rs_val = item.get('rs_rating')
            
            # 날짜 필드: 'time' 또는 'date_str'
            date_val = item.get('time') or item.get('date_str')
            
            if not date_val: 
                continue
                
            upload_data.append({
                "code": code,
                "date_str": date_val,
                "open": int(item.get('open', 0)),
                "high": int(item.get('high', 0)),
                "low": int(item.get('low', 0)),
                "close": int(item.get('close', 0)),
                "volume": int(item.get('volume', 0)),
                "rs_rating": int(rs_val) if rs_val is not None else None
            })
            
        if not upload_data:
            continue

        # 4. DB에 Upsert
        # on_conflict="code, date_str"를 명시하고, ignore_duplicates=True로 설정하여
        # 이미 존재하는 데이터는 건너뛰고 에러를 방지합니다.
        supabase.table("daily_prices").upsert(
            upload_data, 
            on_conflict="code, date_str", 
            ignore_duplicates=True
        ).execute()
        
    except Exception as e:
        print(f"   ⚠️ {name}({code}) 에러: {e}")
        
    # API 호출 제한 고려
    if idx % 100 == 0: time.sleep(1)

print("\n🎉 모든 데이터 마이그레이션 완료!")
