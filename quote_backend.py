"""Futu REST quotes only. No trading, subscriptions, or Yahoo fallback."""
import base64
import hashlib
import json
import math
import re
import secrets
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.parse import urlsplit
from cryptography.hazmat.primitives import serialization
from cryptography.exceptions import UnsupportedAlgorithm
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

HOST = "https://webapi.futunn.com"
PROTOCOL = "futu-smart-v4"
PERIODS = {"NORMAL": "正常盤", "BEFORE": "盤前", "AFTER": "盤後", "OVERNIGHT": "夜盤"}

class QuoteRateLimited(ValueError):
    pass

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward credentials to a redirected host.

def request_json(path, body=None, headers=None):
    post_paths = {"/api/v1.0/quote/stock-quote", "/api/v1.0/quote/market-state", "/api/v1.0/quote/order-book"}
    is_get = (path == "/api/v1.0/server-time" or
        re.fullmatch(r"/api/v1\.0/quote/US\.[A-Z][A-Z0-9.\-]{0,19}/rt-ticker\?num=20&period=(NORMAL|BEFORE|AFTER|OVERNIGHT)", path) or
        re.fullmatch(r"/api/v1\.0/quote/US\.[A-Z][A-Z0-9.\-]{0,19}/rt-data\?request_section=(NORMAL|FULL|PREMARKET|AFTERHOURS|OVERNIGHT)", path))
    if not (is_get or path in post_paths):
        raise ValueError("僅允許富途唯讀報價端點。")
    if (is_get and body is not None) or (path in post_paths and body is None):
        raise ValueError("報價端點請求方法不符。")
    request = Request(HOST + path, data=body, headers=headers or {},
                      method="POST" if body is not None else "GET")
    try:
        with build_opener(NoRedirect()).open(request, timeout=15) as response:
            result = json.loads(response.read(2_000_000))
    except HTTPError as error:
        if error.code == 429:
            raise QuoteRateLimited("富途暫時限流，已停止本次剩餘請求；未取得報價的原價不變。") from None
        messages = {401: "富途授權失敗，請檢查 AppKey 與金鑰配對。",
                    403: "富途未授予行情權限；不會自動購買服務。",
                    429: "富途請求額度暫時受限；原價不變。"}
        raise ValueError(messages.get(error.code, f"富途服務回應 HTTP {error.code}；原價不變。")) from None
    except (URLError, TimeoutError, OSError):
        raise ValueError("無法連線富途報價服務；原價不變。") from None
    except (ValueError, UnicodeError):
        raise ValueError("富途回傳格式無效；原價不變。") from None
    if not isinstance(result, dict):
        raise ValueError("富途回傳格式無效；原價不變。")
    return result

def load_credentials(config):
    app_key = config.get("app_key", "")
    pem = config.get("private_key_pem", "")
    password = config.get("private_key_password", "")
    if not all(isinstance(v, str) and v.strip() for v in (app_key, pem)):
        raise ValueError("尚未設定富途：請在 Streamlit Secrets 的 [futu] 填入 AppKey ID 與私鑰；未加密私鑰不需密碼。")
    app_key, pem = app_key.strip(), pem.strip()
    try:
        if pem.startswith("-----BEGIN"):
            raw, loader = pem.encode(), serialization.load_pem_private_key
        else:
            # Accept the full Base64 PKCS#8 text too; never infer a raw seed.
            raw = base64.b64decode("".join(pem.split()), validate=True)
            loader = serialization.load_der_private_key
    except (ValueError, UnicodeError):
        raise ValueError("富途私鑰格式無效；請貼完整 PEM 或 Base64 私鑰，不是公鑰或檔案路徑。") from None
    try:
        # Unencrypted keys work even if an obsolete password placeholder remains.
        key = loader(raw, password=None)
    except TypeError:
        if not isinstance(password, str) or not password:
            raise ValueError("這把私鑰已加密，才需要 private_key_password；請填加密時使用的密碼。") from None
        try:
            key = loader(raw, password=password.encode())
        except (ValueError, TypeError, UnsupportedAlgorithm):
            raise ValueError("富途私鑰或解密密碼無效；原價不變。") from None
    except (ValueError, UnsupportedAlgorithm):
        raise ValueError("富途私鑰無效；請貼完整 Ed25519 私鑰，不是公鑰或檔案路徑。") from None
    if not isinstance(key, Ed25519PrivateKey):
        raise ValueError("此版本使用 Ed25519；請在富途 AppKey 選擇相同演算法。")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,256}", app_key):
        raise ValueError("富途 AppKey 格式無效。")
    return app_key, key

def signed_headers(app_key, key, path, timestamp, body=None):
    url = urlsplit(path)
    payload = "\n".join((str(timestamp), "POST" if body is not None else "GET", url.path, url.query,
                         hashlib.sha256(body).hexdigest() if body is not None else ""))
    return {"Content-Type": "application/json", "X-Api-Key": app_key,
            "X-Timestamp": str(timestamp), "X-Nonce": secrets.token_urlsafe(24),
            "Authorization": base64.b64encode(key.sign(payload.encode())).decode()}

def positive_number(value):
    if isinstance(value, bool):
        return None
    try:
        value = float(value)
        return value if math.isfinite(value) and value > 0 else None
    except (ValueError, TypeError):
        return None

def select_quote(rows, now=None):
    """Choose by actual trade time across all sessions; never label snapshot time as a trade."""
    now = time.time() if now is None else now
    if not isinstance(rows, list):
        raise ValueError("富途缺少逐筆成交資料，保留原價")
    candidates = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        price = positive_number(row.get("price"))
        stamp = positive_number(row.get("time"))
        session = PERIODS.get(row.get("period_type"))
        # Cancelled US prints are not a usable last price.
        if str(row.get("trade_type") or "").strip() == "U":
            continue
        if price is None or stamp is None or not session:
            continue
        if not -60 <= now - stamp / 1000 <= 7 * 86400:
            continue
        candidates.append((stamp, price, session))
    if not candidates:
        raise ValueError("未取得有效最新成交，保留原價")
    stamp, price, session = max(candidates, key=lambda item: item[0])
    return {"price": price, "time": datetime.fromtimestamp(stamp / 1000, timezone.utc).isoformat(),
            "currency": "USD", "session": session, "source": "Futu", "timeKind": "trade"}


MARKET_PERIOD = {
    "MORNING": "NORMAL", "AFTERNOON": "NORMAL",
    "PRE_MARKET_BEGIN": "BEFORE", "AFTER_HOURS_BEGIN": "AFTER",
    "NIGHT_OPEN": "OVERNIGHT",
    "PRE_MARKET_END": "BEFORE", "AFTER_HOURS_END": "AFTER", "NIGHT_END": "OVERNIGHT",
}
SECTIONS = {"NORMAL": "NORMAL", "BEFORE": "PREMARKET", "AFTER": "AFTERHOURS", "OVERNIGHT": "OVERNIGHT"}
SECTION_PERIOD = {"US_REGULAR": "NORMAL", "REGULAR": "NORMAL", "US_PREMARKET": "BEFORE",
                  "US_AFTERHOURS": "AFTER", "US_OVERNIGHT": "OVERNIGHT"}


def minute_quote(data, symbol, section, now):
    if not isinstance(data, dict) or not isinstance(data.get("section_list"), list):
        raise ValueError("分時資料缺漏")
    rows = []
    allowed = {"NORMAL", "BEFORE", "AFTER"} if section == "FULL" else {p for p, s in SECTIONS.items() if s == section}
    for segment in data["section_list"]:
        if not isinstance(segment, dict) or segment.get("code") != "US." + symbol:
            continue
        period = SECTION_PERIOD.get(segment.get("trade_section"))
        if period not in allowed or not isinstance(segment.get("point_list"), list):
            continue
        for point in segment["point_list"]:
            # No-volume fill-forward minutes must not manufacture a fresh trade.
            if isinstance(point, dict) and positive_number(point.get("volume")):
                rows.append({"time": point.get("time"), "price": point.get("cur_price"), "period_type": period})
    quote = select_quote(rows, now)
    quote["timeKind"] = "minute"
    return quote


def regular_snapshot(row, now):
    if not isinstance(row, dict):
        raise ValueError("正常盤報價缺漏")
    stamp = positive_number(row.get("data_time"))
    if not stamp:
        raise ValueError("正常盤報價缺少交易所時間")
    ny = ZoneInfo("America/New_York")
    dt = datetime.fromtimestamp(stamp / 1000, ny)
    current = datetime.fromtimestamp(now, ny)
    # Use last_price only while market-state says regular, and only for this
    # regular trading date. Never attach this timestamp to extended subobjects.
    if dt.date() != current.date() or not 570 <= dt.hour * 60 + dt.minute <= 960:
        raise ValueError("不是當日正常盤報價")
    quote = select_quote([{"time": stamp, "price": row.get("last_price"), "period_type": "NORMAL"}], now)
    quote["timeKind"] = "quote"
    return quote


def fetch_us_quotes(symbols, config=None):
    if not isinstance(symbols, list) or not 1 <= len(symbols) <= 50:
        raise ValueError("一次最多更新 50 個代號。")
    if any(not isinstance(s, str) or not re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,19}", s) for s in symbols):
        raise ValueError("股票代號格式不正確。")
    symbols = list(dict.fromkeys(symbols))
    app_key, key = load_credentials(config or {})
    quotes, errors, warnings = {}, {}, {}
    deadline = time.monotonic() + 120
    clock_offset, count, stopped = 0, 0, None

    def now():
        return time.time() + clock_offset / 1000

    def call(path, payload=None):
        nonlocal clock_offset, count, stopped
        if stopped:
            raise QuoteRateLimited(stopped)
        if time.monotonic() >= deadline:
            raise ValueError("本次查價逾時")
        if count:
            time.sleep(0.3)
        count += 1
        body = json.dumps(payload, separators=(",", ":")).encode() if payload is not None else None
        try:
            result = request_json(path, body=body, headers=signed_headers(app_key, key, path, int(now()*1000), body))
            if result.get("ret_code") == -12006:
                server = request_json("/api/v1.0/server-time")
                stamp = positive_number(server.get("server_time_ms"))
                if not stamp:
                    raise ValueError("無法校正富途簽章時間")
                clock_offset = int(stamp) - int(time.time()*1000)
                result = request_json(path, body=body, headers=signed_headers(app_key, key, path, int(stamp), body))
        except QuoteRateLimited as error:
            stopped = str(error)
            raise
        if result.get("ret_code") != 0:
            code = result.get("ret_code")
            raise ValueError("富途請求失敗（代碼 " + (str(code) if isinstance(code, int) else "UNKNOWN") + "）")
        return result.get("data")

    codes = ["US." + s for s in symbols]
    states, snapshots = {}, {}
    state_error = None
    try:
        data = call("/api/v1.0/quote/market-state", {"code_list": codes})
        if not isinstance(data, dict) or not isinstance(data.get("market_state_list"), list):
            raise ValueError("市場狀態缺漏")
        states = {r["code"]: r.get("market_state") for r in data["market_state_list"]
                  if isinstance(r, dict) and r.get("code") in codes}
    except ValueError as error:
        state_error = str(error)

    regular = [c for c in codes if states.get(c) in ("MORNING", "AFTERNOON")]
    if regular:
        try:
            data = call("/api/v1.0/quote/stock-quote", {"code_list": regular})
            if isinstance(data, dict) and isinstance(data.get("quote_list"), list):
                snapshots = {r["code"]: r for r in data["quote_list"]
                             if isinstance(r, dict) and r.get("code") in regular}
        except ValueError:
            pass  # Per-symbol read-only fallback below; a 429 remains latched.

    for symbol in symbols:
        code = "US." + symbol
        period = MARKET_PERIOD.get(states.get(code))
        candidate, issues = None, []
        try:
            if code in regular:
                try:
                    candidate = regular_snapshot(snapshots.get(code), now())
                except ValueError:
                    pass
            elif period:
                data = call("/api/v1.0/quote/" + code + "/rt-ticker?num=20&period=" + period)
                if not isinstance(data, dict) or data.get("code") != code:
                    raise ValueError("逐筆報價代號不符")
                ticks = data.get("ticker_list") or []
                if not isinstance(ticks, list) or any(not isinstance(t, dict) or t.get("period_type") != period for t in ticks):
                    raise ValueError("逐筆回傳盤別不符")
                candidate = select_quote(ticks, now())
        except ValueError as error:
            issues.append(str(error))

        age = now() - datetime.fromisoformat(candidate["time"]).timestamp() if candidate else float("inf")
        if age >= 300:
            # Only missing/old symbols need an additional independent price source.
            sections = [SECTIONS[period]] if period else ["FULL", "OVERNIGHT"]
            for section in sections:
                try:
                    other = minute_quote(call("/api/v1.0/quote/" + code + "/rt-data?request_section=" + section), symbol, section, now())
                    if candidate is None or other["time"] > candidate["time"]:
                        candidate = other
                except ValueError as error:
                    issues.append(str(error))

        if candidate:
            age = max(0, int(now() - datetime.fromisoformat(candidate["time"]).timestamp()))
            candidate.update(ageSeconds=age, checkedPeriods=[period] if period else [p for p, label in PERIODS.items() if label == candidate["session"]])
            quotes[symbol] = candidate
            if age >= 300:
                # A diagnostic only: never use bid/ask or dispatch time as last price.
                detail = "供應商最新可用價已距今 " + str(age // 60) + " 分鐘"
                try:
                    book_data = call("/api/v1.0/quote/order-book", {"code": code, "num": 1})
                    stamps = [positive_number(b.get("exchange_data_time_ms")) for r in (book_data if isinstance(book_data, list) else [])
                              if isinstance(r, dict) and r.get("code") == code for b in (r.get("books") or []) if isinstance(b, dict)]
                    stamps = [s for s in stamps if s and -60 <= now()-s/1000 <= 7*86400]
                    if stamps:
                        book_age = max(0, int(now()-max(stamps)/1000))
                        detail += "；買賣報價距今 " + str(book_age) + " 秒（未當成交價套用）"
                except ValueError:
                    pass
                warnings[symbol] = detail + "；尚不能判定延遲原因"
            elif not period:
                warnings[symbol] = "市場狀態不明，採最新可用分時價"
        else:
            errors[symbol] = stopped or (issues[-1] if issues else state_error or "無有效報價") + "；保留原價"
    return {"quotes": quotes, "errors": errors, "warnings": warnings, "quoteProtocol": PROTOCOL}
