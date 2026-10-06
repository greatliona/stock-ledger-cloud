"""Read-only Yahoo quotes with explicit overnight coverage."""
import math
import re
import logging
from datetime import datetime, timezone
import yfinance as yf

SESSIONS = {"regular": "正常盤", "pre": "盤前", "post": "盤後", "overnight": "夜盤"}

def request_snapshot(client, batch, overnight):
    last_code = "NETWORK"
    for host in ("query1.finance.yahoo.com", "query2.finance.yahoo.com"):
        try:
            data = client.get_raw_json("https://" + host + "/v7/finance/quote",
                params={"symbols": ",".join(s.replace(".", "-") for s in batch),
                        "formatted": "false", "overnightPrice": overnight}, timeout=10)
            response = data.get("quoteResponse", {})
            if response.get("error") or not isinstance(response.get("result"), list):
                raise ValueError("Invalid quote response")
            return response["result"]
        except Exception as error:
            status = getattr(getattr(error, "response", None), "status_code", None)
            name = type(error).__name__
            last_code = "HTTP_" + str(status) if status else name
            # Do not log response URLs, cookies, crumbs, or account data.
            logging.getLogger(__name__).warning("Yahoo quote failed: host=%s mode=%s code=%s", host, overnight, last_code)
            if status == 429 or "RateLimit" in name:
                break
    raise ValueError("Yahoo 查詢失敗（" + last_code + "），未更新")

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
        overnight_error = None
        # Overnight mode may omit pre/post fields, so request both snapshots.
        for overnight in ("true", "false"):
            try:
                result = request_snapshot(client, batch, overnight)
                for symbol in batch:
                    rows[symbol].extend(r for r in result if r.get("symbol") == symbol.replace(".", "-"))
            except ValueError as error:
                if overnight == "true":
                    overnight_error = str(error)
                    break
        for symbol in batch:
            try:
                if overnight_error:
                    raise ValueError(overnight_error)
                quotes[symbol] = select_quote(rows[symbol])
            except ValueError as error:
                errors[symbol] = str(error)
    return {"quotes": quotes, "errors": errors, "quoteProtocol": "overnight-v1"}
