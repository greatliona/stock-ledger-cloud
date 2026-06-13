L1.0.5
建立時間：2026-06-13 15:09 CST

這是股票記帳本雲端版 app 的本機備份版本。

備份內容：
- streamlit_app.py：Streamlit 入口與密碼頁
- index.html：內嵌頁面結構
- app.js：記帳功能與圖表邏輯
- styles.css：畫面樣式
- requirements.txt：Streamlit Cloud 需要安裝的套件
- supabase_setup.sql：Supabase 資料庫表格設定
- README.md：部署與設定說明

版本備註：
- 此版延續 L1.0.4。
- 股票表新增鉛筆編輯流程，可修改中文名、股號、張數、買入價格。
- 基金表新增鉛筆編輯流程，可修改基金名稱、基金成本、目前總額。
- 股票分類會忽略券商名稱，例如智邦元大、智邦凱基都歸類到智邦。
- 現有股票排序改為先照中文主名排序，再照中文名稱最後四碼排序。
- 股票表欄位調整為標題與數值置中，並保留鉛筆與刪除按鈕。

提醒：
- 這份備份不應放入真實密碼或 Supabase secret key。
- 若要部署，請把密碼與金鑰放在 Streamlit Secrets。
