# L1.5.26 富途查價設定（私鑰密碼選用）

## Secrets 需要什麼？

需要 **AppKey ID + 與該 AppKey 配對的私鑰**。不是公鑰 + 私鑰。
公鑰由富途後台保存，用來驗證請求，不需要再放進 Streamlit Secrets。
此版本使用 Ed25519 簽章；現有 AppKey 和公鑰配對不用重建。

## 最簡單設定：沒有加密過的私鑰

先部署 L1.5.26，再到 Streamlit 帳本 Settings → Secrets。
保留原本其他設定，只新增或修改唯一的一段 [futu]：

```toml
[futu]
app_key = "富途後台顯示的 AppKey ID"
private_key_pem = """
貼上完整私鑰內容
"""
```

- app_key 是 AppKey ID，不是公鑰、手機號碼或富途登入密碼。
- private_key_pem 接受完整 PEM（包含 BEGIN/END PRIVATE KEY 標頭），
  也接受只有一長串 Base64 的完整 PKCS#8 私鑰（例如 MC4…）。
- 不要貼檔案路徑，不可省略字元，也不要貼 public.pem。
- **不需要 private_key_password**，可刪掉之前的示範密碼那一行。
- 不需執行終端機、不需建立新密碼、不需另外加密。
- 按 Save 儲存後重新啟動服務，確認頁面版本為 L1.5.26。
- 私鑰只由你自己貼到伺服器 Secrets；不要貼在聊天、截圖或 GitHub。

## 只有原私鑰本來就已加密時

若內容開頭是 BEGIN ENCRYPTED PRIVATE KEY，則使用同樣的設定，
並在 [futu] 區段加入：

```toml
private_key_password = "當初加密此私鑰時使用的密碼"
```

此密碼不是富途登入密碼，不能隨便填一個新密碼。
未加密私鑰即使留有舊的密碼範例也不會被阻擋，但建議移除多餘欄位。
舊版 futu_key_setup.py / futu_encrypt_key.py 是選用工具，不是必要設定步驟。

## 查價方式與安全界線

- 只按美股 reload 時查價，一次請求帶所有股票代號，不下单、不讀券商持倉、不購買服務。
- 私鑰留在 Streamlit 伺服器；發給富途的是 AppKey、時間、隨機值和數位簽章，不傳私鑰本身。
- 移除檔案密碼不代表可公開私鑰；Streamlit Secrets 的存取權限仍須保護好。
- 價格與盤別依富途回應顯示，錯誤時保留原價，不退回 Yahoo。
- 使用測試金鑰驗證未加密 PEM、Base64 PKCS#8、加密私鑰與錯誤密碼；
  尚未使用你的憑證驗證真實行情。
- 現有手機捲動修正保留，不修改正式帳本資料。

## 官方文件

- [AppKey 與簽章](https://open.futunn.com/api/overview/getting-started)
- [Stock Quote](https://open.futunn.com/api/quote/realtime/stock-quote)
