# 股票記帳本雲端版

這是股票記帳本 V1.0.1 的 Streamlit Cloud + Supabase 同步版本。

部署時需要在 Streamlit Cloud 的 Secrets 裡加入：

```toml
[supabase]
url = "你的 Supabase Project URL"
anon_key = "你的 Supabase anon key"
table = "stock_ledger_state"
row_id = "main"
```
