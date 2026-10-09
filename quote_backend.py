"""Futu REST quotes only. No trading, subscriptions, or Yahoo fallback."""
import base64
import json
import math
import re
import secrets
import time
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.parse import urlsplit
from cryptography.hazmat.primitives import serialization
from cryptography.exceptions import UnsupportedAlgorithm
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

HOST = "https://webapi.futunn.com"
PROTOCOL = "futu-tick-v2"
PERIODS = {"NORMAL": "正常盤", "BEFORE": "盤前", "AFTER": "盤後", "OVERNIGHT": "夜盤"}

class QuoteRateLimited(ValueError):
    pass

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward credentials to a redirected host.

def request_json(path, body=None, headers=None):
    if not (path == "/api/v1.0/server-time" or
            re.fullmatch(r"/api/v1\.0/quote/US\.[A-Z][A-Z0-9.\-]{0,19}/rt-ticker\?num=20", path)):
        raise ValueError("僅允許富途唯讀報價端點。")
    if body is not None:
        raise ValueError("逐筆查價僅允許 GET 請求。")
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

def signed_headers(app_key, key, path, timestamp):
    url = urlsplit(path)
    payload = "\n".join((str(timestamp), "GET", url.path, url.query, ""))
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


def fetch_us_quotes(symbols, config=None):
    if not isinstance(symbols, list) or not 1 <= len(symbols) <= 50:
        raise ValueError("一次最多更新 50 個代號。")
    if any(not isinstance(s, str) or not re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,19}", s) for s in symbols):
        raise ValueError("股票代號格式不正確。")
    symbols = list(dict.fromkeys(symbols))
    app_key, key = load_credentials(config or {})
    quotes, errors = {}, {}
    deadline = time.monotonic() + 120
    clock_offset = 0
    stop_reason = None
    for index, symbol in enumerate(symbols):
        if stop_reason or time.monotonic() >= deadline:
            errors[symbol] = stop_reason or "本次查價逾時，保留原價"
            continue
        if index:
            time.sleep(0.3)  # Sequential requests, no concurrent burst or retry storm.
        path = "/api/v1.0/quote/US." + symbol + "/rt-ticker?num=20"
        try:
            timestamp = int(time.time() * 1000) + clock_offset
            result = request_json(path, headers=signed_headers(app_key, key, path, timestamp))
            if result.get("ret_code") == -12006:
                server = request_json("/api/v1.0/server-time")
                stamp = positive_number(server.get("server_time_ms"))
                if stamp is None:
                    raise ValueError("無法校正富途簽章時間；原價不變。")
                clock_offset = int(stamp) - int(time.time() * 1000)
                result = request_json(path, headers=signed_headers(app_key, key, path, int(stamp)))
            if result.get("ret_code") != 0:
                code = result.get("ret_code")
                safe_code = str(code) if isinstance(code, int) else "UNKNOWN"
                raise ValueError("富途逐筆行情未授權或請求失敗（代碼 " + safe_code + "）；不會自動購買行情")
            data = result.get("data")
            if not isinstance(data, dict) or data.get("code") != "US." + symbol:
                raise ValueError("富途逐筆報價代號不符，保留原價")
            quotes[symbol] = select_quote(data.get("ticker_list"))
        except QuoteRateLimited as error:
            stop_reason = str(error)
            errors[symbol] = stop_reason
        except ValueError as error:
            errors[symbol] = str(error)
    return {"quotes": quotes, "errors": errors, "quoteProtocol": PROTOCOL}
