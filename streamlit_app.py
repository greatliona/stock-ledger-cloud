import json
import hmac
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
    html = html.replace("</body>", f"{frame_height_script()}</body>")
    return html


def frame_height_script() -> str:
    return """
<script>
(() => {
  const send = (type, payload = {}) => {
    window.parent.postMessage({ type, ...payload }, "*");
  };

  const setFrameHeight = () => {
    const height = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.offsetHeight
    );
    send("streamlit:setFrameHeight", { height: height + 24 });
  };

  send("streamlit:componentReady", { apiVersion: 1 });
  window.addEventListener("load", setFrameHeight);
  window.addEventListener("resize", setFrameHeight);

  if ("ResizeObserver" in window) {
    new ResizeObserver(setFrameHeight).observe(document.body);
  }

  new MutationObserver(setFrameHeight).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
  });

  setFrameHeight();
  [250, 750, 1500, 3000].forEach((delay) => window.setTimeout(setFrameHeight, delay));
})();
</script>
"""


def check_password() -> bool:
    app_config = st.secrets.get("app", {})
    expected_password = app_config.get("password", "")

    if not expected_password:
        st.warning("請先在 Streamlit Secrets 設定 app.password。")
        return False

    if st.session_state.get("password_ok"):
        return True

    password = st.text_input("請輸入股票記帳本密碼", type="password")
    if not password:
        return False

    if hmac.compare_digest(password, expected_password):
        st.session_state["password_ok"] = True
        st.rerun()

    st.error("密碼不正確")
    return False


st.set_page_config(page_title="Stock Ledger!", page_icon="📒", layout="wide")

if check_password():
    st.components.v1.html(build_page(), height=2600, scrolling=False)
