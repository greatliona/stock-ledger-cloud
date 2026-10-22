"""Exercise the Streamlit quote fragment without using credentials or network."""
import ast
import pathlib
import types
import unittest


class RerunRequested(Exception):
    pass


class FakeFuture:
    completed = False

    def done(self):
        return self.completed

    def result(self):
        return {"quoteProtocol": "futu-snapshot-v5", "quotes": {"SOXL": {"price": 100}}, "errors": {}}


class QuoteBackgroundTests(unittest.TestCase):
    def test_request_returns_before_network_and_poll_delivers_once(self):
        source = pathlib.Path(__file__).with_name("streamlit_app.py").read_text(encoding="utf-8")
        method = next(item for item in ast.parse(source).body if isinstance(item, ast.FunctionDef) and item.name == "render_ledger")
        method.decorator_list = []
        responses = [
            {"id": "first", "symbols": ["SOXL"]},
            {"id": "first", "poll": 1},
            {"id": "first", "poll": 2},
            {"id": "second", "symbols": ["SOXL"]},
        ]
        rendered_replies = []
        submitted = []
        future = FakeFuture()

        def component(**kwargs):
            rendered_replies.append(kwargs["reply"])
            return responses.pop(0)

        def submit(*args):
            submitted.append(args)
            return future

        st = types.SimpleNamespace(
            session_state={}, secrets={"futu": {"app_key": "test-only"}},
            components=types.SimpleNamespace(v1=types.SimpleNamespace(declare_component=lambda *args, **kwargs: component)),
            rerun=lambda **kwargs: (_ for _ in ()).throw(RerunRequested()),
        )
        namespace = {"st": st, "ROOT": pathlib.Path(__file__).parent,
                     "build_page": lambda: "<p>ledger</p>",
                     "quote_executor": lambda: types.SimpleNamespace(submit=submit),
                     "quote_backend": types.SimpleNamespace(fetch_us_quotes=lambda *args: self.fail("network called on Streamlit thread")),
                     "time": types.SimpleNamespace(monotonic=lambda: 100)}
        exec(compile(ast.Module(body=[method], type_ignores=[]), "streamlit_app.py", "exec"), namespace)
        run = namespace["render_ledger"]
        run()
        self.assertEqual(len(submitted), 1)
        self.assertEqual(submitted[0][1], ["SOXL"])
        self.assertIsNone(rendered_replies[-1])
        run()
        self.assertEqual(len(submitted), 1)
        future.completed = True
        run()
        self.assertEqual(rendered_replies[-1]["id"], "first")
        self.assertEqual(rendered_replies[-1]["quotes"]["SOXL"]["price"], 100)
        with self.assertRaises(RerunRequested):
            run()
        self.assertEqual(len(submitted), 1)
        self.assertEqual(st.session_state["quote_reply"]["id"], "second")
        self.assertIn("15 秒", st.session_state["quote_reply"]["error"])


if __name__ == "__main__":
    unittest.main()
