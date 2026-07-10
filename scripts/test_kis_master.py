import kis_master_loader

print("Testing KIS Master Loader...")
df = kis_master_loader.get_all_stocks()

if not df.empty:
    print(f"✅ Success! Retrieved {len(df)} stocks.")
    print("\nSecurity type counts:")
    print(df["SecurityType"].value_counts().to_string())
    print("\nRS eligibility counts:")
    print(df["IsRsEligible"].value_counts().to_string())

    expected_types = {"COMMON", "PREFERRED", "ETP", "SPAC"}
    missing_types = expected_types - set(df["SecurityType"].unique())
    assert not missing_types, f"Missing expected security types: {sorted(missing_types)}"
    assert df.loc[df["SecurityType"] != "COMMON", "IsRsEligible"].eq(False).all()
    assert df.loc[df["SecurityType"] == "COMMON", "IsRsEligible"].eq(True).all()

    print(df.head())
    print(df.tail())
else:
    print("❌ Failed to retrieve stocks.")
