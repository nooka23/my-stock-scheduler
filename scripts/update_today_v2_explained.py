# ======================================================================================
# 📘 초보자를 위한 코드 설명서: 주식 데이터 일일 업데이트 (update_today_v2.py)
# ======================================================================================
# 이 프로그램은 매일매일 새로운 주가 정보를 가져와서 데이터베이스(Supabase)에 저장하는 역할을 합니다.
# 특히 '수정주가'(액면분할 등으로 과거 주가가 변하는 현상)를 자동으로 감지해서 처리하는 똑똑한 기능이 있습니다.
#
# 코드는 위에서 아래로 순서대로 실행됩니다. 한 줄씩 천천히 읽어보세요! 😊
# ======================================================================================

# 1️⃣ 필요한 도구(라이브러리)들을 가져오는 단계
# 마치 요리하기 전에 재료와 도구를 준비하는 것과 같습니다.
import os                                   # 운영체제(Windows/Mac) 기능 사용 (예: 환경변수 읽기)
import FinanceDataReader as fdr             # 한국/미국 주식 가격을 가져오는 아주 유용한 도구
import pandas as pd                         # 엑셀처럼 표(Table) 형태의 데이터를 다루는 도구
from supabase import create_client, Client  # Supabase 데이터베이스와 대화하기 위한 도구
from dotenv import load_dotenv              # .env 파일에 숨겨둔 비밀키를 불러오는 도구
import time                                 # 시간 관련 기능 (예: 잠깐 멈추기)
from datetime import datetime, timedelta    # 날짜와 시간을 계산하는 도구

# 2️⃣ 보안 설정 (환경 변수 로드)
# 비밀번호 같은 중요한 정보는 코드에 직접 적지 않고 '.env.local'이라는 별도 파일에 숨겨둡니다.
# 이 함수가 그 비밀 금고(.env.local)를 엽니다.
load_dotenv('.env.local')

# 금고에서 Supabase 주소와 열쇠(Key)를 꺼냅니다.
url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

# 만약 열쇠가 없으면 "오류"라고 알려주고 프로그램을 종료합니다.
if not url or not key:
    print("❌ 환경변수 오류: .env.local 파일을 확인해주세요!")
    exit()

# 3️⃣ 데이터베이스 연결
# 이제 Supabase 데이터베이스에 접속할 준비가 되었습니다.
# 'supabase' 변수를 통해 앞으로 데이터를 넣거나 뺄 수 있습니다.
supabase: Client = create_client(url, key)

print("🚀 데일리 업데이트 V2 (수정주가 자동 보정) 시작!")

# 4️⃣ 종목 리스트 가져오기
# 한국거래소(KRX)에 상장된 모든 종목 목록을 가져옵니다.
df_krx = fdr.StockListing('KRX')

# 5️⃣ 불필요한 종목 걸러내기 (필터링)
# 주식 분석에 방해되는 '스팩(SPAC)', 'ETN', 'ETF'나 '우선주(이름 끝이 '우'로 끝남)'를 뺍니다.
# ~ 기호는 '반대(NOT)'를 의미합니다. 즉, 스팩이 '아닌' 것만 남깁니다.
filter_mask = (
    ~df_krx['Name'].str.contains('스팩|ETN|ETF', case=False) & 
    ~df_krx['Name'].str.endswith(('우', '우B', '우C'))
)

# 필요한 정보(종목코드, 이름, 시장구분, 시가총액)만 뽑아냅니다.
# to_dict('records')는 표(DataFrame) 데이터를 리스트 형태[{'Code': '...', ...}, ...]로 변환해줍니다.
# 이렇게 하면 반복문(for문)을 돌리기 편해집니다.
target_stocks_df = df_krx[filter_mask][['Code', 'Name', 'Market', 'Marcap']]
target_stocks = target_stocks_df.to_dict('records')

print(f"✅ 대상 종목: {len(target_stocks)}개")

# 6️⃣ 회사 정보(Companies) 테이블 업데이트
# 종목 코드는 그대로인데 회사 이름이 바뀌거나, 시가총액이 변했을 수 있으니 정보를 최신화합니다.
print("   Companies 테이블 동기화 중...")

company_upload_list = []
for stock in target_stocks:
    company_upload_list.append({
        "code": str(stock['Code']),           # 종목코드 (문자열로 변환)
        "name": stock['Name'],                # 회사명
        "market": stock['Market'],            # 시장 (KOSPI, KOSDAQ 등)
        # 시가총액이 비어있으면(NaN) 0으로 처리
        "marcap": float(stock['Marcap']) if not pd.isna(stock['Marcap']) else 0
    })

# 💡 대량 데이터 업로드 (청크 처리)
# 한 번에 수천 개를 보내면 인터넷이 끊기거나 에러가 날 수 있습니다.
# 그래서 1000개씩 쪼개서(chunk) 보냅니다.
# upsert: "Update" + "Insert"의 합성어. 있으면 수정하고, 없으면 새로 넣으라는 뜻!
for i in range(0, len(company_upload_list), 1000):
    chunk = company_upload_list[i:i+1000]
    supabase.table("companies").upsert(chunk).execute()

# 7️⃣ 주가 업데이트 준비
# 비교를 위해 '10일 전' 날짜를 구합니다. (주말/휴일을 고려해서 넉넉하게 잡음)
CHECK_START_DATE = (datetime.now() - timedelta(days=10)).strftime('%Y-%m-%d')
# 만약 데이터를 완전히 새로 받아야 할 때 쓸 시작 날짜 (2015년부터)
FULL_START_DATE = '2015-01-01'

success_count = 0  # 성공한 종목 수 세기
updated_count = 0  # 수정주가로 인해 전체 다시 받은 종목 수 세기

# 8️⃣ 개별 종목 반복문 (가장 중요한 부분!)
# enumerate는 번호(idx)와 데이터(stock)를 같이 줍니다. (0번 삼성전자, 1번 SK하이닉스...)
for idx, stock in enumerate(target_stocks):
    code = str(stock['Code'])
    name = stock['Name']
    
    # 50번째 종목마다 진행 상황을 출력해서 보여줍니다. (너무 조용하면 멈춘 줄 아니까요)
    if idx % 50 == 0:
        print(f"[{idx+1}/{len(target_stocks)}] {name}({code}) 진행 중...")

    try: # try: 에러가 나도 프로그램이 멈추지 않게 감싸줍니다.
        
        # [단계 A] 내 데이터베이스(Supabase)에 저장된 가장 최신 날짜와 가격 확인
        # "daily_prices_v2 테이블에서 code가 이거인 것 중, 날짜(date) 내림차순으로 1개만 가져와라"
        res = supabase.table('daily_prices_v2') \
            .select('date, close') \
            .eq('code', code) \
            .order('date', desc=True) \
            .limit(1) \
            .execute()
            
        # 데이터가 있으면 첫 번째 값을 가져오고, 없으면 None(없음)
        db_last_data = res.data[0] if res.data else None
        
        # [단계 B] 최신 주식 데이터 가져오기 (FinanceDataReader 이용)
        # CHECK_START_DATE(10일 전) 부터 오늘까지의 데이터를 가져옵니다.
        df_recent = fdr.DataReader(f'KRX:{code}', CHECK_START_DATE)
        
        if df_recent.empty: # 데이터가 아예 없으면 다음 종목으로 넘어갑니다.
            continue

        need_full_reload = False # "전체 재적재가 필요한가?" 상태 변수 (기본값: 아니오) 
        
        # [단계 C] 수정주가 감지 로직 (핵심! ⭐)
        if db_last_data:
            db_date = db_last_data['date']       # 내 DB에 저장된 마지막 날짜
            db_close = float(db_last_data['close']) # 내 DB에 저장된 마지막 종가
            
            # 새로 가져온 데이터(df_recent)에 내 DB 마지막 날짜가 있는지 확인
            if db_date in df_recent.index:
                # FDR에서 가져온 그 날짜의 종가
                fdr_close = float(df_recent.loc[db_date]['Close'])
                
                # 💡 비교! 내 DB 가격과 새로 조회한 가격이 다른가?
                # 1% 이상 차이가 나면 액면분할 등으로 과거 주가가 수정된 것으로 판단합니다.
                # (컴퓨터는 소수점 계산이 완벽하지 않아서 == 대신 1% 차이로 비교하는게 안전합니다)
                if abs(fdr_close - db_close) / db_close > 0.01:
                    print(f"   🔄 [수정주가 감지] {name}: DB가격({db_close}) != FDR가격({fdr_close}). 전체 다시 받습니다...")
                    need_full_reload = True
        else:
            # DB에 아무 데이터도 없으면 당연히 처음부터 다 받아야겠죠?
            print(f"   ✨ [신규] {name}: 데이터가 없어서 2015년부터 다 받습니다...")
            need_full_reload = True

        # [단계 D] 데이터 저장하기
        if need_full_reload:
            # [경로 1] 전체 재적재 (수정주가 발생 or 신규 종목)
            updated_count += 1
            
            # 2015년부터 전체 데이터 다시 요청
            df_full = fdr.DataReader(f'KRX:{code}', FULL_START_DATE)
            if df_full.empty: continue
            
            # DB에 넣을 형태로 변환
            upload_list = []
            for d, r in df_full.iterrows():
                upload_list.append({
                    "code": code,
                    "date": d.strftime('%Y-%m-%d'), # 날짜를 문자열로 (YYYY-MM-DD)
                    "open": int(r['Open']),
                    "high": int(r['High']),
                    "low": int(r['Low']),
                    "close": int(r['Close']),
                    "volume": int(r['Volume']),
                    "change": float(r['Change']) if not pd.isna(r['Change']) else 0.0
                })
            
            # 역시 1000개씩 쪼개서 업로드 (upsert가 덮어쓰기 해줍니다)
            for i in range(0, len(upload_list), 1000):
                chunk = upload_list[i:i+1000]
                supabase.table("daily_prices_v2").upsert(chunk, on_conflict="code, date").execute()
                
        else:
            # [경로 2] 일반 모드 (최신 데이터만 추가)
            if db_last_data:
                # DB 마지막 날짜보다 '이후'인 날짜의 데이터만 골라냅니다.
                last_db_date = datetime.strptime(db_last_data['date'], '%Y-%m-%d')
                df_new = df_recent[df_recent.index > last_db_date]
            else:
                df_new = df_recent # (이 경우는 거의 없지만 안전장치)

            if df_new.empty:
                # 추가할 새로운 데이터가 없으면 패스 (이미 최신 상태)
                continue
                
            upload_list = []
            for d, r in df_new.iterrows():
                upload_list.append({
                    "code": code,
                    "date": d.strftime('%Y-%m-%d'),
                    "open": int(r['Open']),
                    "high": int(r['High']),
                    "low": int(r['Low']),
                    "close": int(r['Close']),
                    "volume": int(r['Volume']),
                    "change": float(r['Change']) if not pd.isna(r['Change']) else 0.0
                })
            
            # 데이터가 있다면 업로드
            if upload_list:
                supabase.table("daily_prices_v2").upsert(upload_list, on_conflict="code, date").execute()
                
        success_count += 1

    except Exception as e:
        # 에러가 나면 여기서 잡습니다. (프로그램이 멈추지 않도록)
        print(f"   ❌ 에러 발생 {name}: {e}")
        time.sleep(1) # 에러나면 1초 쉬었다가 다시 침착하게 다음 종목으로

# 9️⃣ 마무리 인사
print(f"\n🎉 업데이트 완료! (성공: {success_count}개, 수정주가 보정: {updated_count}개)")
