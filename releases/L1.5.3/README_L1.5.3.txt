L1.5.3

- 修正 Streamlit 桌面版刪除持股時，交易紀錄視窗被固定在 iframe 中央而偏離目前畫面的問題；現在依外層實際可見範圍置中。
- 修正正式 Streamlit 頁面沒有載入 Excel 元件，導致匯出按鈕無反應的問題；Excel 程式已直接內嵌到頁面。
- Excel 下載改為適用 Streamlit iframe 的 Blob 下載流程。
- 已在真正的 Streamlit iframe 以假持股完成新增、刪除、建立交易與 Excel 下載測試；產出的 xlsx 壓縮結構與測試資料均驗證正常。
- 交易紀錄名稱格式與其他既有頁面排版維持不變。
