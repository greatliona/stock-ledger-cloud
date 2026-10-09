import base64
import hashlib
import json
import time
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
import quote_backend as q

class FutuTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.key = Ed25519PrivateKey.generate()
        cls.config = {"app_key": "test-app-key", "private_key_password": "test-password-only",
            "private_key_pem": cls.key.private_bytes(serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8,
                serialization.BestAvailableEncryption(b"test-password-only")).decode()}

    def row(self, **extra):
        return {"code": "US.SOXL", "data_time": int(time.time()*1000), "last_price": 100, **extra}

    def response(self, rows):
        return {"ret_code": 0, "data": {"quote_list": rows}}

    def test_batch_one_request_and_signature(self):
        symbols = ["BITU", "EPP", "IVV", "SEMI", "SOXL", "SOXX", "VOO"]
        rows = [self.row(code="US."+s) for s in symbols]
        with patch.object(q, "request_json", return_value=self.response(rows)) as request:
            result = q.fetch_us_quotes(symbols + ["SOXL"], self.config)
        self.assertEqual(len(result["quotes"]), 7)
        self.assertEqual(result["quoteProtocol"], "futu-v1")
        request.assert_called_once()
        path, body, headers = request.call_args.args
        self.assertEqual(path, q.QUOTE_PATH)
        self.assertEqual(json.loads(body)["code_list"], ["US."+s for s in symbols])
        payload = "\n".join((headers["X-Timestamp"], "POST", path, "", hashlib.sha256(body).hexdigest()))
        self.key.public_key().verify(base64.b64decode(headers["Authorization"]), payload.encode())
        self.assertNotIn("test-password-only", str(headers))

    def test_all_sessions(self):
        for field, label in (("pre_market", "盤前"), ("after_market", "盤後"), ("overnight", "夜盤")):
            quote = q.select_quote(self.row(**{field: {"price": 110}}))
            self.assertEqual((quote["price"], quote["session"]), (110, label))
        self.assertEqual(q.select_quote(self.row())["session"], "正常盤")

    def test_ambiguous_sessions_rejected(self):
        with self.assertRaisesRegex(ValueError, "多個盤別"):
            q.select_quote(self.row(pre_market={"price": 105}, after_market={"price": 110}))

    def test_invalid_prices(self):
        for value in (0, -1, None, True, float("nan"), float("inf")):
            with self.assertRaises(ValueError):
                q.select_quote(self.row(last_price=value))

    def test_invalid_timestamp(self):
        for value in (0, None, True, time.time()*1000+120000, time.time()*1000-8*86400000):
            with self.assertRaises(ValueError):
                q.select_quote(self.row(data_time=value))

    def test_partial_result(self):
        with patch.object(q, "request_json", return_value=self.response([self.row()])):
            result = q.fetch_us_quotes(["SOXL", "BITU"], self.config)
        self.assertIn("SOXL", result["quotes"])
        self.assertIn("BITU", result["errors"])

    def test_no_credentials_no_network(self):
        with patch.object(q, "request_json") as request:
            with self.assertRaisesRegex(ValueError, "尚未設定富途"):
                q.fetch_us_quotes(["SOXL"])
            request.assert_not_called()

    def test_invalid_symbols_no_network(self):
        for symbols in ([], ["AAPL"]*51, ["US/AAPL"], ["AAPL\r\n"], [None]):
            with patch.object(q, "request_json") as request:
                with self.assertRaises(ValueError):
                    q.fetch_us_quotes(symbols, self.config)
                request.assert_not_called()

    def test_permission_error_no_fallback_or_retry(self):
        with patch.object(q, "request_json", return_value={"ret_code": -100, "ret_msg": "SECRET"}) as request:
            with self.assertRaisesRegex(ValueError, "代碼 -100") as error:
                q.fetch_us_quotes(["SOXL"], self.config)
        request.assert_called_once()
        self.assertNotIn("SECRET", str(error.exception))

    def test_clock_correction_only_once(self):
        replies = [{"ret_code": -12006}, {"server_time_ms": str(int(time.time()*1000))},
                   self.response([self.row()])]
        with patch.object(q, "request_json", side_effect=replies) as request:
            self.assertIn("SOXL", q.fetch_us_quotes(["SOXL"], self.config)["quotes"])
        self.assertEqual(request.call_count, 3)

    def test_wrong_password(self):
        with self.assertRaisesRegex(ValueError, "私鑰或解密密碼"):
            q.fetch_us_quotes(["SOXL"], {**self.config, "private_key_password": "wrong"})

    def test_unencrypted_pem_without_password(self):
        pem = self.key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                     serialization.NoEncryption()).decode()
        for extra in ({}, {"private_key_password": ""}, {"private_key_password": "old-placeholder"}):
            app_key, key = q.load_credentials({"app_key": "test-key", "private_key_pem": pem, **extra})
            signature = key.sign(b"test")
            self.key.public_key().verify(signature, b"test")
            self.assertEqual(app_key, "test-key")

    def test_base64_der_without_password(self):
        raw = self.key.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8,
                                     serialization.NoEncryption())
        encoded = base64.b64encode(raw).decode()
        _, key = q.load_credentials({"app_key": "test-key", "private_key_pem": encoded})
        self.key.public_key().verify(key.sign(b"test"), b"test")

    def test_encrypted_requires_password(self):
        config = {k: v for k, v in self.config.items() if k != "private_key_password"}
        with self.assertRaisesRegex(ValueError, "這把私鑰已加密"):
            q.load_credentials(config)

    def test_public_or_corrupt_key_rejected(self):
        public = self.key.public_key().public_bytes(serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo).decode()
        for text in (public, "invalid-secret-contents", "/tmp/private.pem"):
            with self.assertRaises(ValueError) as error:
                q.load_credentials({"app_key": "test-key", "private_key_pem": text})
            self.assertNotIn(text, str(error.exception))

    def test_http_errors_sanitized(self):
        for code in (401, 403, 429, 500):
            with patch.object(q, "build_opener") as opener:
                opener.return_value.open.side_effect = HTTPError(q.HOST, code, "SECRET", {}, None)
                with self.assertRaises(ValueError) as error:
                    q.request_json(q.QUOTE_PATH, b"{}", {})
            self.assertNotIn("SECRET", str(error.exception))

    def test_no_trade_or_redirect(self):
        with self.assertRaises(ValueError):
            q.request_json("/api/v1.0/trade/place-order", b"{}", {})
        self.assertIsNone(q.NoRedirect().redirect_request(None,None,302,"",{},"https://example.com"))

    def test_source_removed_yahoo(self):
        from pathlib import Path
        source = Path(q.__file__).read_text()
        self.assertNotIn("import yfinance", source)
        self.assertNotIn("yahoo.com", source)

if __name__ == "__main__":
    unittest.main()
