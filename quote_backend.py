"""Read-only Yahoo quotes. No credentials, orders, or paid fallback."""
import math
import re
from datetime import datetime, timezone
import yfinance as yf


def fetch_us_quotes(symbols):
    if not isinstance(symbols, list) or not 1 <= len(symbols) <= 50:
        raise ValueError("一次最多更新 50 個代號。")
    symbols = list(dict.fromkeys(symbols))
    if any(not isinstance(s, str) or not re.fullmatch(r"[A-Z][A-Z0-9.\-^=]{0,19}", s) for s in symbols):
        raise ValueError("股票代號格式不正確。")
    quotes, errors = {}, {}
    for symbol in symbols:
        try:
            # Five days covers weekends/holidays. Last available minute, not a
            # promise of consolidated real-time trade data.
            ticker = yf.Ticker(symbol.replace(".", "-"))
            bars = ticker.history(period="5d", interval="1m", prepost=True, auto_adjust=False, timeout=10)
            if bars.empty:
                raise ValueError("查無報價")
            meta = ticker.history_metadata
            if meta.get("currency") != "USD":
                raise ValueError("非美元報價")
            bars = bars.dropna(subset=["Close"])
            row = bars.iloc[-1]
            price = float(row["Close"])
            timestamp = bars.index[-1].to_pydatetime()
            if not math.isfinite(price) or price <= 0 or timestamp.tzinfo is None:
                raise ValueError("報價無效")
            if (datetime.now(timezone.utc) - timestamp).total_seconds() > 7 * 86400:
                raise ValueError("報價超過七天")
            quotes[symbol] = {"price": price, "time": timestamp.isoformat(), "currency": "USD"}
        except Exception:
            errors[symbol] = "查價失敗或受限，保留原價"
    return {"quotes": quotes, "errors": errors}
