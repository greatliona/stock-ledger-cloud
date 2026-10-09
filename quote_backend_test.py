import base64
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
        cls.config = {"app_key": "test-key", "private_key_password": "test-password-only",
            "private_key_pem": cls.key.private_bytes(serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8,
                serialization.BestAvailableEncryption(b"test-password-only")).decode()}

    def tick(self, **extra):
        return {"time": int(time.time()*1000), "price": 100, "period_type": "AFTER", **extra}

    def response(self, symbol="SOXL", rows=None):
        return {"ret_code": 0, "data": {"code": "US."+symbol,
            "ticker_list": rows if rows is not None else [self.tick()]}}

    def test_seven_symbols_and_get_signature(self):
        symbols = ["BITU", "EPP", "IVV", "SEMI", "SOXL", "SOXX", "VOO"]
        with patch.object(q, "request_json", side_effect=[self.response(s) for s in symbols]) as request, patch.object(q.time, "sleep"):
            result = q.fetch_us_quotes(symbols+["SOXL"], self.config)
        self.assertEqual(len(result["quotes"]), 7)
        self.assertEqual(result["quoteProtocol"], "futu-tick-v2")
        self.assertEqual(request.call_count, 7)
        for call, symbol in zip(request.call_args_list, symbols):
            path = call.args[0]
            self.assertEqual(path, "/api/v1.0/quote/US."+symbol+"/rt-ticker?num=20")
            headers = call.kwargs["headers"]
            route, query = path.split("?")
            payload = "\n".join((headers["X-Timestamp"], "GET", route, query, ""))
            self.key.public_key().verify(base64.b64decode(headers["Authorization"]), payload.encode())
            self.assertNotIn("test-password-only", str(headers))

    def test_latest_actual_trade_across_sessions(self):
        now = int(time.time()*1000)
        rows = [self.tick(time=now-1000, price=102, period_type="AFTER"),
                self.tick(time=now-60000, price=100, period_type="NORMAL"),
                self.tick(time=now-3000, price=101, period_type="BEFORE")]
        result = q.select_quote(rows)
        self.assertEqual((result["price"],result["session"],result["timeKind"]), (102,"盤後","trade"))
        self.assertAlmostEqual(__import__("datetime").datetime.fromisoformat(result["time"]).timestamp(), (now-1000)/1000)
        rows.append(self.tick(time=now, price=103, period_type="OVERNIGHT"))
        self.assertEqual(q.select_quote(rows)["session"],"夜盤")

    def test_new_regular_session_beats_old_afterhours(self):
        now = int(time.time()*1000)
        result = q.select_quote([self.tick(time=now-86400000), self.tick(time=now,price=105,period_type="NORMAL")])
        self.assertEqual((result["price"],result["session"]),(105,"正常盤"))

    def test_does_not_use_snapshot_timestamp(self):
        with self.assertRaises(ValueError):
            q.select_quote([{"data_time":int(time.time()*1000),"last_price":100,"after_market":{"price":110}}])

    def test_invalid_or_cancelled_ticks(self):
        for extra in ({"price":0},{"price":True},{"price":float("nan")},{"time":0},
                      {"time":time.time()*1000+120000},{"time":time.time()*1000-8*86400000},
                      {"trade_type":"U"},{"period_type":"UNKNOWN"}):
            with self.assertRaises(ValueError):
                q.select_quote([self.tick(**extra)])

    def test_missing_data_or_symbol_mismatch_preserves_price(self):
        for response in (self.response("OTHER"), {"ret_code":0,"data":{"code":"US.SOXL"}}):
            with patch.object(q,"request_json",return_value=response):
                result=q.fetch_us_quotes(["SOXL"],self.config)
            self.assertEqual(result["quotes"],{})
            self.assertIn("SOXL",result["errors"])

    def test_partial_success_and_rate_limit_stops_remaining(self):
        with patch.object(q,"request_json",side_effect=[self.response(),q.QuoteRateLimited("限流")]) as req, patch.object(q.time,"sleep"):
            result=q.fetch_us_quotes(["SOXL","IVV","VOO"],self.config)
        self.assertEqual(req.call_count,2)
        self.assertIn("SOXL",result["quotes"])
        self.assertEqual(set(result["errors"]),{"IVV","VOO"})

    def test_clock_correction(self):
        replies=[{"ret_code":-12006},{"server_time_ms":str(int(time.time()*1000))},self.response()]
        with patch.object(q,"request_json",side_effect=replies) as request:
            result=q.fetch_us_quotes(["SOXL"],self.config)
        self.assertIn("SOXL",result["quotes"])
        self.assertEqual(request.call_count,3)

    def test_permission_error_redacted(self):
        with patch.object(q,"request_json",return_value={"ret_code":123,"ret_msg":"SECRET"}):
            result=q.fetch_us_quotes(["SOXL"],self.config)
        self.assertNotIn("SECRET",str(result))
        self.assertIn("123",result["errors"]["SOXL"])

    def test_invalid_symbols_no_network(self):
        for symbols in ([], ["AAPL"]*51, ["US/AAPL"], ["AAPL\r\n"], [None]):
            with patch.object(q, "request_json") as request:
                with self.assertRaises(ValueError):
                    q.fetch_us_quotes(symbols,self.config)
                request.assert_not_called()

    def test_no_credentials_no_network(self):
        with patch.object(q, "request_json") as request:
            with self.assertRaisesRegex(ValueError,"尚未設定富途"):
                q.fetch_us_quotes(["SOXL"])
            request.assert_not_called()

    def test_pem_and_base64_without_password(self):
        for encoding in (serialization.Encoding.PEM,serialization.Encoding.DER):
            raw=self.key.private_bytes(encoding,serialization.PrivateFormat.PKCS8,serialization.NoEncryption())
            encoded=raw.decode() if encoding==serialization.Encoding.PEM else base64.b64encode(raw).decode()
            for extra in ({},{"private_key_password":""},{"private_key_password":"old-placeholder"}):
                _,key=q.load_credentials({"app_key":"test-key","private_key_pem":encoded,**extra})
                self.key.public_key().verify(key.sign(b"test"),b"test")

    def test_wrong_or_missing_encryption_password(self):
        for password in ("wrong",""):
            with self.assertRaises(ValueError):
                q.load_credentials({**self.config,"private_key_password":password})

    def test_public_or_corrupt_key_rejected(self):
        public=self.key.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo).decode()
        for text in (public,"invalid-secret-contents","/tmp/private.pem"):
            with self.assertRaises(ValueError) as error:
                q.load_credentials({"app_key":"test-key","private_key_pem":text})
            self.assertNotIn(text,str(error.exception))

    def test_http_errors_redacted(self):
        for code in (401,403,429,500):
            with patch.object(q,"build_opener") as opener:
                opener.return_value.open.side_effect=HTTPError(q.HOST,code,"SECRET",{},None)
                with self.assertRaises(ValueError) as error:
                    q.request_json("/api/v1.0/quote/US.SOXL/rt-ticker?num=20")
            self.assertNotIn("SECRET",str(error.exception))

    def test_only_readonly_endpoints(self):
        for path in ("/api/v1.0/trade/place-order","/api/v1.0/quote/stock-quote",
                     "/api/v1.0/quote/US.AAPL/rt-ticker?num=20&evil=1"):
            with self.assertRaises(ValueError):
                q.request_json(path)
        with self.assertRaises(ValueError):
            q.request_json("/api/v1.0/quote/US.SOXL/rt-ticker?num=20",b"{}")
        self.assertIsNone(q.NoRedirect().redirect_request(None,None,302,"",{},"https://example.com"))

if __name__=="__main__":
    unittest.main()
