"""Futu REST quotes only. No trading, subscriptions, or Yahoo fallback."""
import base64
import calendar
import hashlib
import json
import math
import re
import secrets
import time
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.parse import urlsplit
from cryptography.hazmat.primitives import serialization
from cryptography.exceptions import UnsupportedAlgorithm
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

HOST = "https://webapi.futunn.com"
PROTOCOL = "futu-snapshot-v5"
PERIODS = {"NORMAL": "正常盤", "BEFORE": "盤前", "AFTER": "盤後", "OVERNIGHT": "夜盤"}
REQUEST_TIMEOUT_SECONDS = 6
QUOTE_BUDGET_SECONDS = 25

class QuoteRateLimited(ValueError):
    pass

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward credentials to a redirected host.

def request_json(path, body=None, headers=None, timeout=REQUEST_TIMEOUT_SECONDS):
    post_paths = {"/api/v1.0/quote/stock-quote", "/api/v1.0/quote/snapshot"}
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
        with build_opener(NoRedirect()).open(request, timeout=timeout) as response:
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


SECTIONS = {"NORMAL": "NORMAL", "BEFORE": "PREMARKET", "AFTER": "AFTERHOURS", "OVERNIGHT": "OVERNIGHT"}
SECTION_PERIOD = {"US_REGULAR": "NORMAL", "REGULAR": "NORMAL", "US_PREMARKET": "BEFORE",
                  "US_AFTERHOURS": "AFTER", "US_OVERNIGHT": "OVERNIGHT"}


def nth_weekday(year, month, weekday, index):
    first = date(year, month, 1)
    return first + timedelta(days=(weekday - first.weekday()) % 7 + 7 * (index - 1))


def observed_holiday(day, saturday_observed=True):
    if day.weekday() == 5 and saturday_observed:
        return day - timedelta(days=1)
    return day + timedelta(days=1) if day.weekday() == 6 else day


def easter_sunday(year):
    # Gregorian computus; Good Friday is an NYSE holiday.
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    f, g = (b + 8) // 25, (b - (b + 8) // 25 + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    return date(year, month, (h + l - 7 * m + 114) % 31 + 1)


def nyse_holiday(day):
    year = day.year
    fixed = [observed_holiday(date(year, 1, 1), False),
             observed_holiday(date(year + 1, 1, 1), False),
             observed_holiday(date(year, 6, 19)), observed_holiday(date(year, 7, 4)),
             observed_holiday(date(year, 12, 25))]
    memorial = date(year, 5, calendar.monthrange(year, 5)[1])
    return day in {*fixed,
                   nth_weekday(year, 1, 0, 3), nth_weekday(year, 2, 0, 3),
                   easter_sunday(year) - timedelta(days=2),
                   memorial - timedelta(days=(memorial.weekday() - 0) % 7),
                   nth_weekday(year, 9, 0, 1), nth_weekday(year, 11, 3, 4)}


def nyse_early_close(day):
    thanksgiving = nth_weekday(day.year, 11, 3, 4)
    return day == thanksgiving + timedelta(days=1) or (
        day in (date(day.year, 7, 3), date(day.year, 12, 24))
        and day.weekday() < 5 and not nyse_holiday(day))


def us_market_period(timestamp):
    """Expected U.S. equity session from New York wall time, including DST."""
    local = datetime.fromtimestamp(timestamp, ZoneInfo("America/New_York"))
    day, minute = local.date(), local.hour * 60 + local.minute
    if 0 <= minute < 240 and day.weekday() < 5 and not nyse_holiday(day):
        return "OVERNIGHT"
    if minute >= 1200 and day.weekday() in (6, 0, 1, 2, 3):
        next_day = day + timedelta(days=1)
        return "OVERNIGHT" if not nyse_holiday(next_day) else None
    if day.weekday() >= 5 or nyse_holiday(day):
        return None
    if 240 <= minute < 570:
        return "BEFORE"
    early = nyse_early_close(day)
    close = 780 if early else 960
    if 570 <= minute < close:
        return "NORMAL"
    if close <= minute < (1020 if early else 1200):
        return "AFTER"
    return None


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
    # Use last_price only while the New York clock says regular, and only for this
    # regular trading date. Never attach this timestamp to extended subobjects.
    if dt.date() != current.date() or not 570 <= dt.hour * 60 + dt.minute <= 960:
        raise ValueError("不是當日正常盤報價")
    quote = select_quote([{"time": stamp, "price": row.get("last_price"), "period_type": "NORMAL"}], now)
    quote["timeKind"] = "quote"
    return quote


def extended_snapshot(row, period, now):
    if not isinstance(row, dict) or row.get("index_valid") is True:
        return None
    fields = {"BEFORE": "pre_price", "AFTER": "after_price", "OVERNIGHT": "overnight_price"}
    field = fields.get(period)
    price = positive_number(row.get(field)) if field else None
    if price is None:
        return None
    # The snapshot has no independent session trade timestamp. Never borrow
    # update_time/data_time from the regular quote or manufacture a trade time.
    return {"price": price, "time": None, "ageSeconds": None, "currency": "USD",
            "session": PERIODS[period], "source": "Futu", "timeKind": "sessionSnapshot",
            "priceField": field, "checkedPeriods": [period],
            "fetchedAt": datetime.fromtimestamp(now, timezone.utc).isoformat()}


def fetch_us_quotes(symbols, config=None):
    if not isinstance(symbols, list) or not 1 <= len(symbols) <= 50:
        raise ValueError("一次最多更新 50 個代號。")
    if any(not isinstance(s, str) or not re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,19}", s) for s in symbols):
        raise ValueError("股票代號格式不正確。")
    symbols = list(dict.fromkeys(symbols))
    app_key, key = load_credentials(config or {})
    quotes, errors, warnings = {}, {}, {}
    deadline = time.monotonic() + QUOTE_BUDGET_SECONDS
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
            time.sleep(min(0.3, max(0, deadline - time.monotonic())))
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise ValueError("本次查價逾時")
        count += 1
        body = json.dumps(payload, separators=(",", ":")).encode() if payload is not None else None
        try:
            result = request_json(path, body=body, headers=signed_headers(app_key, key, path, int(now()*1000), body),
                                  timeout=min(REQUEST_TIMEOUT_SECONDS, remaining))
            if result.get("ret_code") == -12006:
                server = request_json("/api/v1.0/server-time", timeout=min(REQUEST_TIMEOUT_SECONDS, max(0.1, deadline-time.monotonic())))
                stamp = positive_number(server.get("server_time_ms"))
                if not stamp:
                    raise ValueError("無法校正富途簽章時間")
                clock_offset = int(stamp) - int(time.time()*1000)
                result = request_json(path, body=body, headers=signed_headers(app_key, key, path, int(stamp), body),
                                      timeout=min(REQUEST_TIMEOUT_SECONDS, max(0.1, deadline-time.monotonic())))
        except QuoteRateLimited as error:
            stopped = str(error)
            raise
        if result.get("ret_code") != 0:
            code = result.get("ret_code")
            raise ValueError("富途請求失敗（代碼 " + (str(code) if isinstance(code, int) else "UNKNOWN") + "）")
        return result.get("data")

    codes = ["US." + s for s in symbols]
    period = us_market_period(now())
    regular = codes if period == "NORMAL" else []
    snapshots = {}
    if regular:
        try:
            data = call("/api/v1.0/quote/stock-quote", {"code_list": regular})
            if isinstance(data, dict) and isinstance(data.get("quote_list"), list):
                snapshots = {r["code"]: r for r in data["quote_list"]
                             if isinstance(r, dict) and r.get("code") in regular}
        except ValueError:
            pass  # Per-symbol read-only fallback below; a 429 remains latched.

    extended = [] if regular else codes
    session_snapshots = {}
    snapshot_error = None
    if extended:
        try:
            data = call("/api/v1.0/quote/snapshot", {"code_list": extended})
            if isinstance(data, dict) and isinstance(data.get("snapshot_list"), list):
                session_snapshots = {r["code"]: r for r in data["snapshot_list"]
                                     if isinstance(r, dict) and r.get("code") in extended}
        except ValueError as error:
            snapshot_error = str(error)

    for symbol in symbols:
        code = "US." + symbol
        candidate, issues = None, []
        if code in extended:
            candidate = extended_snapshot(session_snapshots.get(code), period, now())
            if candidate:
                quotes[symbol] = candidate
                continue
            field = {"BEFORE":"pre_price", "AFTER":"after_price", "OVERNIGHT":"overnight_price"}.get(period)
            row = session_snapshots.get(code)
            if snapshot_error:
                issues.append("快照：" + snapshot_error)
            elif row is None:
                issues.append("快照未回傳此代號")
            elif field:
                value = row.get(field)
                reason = "缺漏" if value is None else "為零" if value == 0 else "無效"
                issues.append(PERIODS[period] + "價格欄位" + reason)
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
                warnings[symbol] = "供應商最新可用價已距今 " + str(age // 60) + " 分鐘；尚不能判定延遲原因"
            elif not period:
                warnings[symbol] = "非一般交易時段，採最新可用分時價"
        else:
            errors[symbol] = stopped or "；".join(dict.fromkeys(issues)) or "無有效報價"
    return {"quotes": quotes, "errors": errors, "warnings": warnings, "quoteProtocol": PROTOCOL}
