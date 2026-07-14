import pandas as pd
import json
from datetime import datetime, timezone
import gspread
from google.oauth2.service_account import Credentials
from collections import OrderedDict
import hashlib
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CREDENTIALS_FILE = os.path.join(SCRIPT_DIR, "_credentials.json")

# -------------------------------
# GOOGLE SHEETS AUTHENTICATION
# -------------------------------
def authenticate_google_sheets():
    scope = [
        "https://www.googleapis.com/auth/spreadsheets.readonly",
        "https://www.googleapis.com/auth/drive.readonly",
    ]

    if "GOOGLE_CREDENTIALS" in os.environ:
        # CI / production
        info = json.loads(os.environ["GOOGLE_CREDENTIALS"])
        creds = Credentials.from_service_account_info(info, scopes=scope)
    else:
        # Local fallback (ignored by Git)
        creds = Credentials.from_service_account_file(
            CREDENTIALS_FILE,
            scopes=scope
        )

    return gspread.authorize(creds)


# -------------------------------
# READ GOOGLE SHEET DATA
# -------------------------------
def read_google_sheet(sheet_name, worksheet_name):
    client = authenticate_google_sheets()
    spreadsheet = client.open(sheet_name)
    # spreadsheet = client.open_by_key(SHEET_ID)
    worksheet = spreadsheet.worksheet(worksheet_name)
    data = worksheet.get_all_values()
    
    if data:
        df = pd.DataFrame(data[1:], columns=data[0])
    else:
        df = pd.DataFrame()
    
    return df
