# L1.5.25 富途報價設定

## 已有 AppKey，但出現「不接受未加密私鑰」

不要重新建立 AppKey，也不要執行產生全新金鑰的 futu_key_setup.py。
請使用原本與富途後台公鑰配對的私鑰檔，執行：

```sh
cd "/Users/vision/Documents/Codex/2026-07-15/app-users-vision-documents-codex-2026/stock-ledger-cloud"
python3 -m pip install -r requirements.txt
python3 futu_encrypt_key.py
```

1. 提示路徑時，把原本的私鑰檔拖進終端機，再按 Enter。不是 public.pem。
2. 設定至少 12 字元的私鑰密碼，輸入兩次。輸入時不顯示文字是正常的。
3. 工具將原本金鑰加密成 `.futu-private/existing.encrypted.pem`，原檔與公鑰配對不變。
4. 複製加密檔內容（以下命令不會把內容印到終端機）：

   ```sh
   pbcopy < .futu-private/existing.encrypted.pem
   ```

5. 進入你的 Streamlit Settings → Secrets，只修改既有 `[futu]`：
   `app_key` 保持原值；`private_key_password` 改成第 2 步密碼；
   `private_key_pem` 三引號內的內容整段替換成剪貼簿內容。
   開頭應是 `-----BEGIN ENCRYPTED PRIVATE KEY-----`，不要自行改標頭。
6. 儲存，重新啟動服務。測試完後清空剪貼簿：`pbcopy < /dev/null`。

不需要重新上傳公鑰。不要把金鑰貼到聊天或提交 Git。
若金鑰只存在 Secrets 而沒有本機檔案，先在自己的電腦存成私鑰檔再執行；
不要把 Secrets 畫面截圖傳出。若工具表示不是 Ed25519，先停下，不要覆蓋或刪除原始金鑰。

此版本真正使用富途官方 REST，不使用 OpenD、不需 Mac 常駐、不再呼叫 Yahoo。
按美股 reload 才查價；一次請求包含所有持股代號。只查公開行情，不讀券商持倉、不下單、不購買任何服務。

## 取得 API（AppKey 方式）

1. 在本機專案終端機執行：

   ```sh
   python3 -m pip install -r requirements.txt
   python3 futu_key_setup.py
   ```

   輸入並保管至少 12 字元的私鑰密碼。工具會建立本專案內的 `.futu-private`；
   不會覆蓋舊金鑰，也不會在終端機印出私鑰或密碼。此資料夾已排除 Git。
2. 開啟 [富途開發者後台](https://open.futunn.com/dashboard)，用自己的富途帳號登入。
3. 進入 User Center（用戶中心）建立 AppKey，簽章演算法選 **Ed25519**。
   上傳剛產生的 `.futu-private/public.pem` 公鑰。不要上傳私鑰。
4. 保存後台提供的 AppKey。若可選權限，只選行情查詢，不選交易。
   若帳號沒有 AppKey 入口或行情權限，不要購買、不要把電話號碼當 API Key；需先向富途確認帳戶資格。

## 放到線上 Streamlit（不要貼到 GitHub 或聊天）

打開你自己的 Streamlit 管理介面 → Settings → Secrets。
保留原本的 app 與其他設定，在最後另加：

```toml
[futu]
app_key = "富途後台提供的AppKey"
private_key_password = "剛才設定的私鑰密碼"
private_key_pem = """
-----BEGIN ENCRYPTED PRIVATE KEY-----
將 private.encrypted.pem 的內容完整貼在這裡
-----END ENCRYPTED PRIVATE KEY-----
"""
```

注意 PEM 開頭結尾只留一組；整份複製取代範例內容。密碼若包含引號或反斜線，
請按 TOML 規則跳脫。不要刪除原本 Secrets。儲存設定並重新啟動服務。
本機測試可將相同設定放入已被 Git 忽略的 `.streamlit/secrets.toml`。

AppKey、加密私鑰及其密碼均只在 Streamlit 伺服器使用，HTML 和 JavaScript 不會收到。
沒有設定時，reload 明確顯示「尚未設定富途」，不退回 Yahoo。

## 盤別及驗證

- 富途端點：POST `https://webapi.futunn.com/api/v1.0/quote/stock-quote`。
- 一次帶入 `code_list`，例如 `US.BITU`、`US.EPP`、`US.IVV`。
- 依官方欄位使用有效的盤前／盤後／夜盤價，否則用正常盤價；顯示富途提供的資料時間，不冒充按鈕點擊時間。
- 官方說非當前盤別欄位為 0。若實際回應同時出現多個盤別又沒有各自時間，本版不猜最新價，保留原價。
- 權限不足、無效代號、錯誤資料只保留原价，不會把 0 寫入持股。
- 這次交付的自動測試使用假資料及臨時測試金鑰；尚未用你的 AppKey 驗證真實報價。
- 正式帳本尚未操作、尚未推送。設定完成後應先用不連雲端儲存的測試副本核對報價與盤別。

富途平台表示 API 無額外費用，但即時行情仍受帳戶權限／所在地／當時政策限制；
本程式沒有訂購或付費路徑，也不會自動開通收費行情。

## 官方依據

- [REST 與 AppKey 簽章流程](https://open.futunn.com/api/overview/getting-started)
- [Stock Quote 欄位](https://open.futunn.com/api/quote/realtime/stock-quote)
- [富途平台與費用說明](https://open.futunn.com/)
