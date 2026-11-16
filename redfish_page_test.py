"""Exercise the real page builder without importing the app or reading secrets."""
import ast
import json
import re
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).parent
tree = ast.parse((ROOT / "streamlit_app.py").read_text())
functions = ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef)
                            and n.name in ("read_text", "build_page")], type_ignores=[])
scope = dict(ROOT=ROOT, json=json, re=re,
             st=SimpleNamespace(secrets={}, get_option=lambda _: ""))
exec(compile(functions, "streamlit_app.py", "exec"), scope)
# No optional image is read during page construction, even if it is unreadable.
with patch.object(Path, "read_bytes", side_effect=PermissionError()):
    page = scope["build_page"]()
assert 'url("/app/static/background.png?v=L1.5.67")' in page
assert 'data:image/png;base64' not in page
assert 'id="themeSelect"' in page and 'value="redfish"' in page
assert 'background-color: var(--bg)' in page
scope['st'].get_option = lambda _: "ledger"
assert 'url("/ledger/app/static/background.png?v=L1.5.67")' in scope['build_page']()
assert (ROOT / "static/background.png").is_symlink()
assert (ROOT / "static/background.png").resolve() == (ROOT / "assets/background.png").resolve()
assert 'enableStaticServing = true' in (ROOT / '.streamlit/config.toml').read_text()
print(page if '--html' in sys.argv else 'PASS: URL-only image, subpath deployment, optional-image independence, static image link')
