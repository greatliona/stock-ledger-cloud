"""Isolated real-Streamlit smoke test; never imports secrets or the production app.

Run: streamlit run redfish_streamlit_preview.py --server.enableStaticServing=false
Use ?missing=1 to deliberately return a missing background image.
"""
import ast
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
functions = ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef)
                            and n.name in ("read_text", "build_page")], type_ignores=[])
scope = dict(ROOT=ROOT, json=json, re=re, __name__=__name__,
             st=SimpleNamespace(secrets={}, get_option=st.get_option,
                 components=SimpleNamespace(v1=components)))
exec(compile(functions, __file__, "exec"), scope)
page = scope["build_page"]()
page = page.replace("stock-ledger-v1", "redfish-streamlit-proof-ledger")
page = page.replace("stock-ledger-theme", "redfish-streamlit-proof-theme")
fixture = dict(holdings=[dict(id="test",symbol="2330.TW",name="台積電",shares=1000,
               avgCost=850,currentPrice=920,side="long")], usHoldings=[], funds=[],
               cryptoContracts=[],history=[],tradeHistory=[],cash=120000,usdTwdRate=32)
seed = "<script>localStorage.setItem('redfish-streamlit-proof-theme','redfish');"
seed += "localStorage.setItem('redfish-streamlit-proof-ledger'," + json.dumps(json.dumps(fixture)) + ");</script>"
page = page.replace("<body>", "<body>" + seed, 1)
if st.query_params.get("missing") == "1":
    page = page.replace("/background.png?v=", "/absent-background.png?v=")
bridge = components.declare_component("ledger_quote_bridge", path=str(ROOT / "quote_bridge"))
bridge(html=page, reply=None, key="redfish-proof")
