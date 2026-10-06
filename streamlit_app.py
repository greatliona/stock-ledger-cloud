import json
import hmac
import re
import time
import importlib
from pathlib import Path

import streamlit as st
import quote_backend

# HTML/JS are read on every rerun; keep the imported quote code in sync too.
importlib.invalidate_caches()
quote_backend = importlib.reload(quote_backend)


ROOT = Path(__file__).parent


def read_text(filename: str) -> str:
    return (ROOT / filename).read_text(encoding="utf-8")


def build_page() -> str:
    html = read_text("index.html")
    css = read_text("styles.css")
    xlsx = read_text("xlsx.mini.min.js").replace("</script", "<\\/script")
    js = read_text("app.js")

    supabase = st.secrets.get("supabase", {})
    config = {
        "url": supabase.get("url", ""),
        "anonKey": supabase.get("anon_key", ""),
        "table": supabase.get("table", "stock_ledger_state"),
        "rowId": supabase.get("row_id", "main"),
    }

    html = re.sub(
        r'<link\s+rel="stylesheet"\s+href="styles\.css[^"]*"\s*/>',
        lambda _: f"<style>{css}</style>",
        html,
        count=1,
    )
    html = re.sub(
        r'<script\s+src="xlsx\.mini\.min\.js[^"]*"></script>',
        lambda _: f"<script>{xlsx}</script>",
        html,
        count=1,
    )
    html = re.sub(
        r'<script\s+src="app\.js[^"]*"></script>',
        lambda _: (
            "<script>"
            "window.STOCK_LEDGER_QUOTE_BRIDGE = true;"
            f"window.STOCK_LEDGER_SUPABASE = {json.dumps(config, ensure_ascii=False)};"
            "</script>"
            f"<script>{js}</script>"
        ),
        html,
        count=1,
    )
    return html


def check_password() -> bool:
    app_config = st.secrets.get("app", {})
    expected_password = app_config.get("password", "")

    if not expected_password:
        st.warning("請先在 Streamlit Secrets 設定 app.password。")
        return False

    if st.session_state.get("password_ok"):
        return True

    password = st.text_input("Ledger, passwords please!", type="password")
    if not password:
        return False

    if hmac.compare_digest(password, expected_password):
        st.session_state["password_ok"] = True
        st.rerun()

    st.error("密碼不正確")
    return False


st.set_page_config(page_title="Stock Ledger!", page_icon="💰", layout="wide")

if check_password():
    ledger = st.components.v1.declare_component("ledger_quote_bridge", path=str(ROOT / "quote_bridge"))
    request = ledger(html=build_page(), reply=st.session_state.get("quote_reply"), key="ledger")
    if isinstance(request, dict) and isinstance(request.get("id"), str) and request["id"] != st.session_state.get("quote_request_id"):
        st.session_state["quote_request_id"] = request["id"]
        try:
            now = time.monotonic()
            if now - st.session_state.get("last_quote_request", -60) < 15:
                raise ValueError("請間隔 15 秒再更新，避免 Yahoo 限流。")
            st.session_state["last_quote_request"] = now
            result = quote_backend.fetch_us_quotes(request.get("symbols"))
        except ValueError as error:
            result = {"quotes": {}, "errors": {}, "error": str(error)}
        st.session_state["quote_reply"] = {"id": request["id"], **result}
        st.rerun()
