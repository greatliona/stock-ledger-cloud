"""Exercise the real page builder without importing the app or reading secrets."""
import ast
import json
import re
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import urljoin

ROOT = Path(__file__).parent
tree = ast.parse((ROOT / "streamlit_app.py").read_text())
functions = ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef)
                            and n.name in ("read_text", "build_page")], type_ignores=[])
registrations = []
def register_assets(name, path):
    registrations.append((name, path))
    return SimpleNamespace(name="streamlit_app." + name)
scope = dict(ROOT=ROOT, json=json, re=re,
             st=SimpleNamespace(secrets={}, get_option=lambda _: "",
                 components=SimpleNamespace(v1=SimpleNamespace(declare_component=register_assets))))
exec(compile(functions, "streamlit_app.py", "exec"), scope)
# No optional image is read during page construction, even if it is unreadable.
with patch.object(Path, "read_bytes", side_effect=PermissionError()):
    page = scope["build_page"]()
relative_url = "../streamlit_app.ledger_assets/background.png?v=L1.5.70"
assert f'url("{relative_url}")' in page
assert registrations == [("ledger_assets", str(ROOT / "assets"))]
assert 'data:image/png;base64' not in page
assert 'id="themeSelect"' in page and 'value="redfish"' in page
assert 'background-color: var(--bg)' in page
scope['st'].get_option = lambda _: "ledger"
assert f'url("{relative_url}")' in scope['build_page']()
# Test both server-configured paths and proxy prefixes unknown to the server.
for prefix in ("", "/ledger", "/~/+", "/nested/~/+"):
    bridge_url = f"https://ledger.example{prefix}/component/streamlit_app.ledger_quote_bridge/index.html?streamlitUrl=x"
    assert urljoin(bridge_url, relative_url) == f"https://ledger.example{prefix}/component/streamlit_app.ledger_assets/background.png?v=L1.5.70"
with patch.object(Path, "is_dir", return_value=False):
    assert "background-image: none" in scope['build_page']()
print(page if '--html' in sys.argv else 'PASS: relative image URL preserves /~/+/ and nested proxy prefixes; missing directory stays safe')
