import json
import hmac
import re
import importlib
import time
import logging
from pathlib import Path
from PIL import Image

import streamlit as st
import quote_backend
from quote_job import QuoteJob

# HTML/JS are read on every rerun; keep the imported quote code in sync too.
importlib.invalidate_caches()
quote_backend = importlib.reload(quote_backend)


ROOT = Path(__file__).parent


def read_text(filename: str) -> str:
    return (ROOT / filename).read_text(encoding="utf-8")


def background_asset_path() -> str:
    folder = ROOT / "assets"
    filename = next((name for name in ("background.webp", "background.png") if (folder / name).is_file()), "")
    if not filename:
        return ""
    # Only public artwork is registered here. Both the preloader and the ledger
    # resolve the same sibling URL, including the Cloud /~/+/ prefix.
    assets = st.components.v1.declare_component("ledger_assets", path=str(folder))
    return f"../{assets.name}/{filename}?v=1"


def ledger_component():
    return st.components.v1.declare_component("ledger_quote_bridge", path=str(ROOT / "quote_bridge"))


def preload_login_background(theme_storage_key="stock-ledger-theme"):
    if path := background_asset_path():
        return ledger_component()(preloadBackground=path, themeStorageKey=theme_storage_key,
                                  key="ledger-background-preload", default=False) is True
    return True


def build_page() -> str:
    html = read_text("index.html")
    css = read_text("styles.css")
    path = background_asset_path()
    css = css.replace('url("assets/background.png?v=1")', f'url("{path}")' if path else "none")
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


def check_password(theme_storage_key="stock-ledger-theme") -> bool:
    app_config = st.secrets.get("app", {})
    expected_password = app_config.get("password", "")

    if not expected_password:
        st.warning("請先在 Streamlit Secrets 設定 app.password。")
        return False

    if st.session_state.get("password_ok"):
        return True

    background_ready = preload_login_background(theme_storage_key)
    password = st.text_input("Ledger, passwords please!", type="password", disabled=not background_ready)
    if not password:
        return False

    if hmac.compare_digest(password, expected_password):
        st.session_state["password_ok"] = True
        st.rerun()

    st.error("密碼不正確")
    return False


favicon_path = Path(__file__).with_name("favicon.png")
st.set_page_config(
    page_title="Stock Ledger!",
    page_icon=Image.open(favicon_path) if favicon_path.is_file() else "💰",
    layout="wide",
)

# Hide before the component mounts; the persistent outer-document button can
# reveal the original toolbar without rebuilding its controls.
st.markdown('''<style>
html:not([data-ledger-toolbar-open]) [data-testid="stHeader"] {
  visibility: hidden !important; pointer-events: none !important;
}
/* Both BaseWeb and newer native Streamlit input structures. Clear every
   nested surface first, then tint exactly the outer input wrapper once. */
html[data-stock-ledger-theme="redfish"] [data-testid="stTextInput"],
html[data-stock-ledger-theme="redfish"] [data-testid="stTextInput"] :is(div, input, button) {
  background: transparent !important; background-image: none !important;
  box-shadow: none !important; color: #30261f !important;
}
html[data-stock-ledger-theme="redfish"] [data-testid="stTextInput"] [data-testid="stTextInputRootElement"],
html[data-stock-ledger-theme="redfish"] [data-testid="stTextInput"] [data-baseweb="input"] {
  background: rgba(255, 253, 247, .20) !important;
  border: 1px solid rgba(91, 64, 43, .20) !important;
  border-radius: 8px !important;
  transition: border-color .18s ease, box-shadow .18s ease, background-color .18s ease !important;
}
html[data-stock-ledger-theme="redfish"] [data-testid="stTextInput"] :is([data-baseweb="input"], [data-testid="stTextInputRootElement"]):focus-within {
  border-color: #963526 !important;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, .13) !important;
  outline: 2px solid #963526; outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  html[data-stock-ledger-theme="redfish"] [data-testid="stTextInput"] :is([data-baseweb="input"], [data-testid="stTextInputRootElement"]) { transition: none !important; }
}
</style>''', unsafe_allow_html=True)

@st.fragment(run_every=1)
def render_ledger():
    job = st.session_state.get("quote_job")
    if job:
        st.session_state["quote_reply"] = job.snapshot()
    rejection = st.session_state.pop("quote_rejection", None)
    if rejection:
        st.session_state["quote_reply"] = rejection
    ledger = ledger_component()
    request = ledger(html=st.session_state["ledger_html"], reply=st.session_state.get("quote_reply"), key="ledger")
    if isinstance(request, dict) and isinstance(request.get("symbols"), list) and isinstance(request.get("id"), str) and request["id"] != st.session_state.get("quote_request_id"):
        if job and job.snapshot().get("phase") == "running":
            st.session_state["quote_request_id"] = request["id"]
            st.session_state["quote_rejection"] = {"id":request["id"], "error":"上一筆後端查詢尚未結束；未重複送出", "quotes":{}, "errors":{}}
            return
        st.session_state["quote_request_id"] = request["id"]
        st.session_state["quote_job"] = QuoteJob(request["id"], quote_backend.fetch_us_quotes,
            request["symbols"], dict(st.secrets.get("futu", {})), quote_backend.QUOTE_PROGRESS)


if check_password():
    # Keep the component input byte-identical across quote-triggered reruns.
    # Rebuild on a release change, not on every price refresh.
    if st.session_state.get("ledger_page_version") != "L1.5.96":
        st.session_state["ledger_html"] = build_page()
        st.session_state["ledger_page_version"] = "L1.5.96"
    # Keep the mounted ledger visible while its read-only quote request runs.
    # Streamlit normally dims stale components during a rerun.
    st.markdown("""<style>
    [data-testid="stCustomComponentV1"] { opacity: 1 !important; }
    [data-testid="stElementContainer"]:has([data-testid="stCustomComponentV1"]) {
      opacity: 1 !important;
    }
    [data-stale="true"]:has([data-testid="stCustomComponentV1"]),
    [data-testid="stCustomComponentV1"][data-stale="true"] {
      opacity: 1 !important; visibility: visible !important;
      animation: none !important; transition: none !important;
    }
    </style>""", unsafe_allow_html=True)
    render_ledger()
