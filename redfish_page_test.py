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
functions = ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in (
    "read_text", "build_page", "background_asset_path", "ledger_component", "preload_login_background",
)], type_ignores=[])
registrations = []
invocations = []
class FakeComponent:
    def __init__(self, name):
        self.name = "streamlit_app." + name
    def __call__(self, **kwargs):
        invocations.append((self.name, kwargs))
def register_assets(name, path):
    registrations.append((name, path))
    return FakeComponent(name)
scope = dict(ROOT=ROOT, json=json, re=re,
             st=SimpleNamespace(secrets={},
                 components=SimpleNamespace(v1=SimpleNamespace(declare_component=register_assets))))
exec(compile(functions, "streamlit_app.py", "exec"), scope)
# No optional image is read during page construction, even if it is unreadable.
with patch.object(Path, "read_bytes", side_effect=PermissionError()):
    page = scope["build_page"]()
relative_url = "../streamlit_app.ledger_assets/background.webp?v=1"
assert f'url("{relative_url}")' in page
assert registrations == [("ledger_assets", str(ROOT / "assets"))]
assert 'data:image/png;base64' not in page
assert 'id="themeSelect"' in page and 'value="redfish"' in page
assert 'background-color: var(--bg)' in page
scope["preload_login_background"]()
assert invocations == [("streamlit_app.ledger_quote_bridge", {
    "preloadBackground": relative_url, "key": "ledger-background-preload",
})], "password screen must not send ledger HTML, quote data, config or password"
# Test both server-configured paths and proxy prefixes unknown to the server.
for prefix in ("", "/ledger", "/~/+", "/nested/~/+"):
    bridge_url = f"https://ledger.example{prefix}/component/streamlit_app.ledger_quote_bridge/index.html?streamlitUrl=x"
    assert urljoin(bridge_url, relative_url) == f"https://ledger.example{prefix}/component/streamlit_app.ledger_assets/background.webp?v=1"
with patch.object(Path, "is_file", lambda path: path.name == "background.png"):
    assert 'url("../streamlit_app.ledger_assets/background.png?v=1")' in scope["build_page"]()
with patch.object(Path, "is_file", return_value=False):
    assert "background-image: none" in scope['build_page']()
    scope["preload_login_background"]()
    assert len(invocations) == 1
print(page if '--html' in sys.argv else 'PASS: preload URL matches ledger and preserves proxy prefix; PNG and missing-image fallbacks')
