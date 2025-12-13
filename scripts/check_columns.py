import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv('.env.local')

url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

supabase: Client = create_client(url, key)

try:
    print("Checking columns...")
    # Try to select the new columns from a single row
    res = supabase.table('trading_value_rankings').select('code, avg_amount_60, rank_amount_60').limit(1).execute()
    print("Success:", res.data)
except Exception as e:
    print("Error:", e)
