import json
from pathlib import Path

import streamlit as st


ROOT = Path(__file__).parent


def read_text(filename: str) -> str:
    return (ROOT / filename).read_text(encoding="utf-8")


def build_page() -> str:
    html = read_text("index.html")
    css = read_text("styles.css")
    js = read_text("app.js")

    supabase = st.secrets.get("supabase", {})
    config = {
        "url": supabase.get("url", ""),
        "anonKey": supabase.get("anon_key", ""),
        "table": supabase.get("table", "stock_ledger_state"),
        "rowId": supabase.get("row_id", "main"),
    }

    html = html.replace(
        '<link rel="stylesheet" href="styles.css?v=20260602-6" />',
        f"<style>{css}</style>",
    )
    html = html.replace(
        '<script src="app.js?v=20260602-6"></script>',
        (
            "<script>"
            f"window.STOCK_LEDGER_SUPABASE = {json.dumps(config, ensure_ascii=False)};"
            "</script>"
            f"<script>{js}</script>"
        ),
    )
    return html


st.set_page_config(page_title="股票記帳本", page_icon="📒", layout="wide")
st.components.v1.html(build_page(), height=1800, scrolling=True)
