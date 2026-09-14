# 股票記帳本雲端版

## L1.5.8 新增列精簡

- 台股、美股、基金、合約的新增按鈕統一顯示 `+`。
- 多空選單移至 `+` 左側，台股與美股輸入列不再因方向選單增加一行。

## L1.5.7 個股做空

- 新增台股、美股時可選擇做多或做空；舊資料預設做多。
- 空單代號後顯示 `(short)`，損益為（建倉價 − 現價／平倉價）× 股數；美股依帳本匯率換算台幣。
- 空單在持股總額、每日結帳和配置圖採「建倉名目金額＋未實現損益」的簡化帳面價值，不代表券商保證金權益；不含借券費、手續費或稅。
- 交易紀錄沿用原有買入／賣出欄位；空單分別代表建倉／回補日期及價格。匯出 Excel 保留空單標記及反向損益。
- 回歸測試：`node short-position.test.cjs`。

這是股票記帳本 V1.0.1 的 Streamlit Cloud + Supabase 同步版本。

部署時需要在 Streamlit Cloud 的 Secrets 裡加入：

```toml
[app]
password = "請換成你自己的登入密碼"

[supabase]
url = "你的 Supabase Project URL"
anon_key = "你的 Supabase anon key"
table = "stock_ledger_state"
row_id = "main"
```
