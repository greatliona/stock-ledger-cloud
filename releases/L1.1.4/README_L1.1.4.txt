L1.1.4
建立時間：2026-07-06 CST

這是股票記帳本雲端版 app 的本機備份版本。

版本備註：
- 延續 L1.1.3。
- Streamlit 標籤頁圖示改為錢袋：st.set_page_config(page_title="Stock Ledger!", page_icon="💰", layout="wide")。
- 不覆寫 L1.1.3 舊檔，另存為 releases/L1.1.4。

備份內容：
- README.md
- requirements.txt
- supabase_setup.sql
- streamlit_app.py
- index.html
- app.js
- styles.css

提醒：
- 這份備份不應放入真實密碼或 Supabase secret key。
- 若要部署，請把密碼與金鑰放在 Streamlit Secrets。
