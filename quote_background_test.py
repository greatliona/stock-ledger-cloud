"""Quote delivery tests without credentials or network."""
import ast
from pathlib import Path
from types import SimpleNamespace as NS
import unittest

class RerunRequested(Exception): pass

class QuoteDeliveryTests(unittest.TestCase):
    def test_direct_delivery_deduplication_and_errors(self):
        method = next(n for n in ast.parse(Path(__file__).with_name('streamlit_app.py').read_text()).body if isinstance(n, ast.FunctionDef) and n.name == 'render_ledger')
        method.decorator_list = []
        request = {'id': 'one', 'symbols': ['SOXL']}
        calls, replies = [], []
        def component(**kw):
            replies.append(kw['reply'])
            return request
        def fetch(symbols, config):
            calls.append(symbols)
            if symbols == ['ERROR']: raise ValueError('test error')
            return {'quotes': {'SOXL': {'price': 100}}}
        def rerun(**kw):
            self.assertEqual(kw, {'scope': 'fragment'})
            raise RerunRequested()
        st = NS(session_state={}, secrets={}, rerun=rerun, components=NS(v1=NS(declare_component=lambda *a, **kw: component)))
        ns = dict(st=st, ROOT=Path(__file__).parent, build_page=lambda: '', quote_backend=NS(fetch_us_quotes=fetch))
        exec(compile(ast.Module(body=[method], type_ignores=[]), 'fragment', 'exec'), ns)
        run = ns['render_ledger']
        for identifier in ['one', 'two']:
            request = {'id': identifier, 'symbols': ['SOXL']}
            with self.assertRaises(RerunRequested): run()
            run()
            self.assertEqual(replies[-1]['id'], identifier)
            self.assertEqual(replies[-1]['quotes']['SOXL']['price'], 100)
        self.assertEqual(len(calls), 2)
        request = {'id': 'old', 'poll': 1}
        run()
        self.assertEqual(len(calls), 2)
        request = {'id': 'error', 'symbols': ['ERROR']}
        with self.assertRaises(RerunRequested): run()
        run()
        self.assertEqual(replies[-1]['error'], 'test error')

if __name__ == '__main__': unittest.main()
