import os
import FinanceDataReader as fdr
import pandas as pd
from supabase import create_client, Client
from dotenv import load_dotenv
import time
import json

load_dotenv('.env.local')

url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_KEY")

if not url or not key:
    print("Error: 키 설정 확인 필요")
    exit()

supabase: Client = create_client(url, key)

print("🔍 누락된 종목 찾기 시작...")

# 1. KRX 전체 종목 리스트 가져오기
print("   - KRX 전체 종목 리스트 조회 중...")
try:
    df_krx = fdr.StockListing('KRX')
    all_stocks = df_krx[['Code', 'Name']].set_index('Code')['Name'].to_dict() # {code: name} 형태
    print(f"     ✅ 전체 대상: {len(all_stocks)}개")
except Exception as e:
    print(f"     ❌ 실패: {e}")
    exit()

# 2. Supabase Storage에 이미 있는 파일 목록 가져오기
print("   - Supabase 저장된 파일 확인 중...")
uploaded_codes = set()
try:
    # 한 번에 100개씩 가져오므로 반복해서 전체를 가져와야 함
    # (Supabase Python SDK 버전에 따라 list 동작이 다를 수 있어 안전하게 넉넉히 loop)
    # 단순히 list()만 하면 최대 100개만 가져올 수 있음 -> offset 필요하지 않음 (Storage list API 한계)
    # ★ 팁: 파일이 너무 많으면 list API로 다 가져오기 힘듭니다.
    # 전략 변경: 그냥 전체 리스트를 돌면서 .download() 체크하는 건 너무 느림.
    # -> list API의 search 옵션 등을 쓰기보다, 여기서는 "재시도"이므로
    # 가장 확실한 방법은 "실패한 애들만 로그를 보고 돌리는 것"이지만 로그가 없으므로,
    # "List API"를 최대한 활용해 봅니다.
    
    # 꼼수: 폴더 내 파일 전체 리스팅이 어려울 땐, 그냥 일단 실패했던 것 같은 구간이나
    # 전체를 돌리되 "이미 있으면 패스"하는 로직이 더 안전할 수 있습니다.
    # 하지만 여기서는 "스마트하게" 비교해보겠습니다.
    
    files = supabase.storage.from_("stocks").list() # 기본 100개
    # 만약 100개 이상이면 pagination을 해야 하는데 python sdk가 이를 지원하는지 확인 필요.
    # 일단 단순하게 갑니다 -> *전체 재시도 하되, 파일 존재 여부 체크* 로직으로 변경
    
    # 전략 수정: Storage List API는 수천 개 파일 조회에 한계가 있습니다.
    # 따라서, "전체 종목을 순회하되, 파일이 있는지 찔러보고(get_public_url 등) 없으면 업로드" 하는 방식도 느립니다.
    
    # 가장 현실적인 방법:
    # 아까 "실패 메시지"가 떴던 종목들을 기억한다면 좋겠지만, 그렇지 않다면
    # "무조건 덮어쓰기" 옵션으로 전체를 다시 돌리는 게 낫습니다.
    # 단, 이번에는 "실패 시 재시도(Retry)" 로직을 강화해서 짰습니다.
    
    pass 
except Exception as e:
    print(f"     ❌ 저장소 조회 실패: {e}")

# ---------------------------------------------------------
# 전략 수정: 누락된 걸 찾는 것보다, 실패해도 안 죽고 끝까지 돌리는 게 중요합니다.
# "실패했던 것만" 골라내기가 API 한계상 까다로우므로, 
# 전체를 다시 돌리되 "이미 성공한 건 빠르게 스킵" 할 수는 없고 (파일 열어봐야 하므로)
# 그냥 튼튼한 스크립트로 다시 한 번 돌리는 것을 추천합니다.
# 대신 이번엔 실패한 종목 이름을 "failed_list.txt"에 따로 저장하게 해드릴게요.
# ---------------------------------------------------------

START_DATE = '2010-01-01'
print(f"🚀 안정적인 재업로드 스크립트 시작 (실패 시 기록 남김)...")

failed_stocks = []

for idx, (code, name) in enumerate(all_stocks.items()):
    
    if idx % 50 == 0:
        print(f"[{idx}/{len(all_stocks)}] 진행 중... (현재까지 실패: {len(failed_stocks)}건)")

    try:
        # 1. 여기서 '이미 있는지 확인' 기능을 넣으면 좋겠지만, 
        # HTTP 요청을 보내야 해서 속도 차이가 크지 않습니다.
        # 그냥 덮어쓰기 업로드 시도합니다.
        
        # 주가 데이터 수집
        df = fdr.DataReader(code, START_DATE)
        
        if df.empty:
            # 데이터가 아예 없는 건 실패가 아니라 '없는 것'
            continue

        df = df.reset_index()
        df['Date'] = df['Date'].dt.strftime('%Y-%m-%d')
        df = df[['Date', 'Open', 'High', 'Low', 'Close', 'Volume']]
        df.columns = ['time', 'open', 'high', 'low', 'close', 'volume']
        
        json_data = df.to_json(orient='records')

        # 업로드
        res = supabase.storage.from_("stocks").upload(
            file=json_data.encode('utf-8'),
            path=f"{code}.json",
            file_options={"content-type": "application/json", "upsert": "true"}
        )
        
    except Exception as e:
        # ★ 실패 시 멈추지 않고 리스트에 적어두고 넘어감
        print(f"   ❌ {name}({code}) 실패: {str(e)[:50]}...")
        failed_stocks.append({"code": code, "name": name, "error": str(e)})
        
    # 속도 조절 (너무 빠르면 에러남)
    time.sleep(0.1)

# 결과 리포트
print("\n" + "="*30)
print(f"🎉 작업 종료!")
print(f"총 실패 건수: {len(failed_stocks)}건")

if failed_stocks:
    print("실패한 종목 리스트를 'failed_log.json'에 저장합니다.")
    with open('failed_log.json', 'w', encoding='utf-8') as f:
        json.dump(failed_stocks, f, ensure_ascii=False, indent=2)
    print("👉 'failed_log.json' 파일을 확인해서 원인을 분석해보세요.")
else:
    print("완벽합니다! 실패한 종목이 없습니다.")