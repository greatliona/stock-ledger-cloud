L1.1.3
建立時間：2026-06-25 CST
來源檔案：/Users/vision/Desktop/StockApps/my_stock_tool6/L1.1.1.txt
來源提交：15f8178 Tune fund chart scale

這是股票記帳本雲端版 app 的本機備份版本。

版本備註：
- 以使用者指定的 L1.1.1 純文字備份為底。
- 折線圖分成三張可左右滑動：合併市值、股票市值、基金市值。
- 折線圖順序為合併市值第一張、股票市值第二張、基金市值第三張。
- 圓餅圖維持 L1.1.1 的標註形式與色系。
- 單純基金折線圖 Y 軸為 0.1M 一格。
- 單純基金折線圖上限為基金最高市值向下取 0.1M 後加 0.2M。
- 保留刪除歷史紀錄前的確認功能。
- 新增刪除股票前確認：「確定刪除 股票名稱？」
- 新增刪除基金前確認：「確定刪除 基金名稱？」
- 快取版本號更新為 20260625-4。

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
