"""Futu REST quotes only. No trading, subscriptions, or Yahoo fallback."""
import base64
import hashlib
import json
import math
import re
import secrets
import time
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener, HTTPRedirectHandler
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

HOST = "https://webapi.futunn.com"
QUOTE_PATH = "/api/v1.0/quote/stock-quote"
PROTOCOL = "futu-v1"

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward credentials to a redirected host.

def request_json(path, body=None, headers=None):
    if path not in (QUOTE_PATH, "/api/v1.0/server-time"):
        raise ValueError("僅允許富途唯讀報價端點。")
    request = Request(HOST + path, data=body, headers=headers or {},
                      method="POST" if body is not None else "GET")
    try:
        with build_opener(NoRedirect()).open(request, timeout=15) as response:
            result = json.loads(response.read(2_000_000))
    except HTTPError as error:
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
    if not all(isinstance(v, str) and v.strip() for v in (app_key, pem, password)):
        raise ValueError("尚未設定富途：請依 FUTU_SETUP.md 將 AppKey、加密私鑰與私鑰密碼填入 Streamlit Secrets 的 [futu]。")
    if "ENCRYPTED PRIVATE KEY" not in pem:
        raise ValueError("請使用加密的富途私鑰，不接受未加密私鑰。")
    try:
        key = serialization.load_pem_private_key(pem.encode(), password=password.encode())
    except (ValueError, TypeError):
        raise ValueError("富途私鑰或解密密碼無效；原價不變。") from None
    if not isinstance(key, Ed25519PrivateKey):
        raise ValueError("此版本使用 Ed25519；請在富途 AppKey 選擇相同演算法。")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,256}", app_key):
        raise ValueError("富途 AppKey 格式無效。")
    return app_key, key

def signed_headers(app_key, key, body, timestamp):
    payload = "\n".join((str(timestamp), "POST", QUOTE_PATH, "", hashlib.sha256(body).hexdigest()))
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

def select_quote(row, now=None):
    now = time.time() if now is None else now
    stamp = positive_number(row.get("data_time"))
    if stamp is None or not -60 <= now - stamp / 1000 <= 7 * 86400:
        raise ValueError("報價時間無效或過舊，保留原價")
    # Official contract: inactive session objects contain zero.
    sessions = []
    for field, label in (("pre_market", "盤前"), ("after_market", "盤後"), ("overnight", "夜盤")):
        data = row.get(field) or {}
        if not isinstance(data, dict):
            raise ValueError("盤別資料無效，保留原價")
        price = positive_number(data.get("price"))
        if price is not None:
            sessions.append((price, label))
    if len(sessions) > 1:
        raise ValueError("富途回傳多個盤別但無獨立時間，無法確定最新價，保留原價")
    price, session = sessions[0] if sessions else (positive_number(row.get("last_price")), "正常盤")
    if price is None:
        raise ValueError("無有效報價，保留原價")
    return {"price": price, "time": datetime.fromtimestamp(stamp / 1000, timezone.utc).isoformat(),
            "currency": "USD", "session": session, "source": "Futu"}

def fetch_us_quotes(symbols, config=None):
    if not isinstance(symbols, list) or not 1 <= len(symbols) <= 50:
        raise ValueError("一次最多更新 50 個代號。")
    if any(not isinstance(s, str) or not re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,19}", s) for s in symbols):
        raise ValueError("股票代號格式不正確。")
    symbols = list(dict.fromkeys(symbols))
    app_key, key = load_credentials(config or {})
    body = json.dumps({"code_list": ["US." + s for s in symbols]}, separators=(",", ":")).encode()
    result = request_json(QUOTE_PATH, body, signed_headers(app_key, key, body, int(time.time() * 1000)))
    if result.get("ret_code") == -12006:
        server = request_json("/api/v1.0/server-time")
        stamp = positive_number(server.get("server_time_ms"))
        if stamp is None:
            raise ValueError("無法校正富途簽章時間；原價不變。")
        result = request_json(QUOTE_PATH, body, signed_headers(app_key, key, body, int(stamp)))
    if result.get("ret_code") != 0:
        code = result.get("ret_code")
        safe_code = str(code) if isinstance(code, int) else "UNKNOWN"
        raise ValueError("富途拒絕報價請求（代碼 " + safe_code + "）；請核對 AppKey／行情權限，原價不變，不會購買服務。")
    data = result.get("data")
    rows = data.get("quote_list") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        raise ValueError("富途缺少 quote_list；原價不變。")
    by_code = {row.get("code"): row for row in rows if isinstance(row, dict) and isinstance(row.get("code"), str)}
    quotes, errors = {}, {}
    for symbol in symbols:
        row = by_code.get("US." + symbol)
        if row is None:
            errors[symbol] = "富途未回傳此代號，請確認代號及行情權限"
            continue
        try:
            quotes[symbol] = select_quote(row)
        except ValueError as error:
            errors[symbol] = str(error)
    return {"quotes": quotes, "errors": errors, "quoteProtocol": PROTOCOL}
