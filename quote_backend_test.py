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
                    q.request_json("/api/v1.0/quote/US.SOXL/rt-ticker?num=20&period=AFTER")
            self.assertNotIn("SECRET",str(error.exception))

    def test_only_readonly_endpoints(self):
        for path in ("/api/v1.0/trade/place-order","/api/v1.0/quote/stock-quote?evil=1",
                     "/api/v1.0/quote/US.AAPL/rt-ticker?num=20&evil=1"):
            with self.assertRaises(ValueError):
                q.request_json(path)
        with self.assertRaises(ValueError):
            q.request_json("/api/v1.0/quote/US.SOXL/rt-ticker?num=20&period=AFTER",b"{}")
        self.assertIsNone(q.NoRedirect().redirect_request(None,None,302,"",{},"https://example.com"))


    def setUp(self):
        self.clock = patch.object(q.time, "time", return_value=1791566000.0) # 2026-10-09 regular session
        self.clock.start()
        self.addCleanup(self.clock.stop)
        self.sleep = patch.object(q.time, "sleep")
        self.sleep.start()
        self.addCleanup(self.sleep.stop)

    def market(self, symbols, state="AFTERNOON"):
        return {"ret_code":0,"data":{"market_state_list":[{"code":"US."+s,"market_state":state} for s in symbols]}}

    def snapshots(self, symbols, age=0):
        return {"ret_code":0,"data":{"quote_list":[{"code":"US."+s,"last_price":101,"data_time":int(time.time()*1000)-age*1000} for s in symbols]}}

    def minute(self, symbol, age=0, price=103, volume=100, section="US_REGULAR"):
        return {"ret_code":0,"data":{"section_list":[{"code":"US."+symbol,"trade_section":section,"point_list":[{"time":int(time.time()*1000)-age*1000,"cur_price":price,"volume":volume}]}]}}

    def test_seven_fresh_symbols_use_two_batch_calls_and_signed_body(self):
        symbols=["BITU","EPP","IVV","SEMI","VOO","SOXX","SOXL"]
        with patch.object(q,"request_json",side_effect=[self.market(symbols),self.snapshots(symbols)]) as req:
            result=q.fetch_us_quotes(symbols+["SEMI"],self.config)
        self.assertEqual(len(result["quotes"]),7)
        self.assertFalse(result["warnings"])
        self.assertEqual(req.call_count,2)
        for call in req.call_args_list:
            body=call.kwargs["body"]
            self.assertEqual(q.json.loads(body)["code_list"],["US."+s for s in symbols])
            headers=call.kwargs["headers"]
            payload="\n".join((headers["X-Timestamp"],"POST",call.args[0],"",q.hashlib.sha256(body).hexdigest()))
            self.key.public_key().verify(base64.b64decode(headers["Authorization"]),payload.encode())
        self.assertEqual(result["quotes"]["SEMI"]["timeKind"],"quote")

    def test_only_stale_semi_gets_independent_minute_fallback(self):
        symbols=["SEMI","VOO"]
        snapshots=self.snapshots(symbols)
        snapshots["data"]["quote_list"][0]["data_time"]-=900000
        with patch.object(q,"request_json",side_effect=[self.market(symbols),snapshots,self.minute("SEMI",age=30)]) as req:
            result=q.fetch_us_quotes(symbols,self.config)
        self.assertEqual(req.call_count,3)
        self.assertIn("US.SEMI/rt-data?request_section=NORMAL",req.call_args_list[-1].args[0])
        self.assertEqual(result["quotes"]["SEMI"]["price"],103)
        self.assertEqual(result["quotes"]["SEMI"]["timeKind"],"minute")
        self.assertFalse(result["warnings"])

    def test_stale_both_sources_compare_book_without_using_bid_price(self):
        book={"ret_code":0,"data":[{"code":"US.SEMI","books":[{"exchange_data_time_ms":int(time.time()*1000)-1000,"bid_list":[{"price":999}]}]}]}
        with patch.object(q,"request_json",side_effect=[self.market(["SEMI"]),self.snapshots(["SEMI"],900),self.minute("SEMI",age=890),book]) as req:
            result=q.fetch_us_quotes(["SEMI"],self.config)
        self.assertEqual(req.call_count,4)
        self.assertEqual(result["quotes"]["SEMI"]["price"],103)
        self.assertIn("買賣報價距今 1 秒",result["warnings"]["SEMI"])
        self.assertNotIn("999",str(result))

    def test_afterhours_queries_only_current_period(self):
        with patch.object(q,"request_json",side_effect=[self.market(["SOXL"],"AFTER_HOURS_BEGIN"),self.response()]) as req:
            result=q.fetch_us_quotes(["SOXL"],self.config)
        self.assertEqual(req.call_count,2)
        self.assertEqual(result["quotes"]["SOXL"]["session"],"盤後")
        self.assertTrue(req.call_args_list[1].args[0].endswith("period=AFTER"))

    def test_empty_afterhours_uses_afterhours_minute_not_regular_close(self):
        with patch.object(q,"request_json",side_effect=[self.market(["SOXL"],"AFTER_HOURS_BEGIN"),self.response(rows=[]),self.minute("SOXL",section="US_AFTERHOURS")]):
            result=q.fetch_us_quotes(["SOXL"],self.config)
        self.assertEqual(result["quotes"]["SOXL"]["session"],"盤後")
        self.assertEqual(result["quotes"]["SOXL"]["timeKind"],"minute")

    def test_zero_volume_minute_cannot_fabricate_freshness(self):
        with self.assertRaises(ValueError):
            q.minute_quote(self.minute("SEMI",volume=0)["data"],"SEMI","NORMAL",time.time())

    def test_wrong_symbol_and_wrong_section_minute_rejected(self):
        for data in [self.minute("OTHER"),self.minute("SEMI",section="US_OVERNIGHT")]:
            with self.assertRaises(ValueError):
                q.minute_quote(data["data"],"SEMI","NORMAL",time.time())

    def test_snapshot_does_not_use_afterhours_or_yesterday_time(self):
        for age in [86400,9*3600]:
            with self.assertRaises(ValueError):
                q.regular_snapshot(self.snapshots(["SOXL"],age)["data"]["quote_list"][0],time.time())

    def test_rate_limit_latches_no_followup_requests(self):
        with patch.object(q,"request_json",side_effect=[self.market(["SOXL","IVV"]),q.QuoteRateLimited("限流")]) as req:
            result=q.fetch_us_quotes(["SOXL","IVV"],self.config)
        self.assertEqual(req.call_count,2)
        self.assertFalse(result["quotes"])
        self.assertEqual(set(result["errors"]),{"SOXL","IVV"})

    def test_clock_correction_for_post_preserves_body(self):
        with patch.object(q,"request_json",side_effect=[{"ret_code":-12006},{"server_time_ms":int(time.time()*1000)},self.market(["SOXL"]),self.snapshots(["SOXL"])]) as req:
            result=q.fetch_us_quotes(["SOXL"],self.config)
        self.assertIn("SOXL",result["quotes"])
        self.assertEqual(req.call_count,4)
        self.assertEqual(req.call_args_list[0].kwargs["body"],req.call_args_list[2].kwargs["body"])

    def test_budget_expired_no_network(self):
        with patch.object(q.time,"monotonic",side_effect=[0]+[121]*10),patch.object(q,"request_json") as req:
            result=q.fetch_us_quotes(["SOXL"],self.config)
        req.assert_not_called()
        self.assertFalse(result["quotes"])

    def test_unsupported_state_uses_full_and_overnight_minute(self):
        with patch.object(q,"request_json",side_effect=[self.market(["SOXL"],"CLOSED"),self.minute("SOXL",age=60,section="US_AFTERHOURS"),self.minute("SOXL",section="US_OVERNIGHT")]) as req:
            result=q.fetch_us_quotes(["SOXL"],self.config)
        self.assertEqual(req.call_count,3)
        self.assertEqual(result["quotes"]["SOXL"]["session"],"夜盤")

if __name__=="__main__":
    unittest.main()
