L1.1.3
建立時間：2026-06-25 CST
來源提交：b8230b6 Restore L1.1.1 pie chart labels

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
- 延續 L1.1.2。
- 保留刪除股票、基金、歷史紀錄前的確認功能。
- 圓餅圖標註形式改回 L1.1.1 的呈現方式。
- 快取版本號更新為 20260625-3。

提醒：
- 這份備份不應放入真實密碼或 Supabase secret key。
- 若要部署，請把密碼與金鑰放在 Streamlit Secrets。
