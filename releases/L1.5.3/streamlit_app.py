import json
import hmac
import re
from pathlib import Path

import streamlit as st


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
    st.components.v1.html(build_page(), height=1800, scrolling=True)
