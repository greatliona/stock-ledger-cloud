"""Read-only Yahoo quotes with explicit overnight coverage."""
import math
import re
from datetime import datetime, timezone
import yfinance as yf

SESSIONS = {"regular": "正常盤", "pre": "盤前", "post": "盤後", "overnight": "夜盤"}

def select_quote(rows, now=None):
    now = now or datetime.now(timezone.utc).timestamp()
    candidates = []
    overnight = any(r.get("marketState") == "OVERNIGHT" for r in rows)
    for row in rows:
        if row.get("currency") != "USD":
            continue
        for prefix, label in SESSIONS.items():
            price, stamp = row.get(prefix + "MarketPrice"), row.get(prefix + "MarketTime")
            if isinstance(price, bool) or isinstance(stamp, bool):
                continue
            try:
                price, stamp = float(price), float(stamp)
            except (TypeError, ValueError):
                continue
            if not math.isfinite(price) or price <= 0 or not math.isfinite(stamp):
                continue
            if not -60 <= now - stamp <= 7 * 86400:
                continue
            candidates.append((stamp, price, label))
    if not candidates:
        raise ValueError("無有效報價，保留原價")
    stamp, price, label = max(candidates, key=lambda item: item[0])
    # Never overwrite newer manually entered overnight prices with old quotes.
    if overnight and (label != "夜盤" or now - stamp > 15 * 60):
        raise ValueError("未取得近 15 分鐘夜盤報價，保留原價")
    return {"price": price, "time": datetime.fromtimestamp(stamp, timezone.utc).isoformat(),
            "currency": "USD", "session": label}

def fetch_us_quotes(symbols):
    if not isinstance(symbols, list) or not 1 <= len(symbols) <= 50:
        raise ValueError("一次最多更新 50 個代號。")
    if any(not isinstance(s, str) or not re.fullmatch(r"[A-Z][A-Z0-9.\-^=]{0,19}", s) for s in symbols):
        raise ValueError("股票代號格式不正確。")
    symbols = list(dict.fromkeys(symbols))
    quotes, errors = {}, {}
    client = yf.Ticker(symbols[0])._data
    for start in range(0, len(symbols), 10):
        batch = symbols[start:start + 10]
        rows = {s: [] for s in batch}
        complete = True
        # Overnight mode may omit pre/post fields, so request both snapshots.
        for overnight in ("false", "true"):
            try:
                data = client.get_raw_json("https://query1.finance.yahoo.com/v7/finance/quote",
                    params={"symbols": ",".join(s.replace(".", "-") for s in batch),
                            "formatted": "false", "overnightPrice": overnight}, timeout=15)
                result = data["quoteResponse"]["result"]
                for symbol in batch:
                    rows[symbol].extend(r for r in result if r.get("symbol") == symbol.replace(".", "-"))
            except Exception:
                complete = False
        for symbol in batch:
            try:
                if not complete:
                    raise ValueError("查價不完整，保留原價")
                quotes[symbol] = select_quote(rows[symbol])
            except ValueError as error:
                errors[symbol] = str(error)
    return {"quotes": quotes, "errors": errors}
