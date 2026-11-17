"""Isolated real-Streamlit smoke test; never imports secrets or the production app.

Run: streamlit run redfish_streamlit_preview.py --server.enableStaticServing=false
Use ?missing=1 to deliberately return a missing background image.
"""
import ast
import hmac
import json
import re
from pathlib import Path
from types import SimpleNamespace
import streamlit as st
import streamlit.components.v1 as components

ROOT = Path(__file__).parent
st.set_page_config(page_title="紅魚版隔離測試", layout="wide")
st.caption("隔離測試資料・真正 Streamlit・靜態檔案服務關閉")
tree = ast.parse((ROOT / "streamlit_app.py").read_text())
functions = ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in (
    "read_text", "build_page", "background_asset_path", "ledger_component",
    "preload_login_background", "check_password",
)], type_ignores=[])
scope = dict(ROOT=ROOT, json=json, re=re, hmac=hmac, __name__=__name__,
             st=SimpleNamespace(secrets={"app": {"password": "test-only"}}, session_state=st.session_state,
                 text_input=st.text_input, error=st.error, rerun=st.rerun,
                 components=SimpleNamespace(v1=components)))
exec(compile(functions, __file__, "exec"), scope)
if st.query_params.get("login") == "1" and not scope["check_password"]():
    scope["preload_login_background"]()
    st.stop()
page = scope["build_page"]()
page = page.replace("stock-ledger-v1", "redfish-streamlit-proof-ledger")
page = page.replace("stock-ledger-theme", "redfish-streamlit-proof-theme")
fixture = dict(holdings=[dict(id="test",symbol="2330.TW",name="台積電",shares=1000,
               avgCost=850,currentPrice=920,side="long")], usHoldings=[], funds=[],
               cryptoContracts=[],tradeHistory=[],cash=120000,usdTwdRate=32,
               history=[dict(date="2026-11-15",cash=100000,cashRecorded=True,stockTotal=900000,stockCost=850000),
                        dict(date="2026-11-16",cash=120000,cashRecorded=True,stockTotal=920000,stockCost=850000)])
seed = "<script>localStorage.setItem('redfish-streamlit-proof-theme','redfish');"
seed += "localStorage.setItem('redfish-streamlit-proof-ledger'," + json.dumps(json.dumps(fixture)) + ");</script>"
page = page.replace("<body>", "<body>" + seed, 1)
if st.query_params.get("missing") == "1":
    page = page.replace("/background.webp?v=", "/absent-background.webp?v=").replace("/background.png?v=", "/absent-background.png?v=")
bridge = scope["ledger_component"]()
bridge(html=page, reply=None, key="redfish-proof")
