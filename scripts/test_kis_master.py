import kis_master_loader

print("Testing KIS Master Loader...")
df = kis_master_loader.get_all_stocks()

if not df.empty:
    print(f"✅ Success! Retrieved {len(df)} stocks.")
    print(df.head())
    print(df.tail())
else:
    print("❌ Failed to retrieve stocks.")
