import os
import zipfile
import pandas as pd
import requests
import io

def download_and_parse_kospi_master(base_dir):
    url = "https://new.real.download.dws.co.kr/common/master/kospi_code.mst.zip"
    mst_file_name = "kospi_code.mst"
    
    # Download
    print(f"   Downloading {mst_file_name}...")
    try:
        response = requests.get(url)
        response.raise_for_status()
        with zipfile.ZipFile(io.BytesIO(response.content)) as z:
            z.extract(mst_file_name, base_dir)
    except Exception as e:
        print(f"   ❌ KOSPI Master Download Failed: {e}")
        return pd.DataFrame()

    file_path = os.path.join(base_dir, mst_file_name)
    
    # Parse
    # Part 1: Fixed columns (Short Code, Standard Code, Name) - First 21+ bytes?
    # Logic adapted from kis_kospi_code_mst.py: 
    # rf1 = row[0:len(row) - 228]
    # rf1_1 = rf1[0:9].rstrip() (Short Code)
    # rf1_2 = rf1[9:21].rstrip() (Standard Code)
    # rf1_3 = rf1[21:].strip() (Name)
    
    # We will read line by line to separate Part 1 and Part 2
    part1_rows = []
    part2_rows = []
    
    with open(file_path, mode="r", encoding="cp949") as f:
        for row in f:
            # 228 is the length of the fixed width part at the end
            # The name part is variable length (left over)
            rf1 = row[0:len(row) - 228]
            rf1_1 = rf1[0:9].strip() # Short Code
            rf1_2 = rf1[9:21].strip() # Standard Code
            rf1_3 = rf1[21:].strip() # Name
            
            part1_rows.append([rf1_1, rf1_2, rf1_3])
            
            rf2 = row[-228:]
            part2_rows.append(rf2)

    df1 = pd.DataFrame(part1_rows, columns=['ShortCode', 'StandardCode', 'Name'])
    
    # Part 2 specs
    field_specs = [2, 1, 4, 4, 4,
                   1, 1, 1, 1, 1,
                   1, 1, 1, 1, 1,
                   1, 1, 1, 1, 1,
                   1, 1, 1, 1, 1,
                   1, 1, 1, 1, 1,
                   1, 9, 5, 5, 1,
                   1, 1, 2, 1, 1,
                   1, 2, 2, 2, 3,
                   1, 3, 12, 12, 8,
                   15, 21, 2, 7, 1,
                   1, 1, 1, 1, 9,
                   9, 9, 5, 9, 8,
                   9, 3, 1, 1, 1]
    
    part2_columns = ['GroupCode', 'MarcapScale', 'SectorLarge', 'SectorMedium', 'SectorSmall',
                     'Manufacturing', 'LowLiquidity', 'Governance', 'KOSPI200Sector', 'KOSPI100',
                     'KOSPI50', 'KRX', 'ETP', 'ELW', 'KRX100',
                     'KRXAuto', 'KRXSemi', 'KRXBio', 'KRXBank', 'SPAC',
                     'KRXEnergy', 'KRXSteel', 'ShortTermOverheat', 'KRXMedia', 'KRXConst',
                     'Non1', 'KRXSec', 'KRXShip', 'KRXSectorIns', 'KRXSectorTrans',
                     'SRI', 'BasePrice', 'Unit', 'UnitOvertime', 'Stop',
                     'Cleanup', 'Managed', 'Warning', 'WarningNotice', 'Unfaithful',
                     'Backdoor', 'Lock', 'Split', 'CapitalIncrease', 'MarginRatio',
                     'Credit', 'CreditTerm', 'PrevVol', 'FaceValue', 'ListingDate',
                     'Shares', 'Capital', 'SettleMonth', 'PublicPrice', 'Preferred',
                     'ShortOverheat', 'Surge', 'KRX300', 'KOSPI', 'Sales',
                     'OpProfit', 'NetProfit', 'NetIncome', 'ROE', 'BaseYM',
                     'Marcap', 'GroupCode2', 'CreditLimitExceeded', 'CollateralLoan', 'StockLoan']

    # Using a temporary file for read_fwf is easiest given the list of strings
    tmp_path = os.path.join(base_dir, "kospi_part2.tmp")
    with open(tmp_path, "w") as f:
        f.writelines(part2_rows)
        
    df2 = pd.read_fwf(tmp_path, widths=field_specs, names=part2_columns)
    
    # Merge
    df = pd.concat([df1, df2], axis=1)
    
    # Cleanup
    if os.path.exists(file_path): os.remove(file_path)
    if os.path.exists(tmp_path): os.remove(tmp_path)
    
    return df

def download_and_parse_kosdaq_master(base_dir):
    url = "https://new.real.download.dws.co.kr/common/master/kosdaq_code.mst.zip"
    mst_file_name = "kosdaq_code.mst"
    
    # Download
    print(f"   Downloading {mst_file_name}...")
    try:
        response = requests.get(url)
        response.raise_for_status()
        with zipfile.ZipFile(io.BytesIO(response.content)) as z:
            z.extract(mst_file_name, base_dir)
    except Exception as e:
        print(f"   ❌ KOSDAQ Master Download Failed: {e}")
        return pd.DataFrame()

    file_path = os.path.join(base_dir, mst_file_name)
    
    part1_rows = []
    part2_rows = []
    
    with open(file_path, mode="r", encoding="cp949") as f:
        for row in f:
            # 222 length for KOSDAQ fixed part
            rf1 = row[0:len(row) - 222]
            rf1_1 = rf1[0:9].strip()
            rf1_2 = rf1[9:21].strip()
            rf1_3 = rf1[21:].strip()
            
            part1_rows.append([rf1_1, rf1_2, rf1_3])
            
            rf2 = row[-222:]
            part2_rows.append(rf2)

    df1 = pd.DataFrame(part1_rows, columns=['ShortCode', 'StandardCode', 'Name'])
    
    field_specs = [2, 1,
                   4, 4, 4, 1, 1,
                   1, 1, 1, 1, 1,
                   1, 1, 1, 1, 1,
                   1, 1, 1, 1, 1,
                   1, 1, 1, 1, 9,
                   5, 5, 1, 1, 1,
                   2, 1, 1, 1, 2,
                   2, 2, 3, 1, 3,
                   12, 12, 8, 15, 21,
                   2, 7, 1, 1, 1,
                   1, 9, 9, 9, 5,
                   9, 8, 9, 3, 1,
                   1, 1]

    part2_columns = ['GroupCode', 'MarcapScale',
                     'SectorLarge', 'SectorMedium', 'SectorSmall', 'Venture',
                     'LowLiquidity', 'KRXStock', 'ETP', 'KRX100',
                     'KRXAuto', 'KRXSemi', 'KRXBio', 'KRXBank', 'SPAC',
                     'KRXEnergy', 'KRXSteel', 'ShortTermOverheat', 'KRXMedia',
                     'KRXConst', 'Caution', 'KRXSec', 'KRXShip',
                     'KRXSectorIns', 'KRXSectorTrans', 'KOSDAQ150', 'BasePrice',
                     'Unit', 'UnitOvertime', 'Stop', 'Cleanup',
                     'Managed', 'Warning', 'WarningNotice', 'Unfaithful',
                     'Backdoor', 'Lock', 'Split', 'CapitalIncrease', 'MarginRatio',
                     'Credit', 'CreditTerm', 'PrevVol', 'FaceValue', 'ListingDate', 'Shares',
                     'Capital', 'SettleMonth', 'PublicPrice', 'Preferred', 'ShortOverheat', 'Surge',
                     'KRX300', 'Sales', 'OpProfit', 'NetProfit', 'NetIncome', 'ROE',
                     'BaseYM', 'Marcap', 'GroupCode2', 'CreditLimitExceeded', 'CollateralLoan', 'StockLoan']

    tmp_path = os.path.join(base_dir, "kosdaq_part2.tmp")
    with open(tmp_path, "w") as f:
        f.writelines(part2_rows)
        
    df2 = pd.read_fwf(tmp_path, widths=field_specs, names=part2_columns)
    
    df = pd.concat([df1, df2], axis=1)
    
    if os.path.exists(file_path): os.remove(file_path)
    if os.path.exists(tmp_path): os.remove(tmp_path)
    
    return df

def get_all_stocks():
    """
    Downloads and parses KOSPI and KOSDAQ master files to get a unified stock list.
    Returns DataFrame with columns: Code, Name, Market, Marcap
    Filters out SPACs, ETFs, ETNs, and Preferred shares.
    """
    base_dir = os.getcwd() # Or use a temp dir
    
    print("   Downloading & Parsing KOSPI Master...")
    kospi_df = download_and_parse_kospi_master(base_dir)
    if not kospi_df.empty:
        kospi_df['Market'] = 'KOSPI'
        # Filter
        # ETP: 'Y' (ETF/ETN)
        # SPAC: 'Y'
        # Preferred: 'Y' (Check if '0' is normal? Usually 'Y' or '1' is preferred. Need to check empty/space)
        # In master files, usually 'N' or space is normal.
        
        # Safe filtering logic (assuming 'N' or NaN or space is normal)
        # Let's inspect values if possible, but strict filtering:
        # Exclude if ETP == 'Y' or SPAC == 'Y' or Preferred != '0'? (Check field desc)
        # KOSPI Preferred: '1' is preferred? 
        # Using Name based filtering is safer as a secondary check, but primary check with codes is better.
        # But for now, let's use the Name-based filtering as the user did, for consistency.
        pass

    print("   Downloading & Parsing KOSDAQ Master...")
    kosdaq_df = download_and_parse_kosdaq_master(base_dir)
    if not kosdaq_df.empty:
        kosdaq_df['Market'] = 'KOSDAQ'
        
    
    # Combine
    full_df = pd.concat([kospi_df, kosdaq_df], ignore_index=True)
    
    if full_df.empty:
        return pd.DataFrame()
        
    # Standardize columns
    # Code (ShortCode), Name, Market, Marcap
    # Marcap units: '시가총액' (9 digits). Likely 100 million won (eok).
    # Convert to Won (int64)
    
    # Cleaning
    full_df['Marcap'] = pd.to_numeric(full_df['Marcap'], errors='coerce').fillna(0) * 100000000 # 억 -> 원
    
    result_df = full_df[['ShortCode', 'Name', 'Market', 'Marcap']].rename(columns={'ShortCode': 'Code'})
    
    # Filter
    # 1. Name based filtering (proven to work for user)
    # 2. Or using master columns
    
    # Replicating user's filter:
    # ~df_krx['Name'].str.contains('스팩|ETN|ETF', case=False)
    # ~df_krx['Name'].str.endswith(('우', '우B', '우C'))
    
    # Also filter for 6-digit codes (Standard stocks)
    mask = (
        (result_df['Code'].str.len() == 6) &
        ~result_df['Name'].str.contains('스팩|ETN|ETF', case=False) &
        ~result_df['Name'].str.endswith(('우', '우B', '우C'))
    )
    
    final_df = result_df[mask].copy()
    
    return final_df
