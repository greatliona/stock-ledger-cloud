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

    def snapshots(self, symbols, age=0):
        return {"ret_code":0,"data":{"quote_list":[{"code":"US."+s,"last_price":101,"data_time":int(time.time()*1000)-age*1000} for s in symbols]}}

    def minute(self, symbol, age=0, price=103, volume=100, section="US_REGULAR"):
        return {"ret_code":0,"data":{"section_list":[{"code":"US."+symbol,"trade_section":section,"point_list":[{"time":int(time.time()*1000)-age*1000,"cur_price":price,"volume":volume}]}]}}

    def test_seven_fresh_symbols_use_one_batch_call_and_signed_body(self):
        symbols=["BITU","EPP","IVV","SEMI","VOO","SOXX","SOXL"]
        with patch.object(q,"request_json",return_value=self.snapshots(symbols)) as req:
            result=q.fetch_us_quotes(symbols+["SEMI"],self.config)
        self.assertEqual(len(result["quotes"]),7)
        self.assertFalse(result["warnings"])
        self.assertEqual(req.call_count,1)
        self.assertEqual(req.call_args.args[0],"/api/v1.0/quote/stock-quote")
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
        with patch.object(q,"request_json",side_effect=[snapshots,self.minute("SEMI",age=30)]) as req:
            result=q.fetch_us_quotes(symbols,self.config)
        self.assertEqual(req.call_count,2)
        self.assertIn("US.SEMI/rt-data?request_section=NORMAL",req.call_args_list[-1].args[0])
        self.assertEqual(result["quotes"]["SEMI"]["price"],103)
        self.assertEqual(result["quotes"]["SEMI"]["timeKind"],"minute")
        self.assertFalse(result["warnings"])

    def test_stale_sources_do_not_call_order_book(self):
        with patch.object(q,"request_json",side_effect=[self.snapshots(["SEMI"],900),self.minute("SEMI",age=890)]) as req:
            result=q.fetch_us_quotes(["SEMI"],self.config)
        self.assertEqual(req.call_count,2)
        self.assertEqual(result["quotes"]["SEMI"]["price"],103)
        self.assertIn("距今",result["warnings"]["SEMI"])

    def test_http_timeout_and_quote_budget_are_bounded(self):
        with patch.object(q,"request_json",return_value=self.snapshots(["SOXL"])) as req:
            q.fetch_us_quotes(["SOXL"],self.config)
        self.assertTrue(all(call.kwargs["timeout"] <= q.REQUEST_TIMEOUT_SECONDS for call in req.call_args_list))
        self.assertLessEqual(q.QUOTE_BUDGET_SECONDS,30)

    def test_slow_missing_symbols_stop_at_budget_and_keep_valid_batch_prices(self):
        symbols=["SOXX","EPP","SEMI","IVV"]
        elapsed=[0.0]
        def response(path, **kwargs):
            elapsed[0]+=kwargs["timeout"]
            if path.endswith("snapshot"):
                return {"ret_code":0,"data":{"snapshot_list":[
                    {"code":"US."+symbol,"overnight_price":100 if symbol in ("SOXX","IVV") else 0}
                    for symbol in symbols]}}
            if "rt-ticker" in path:
                symbol=path.split("/")[4]
                return {"ret_code":0,"data":{"code":symbol,"ticker_list":[]}}
            return {"ret_code":0,"data":{"section_list":[]}}
        night=q.datetime(2026,10,12,2,tzinfo=q.timezone.utc).timestamp()
        with patch.object(q.time,"time",return_value=night),patch.object(q.time,"monotonic",side_effect=lambda:elapsed[0]),patch.object(q,"request_json",side_effect=response) as req:
            result=q.fetch_us_quotes(symbols,self.config)
        self.assertLessEqual(elapsed[0],q.QUOTE_BUDGET_SECONDS)
        self.assertLessEqual(req.call_count,5)
        self.assertEqual(set(result["quotes"]),{"SOXX","IVV"})
        self.assertEqual(set(result["errors"]),{"EPP","SEMI"})

    def test_afterhours_queries_only_current_period(self):
        after=q.datetime(2026,10,9,21,tzinfo=q.timezone.utc).timestamp()
        with patch.object(q.time,"time",return_value=after),patch.object(q,"request_json",side_effect=[{"ret_code":0,"data":{"snapshot_list":[]}},self.response()]) as req:
            result=q.fetch_us_quotes(["SOXL"],self.config)
        self.assertEqual(req.call_count,2)
        self.assertEqual(result["quotes"]["SOXL"]["session"],"盤後")
        self.assertTrue(req.call_args_list[1].args[0].endswith("period=AFTER"))

    def test_empty_afterhours_uses_afterhours_minute_not_regular_close(self):
        after=q.datetime(2026,10,9,21,tzinfo=q.timezone.utc).timestamp()
        with patch.object(q.time,"time",return_value=after),patch.object(q,"request_json",side_effect=[{"ret_code":0,"data":{"snapshot_list":[]}},self.response(rows=[]),self.minute("SOXL",section="US_AFTERHOURS")]):
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
        with patch.object(q,"request_json",side_effect=q.QuoteRateLimited("限流")) as req:
            result=q.fetch_us_quotes(["SOXL","IVV"],self.config)
        self.assertEqual(req.call_count,1)
        self.assertFalse(result["quotes"])
        self.assertEqual(set(result["errors"]),{"SOXL","IVV"})

    def test_api_rate_limit_code_stops_all_fallback_calls(self):
        for response in ({"ret_code":-12011,"error":{"code":"rate_limited"}},
                         {"ret_code":-11,"error":{"code":"rate_limited"}}):
            with self.subTest(response=response["ret_code"]), patch.object(q,"request_json",return_value=response) as req:
                result=q.fetch_us_quotes(["SOXL","IVV"],self.config)
            self.assertEqual(req.call_count,1)
            self.assertFalse(result["quotes"])
            self.assertEqual(set(result["errors"]),{"SOXL","IVV"})

    def test_clock_correction_for_post_preserves_body(self):
        with patch.object(q,"request_json",side_effect=[{"ret_code":-12006},{"server_time_ms":int(time.time()*1000)},self.snapshots(["SOXL"])]) as req:
            result=q.fetch_us_quotes(["SOXL"],self.config)
        self.assertIn("SOXL",result["quotes"])
        self.assertEqual(req.call_count,3)
        self.assertEqual(req.call_args_list[0].kwargs["body"],req.call_args_list[2].kwargs["body"])

    def test_budget_expired_no_network(self):
        with patch.object(q.time,"monotonic",side_effect=[0]+[121]*10),patch.object(q,"request_json") as req:
            result=q.fetch_us_quotes(["SOXL"],self.config)
        req.assert_not_called()
        self.assertFalse(result["quotes"])

    def test_outside_market_hours_uses_full_and_overnight_minute(self):
        weekend=q.datetime(2026,10,10,12,tzinfo=q.timezone.utc).timestamp()
        with patch.object(q.time,"time",return_value=weekend),patch.object(q,"request_json",side_effect=[{"ret_code":0,"data":{"snapshot_list":[]}},self.minute("SOXL",age=60,section="US_AFTERHOURS"),self.minute("SOXL",section="US_OVERNIGHT")]) as req:
            result=q.fetch_us_quotes(["SOXL"],self.config)
        self.assertEqual(req.call_count,3)
        self.assertEqual(result["quotes"]["SOXL"]["session"],"夜盤")

    def test_24h_snapshot_uses_overnight_not_regular_price(self):
        night=q.datetime(2026,10,12,2,tzinfo=q.timezone.utc).timestamp()
        data={"ret_code":0,"data":{"snapshot_list":[
            {"code":"US.SOXX","last_price":559.4,"overnight_price":562.09,"update_time":1},
            {"code":"US.SOXL","last_price":139.76,"overnight_price":141.17,"update_time":1}]}}
        with patch.object(q.time,"time",return_value=night),patch.object(q,"request_json",return_value=data) as req:
            result=q.fetch_us_quotes(["SOXX","SOXL"],self.config)
        self.assertEqual(req.call_count,1)
        self.assertEqual(result["quotes"]["SOXX"]["price"],562.09)
        self.assertEqual(result["quotes"]["SOXL"]["price"],141.17)
        self.assertIsNone(result["quotes"]["SOXL"]["time"])
        self.assertEqual(result["quotes"]["SOXL"]["priceField"],"overnight_price")
        self.assertEqual(req.call_args_list[-1].args[0],"/api/v1.0/quote/snapshot")

    def test_ended_afterhours_does_not_mask_overnight(self):
        stamp=q.datetime(2026,10,12,2,tzinfo=q.timezone.utc).timestamp()
        data={"ret_code":0,"data":{"snapshot_list":[{"code":"US.SOXL","overnight_price":141.17,"after_price":139}]}}
        with patch.object(q.time,"time",return_value=stamp),patch.object(q,"request_json",return_value=data) as req:
            result=q.fetch_us_quotes(["SOXL"],self.config)
        self.assertEqual(result["quotes"]["SOXL"]["price"],141.17)
        self.assertEqual(result["quotes"]["SOXL"]["session"],"夜盤")
        self.assertEqual(req.call_count,1)

    def test_ended_afterhours_outside_night_window_keeps_afterhours(self):
        stamp=q.datetime(2026,10,10,12,tzinfo=q.timezone.utc).timestamp()
        data={"ret_code":0,"data":{"snapshot_list":[{"code":"US.SOXL","overnight_price":141.17,"after_price":139}]}}
        with patch.object(q.time,"time",return_value=stamp),patch.object(q,"request_json",return_value=data):
            result=q.fetch_us_quotes(["SOXL"],self.config)
        self.assertNotIn("SOXL",result["quotes"])

    def test_invalid_overnight_snapshot_never_uses_last_price(self):
        for price in [0,-1,None,True,float("nan")]:
            self.assertIsNone(q.extended_snapshot({"last_price":100,"overnight_price":price},"OVERNIGHT",time.time()))
        self.assertIsNone(q.extended_snapshot({"index_valid":True,"overnight_price":100},"OVERNIGHT",time.time()))

    def test_closed_during_ny_overnight_reads_24h_field(self):
        stamp=q.datetime(2026,10,12,2,tzinfo=q.timezone.utc).timestamp()
        data={"ret_code":0,"data":{"snapshot_list":[{"code":"US.SOXL","overnight_price":141.17,"after_price":139}]}}
        with patch.object(q.time,"time",return_value=stamp),patch.object(q,"request_json",return_value=data):
            result=q.fetch_us_quotes(["SOXL"],self.config)
        self.assertEqual(result["quotes"]["SOXL"]["price"],141.17)

    def test_ny_clock_switches_with_daylight_saving(self):
        et=q.ZoneInfo("America/New_York")
        for month, day, offset in ((1,22,5),(10,22,4)):
            for hour, minute, expected in ((3,59,"OVERNIGHT"),(4,0,"BEFORE"),
                                           (9,29,"BEFORE"),(9,30,"NORMAL"),
                                           (16,0,"AFTER"),(20,0,"OVERNIGHT")):
                stamp=q.datetime(2026,month,day,hour,minute,tzinfo=et).timestamp()
                self.assertEqual(q.us_market_period(stamp),expected,(offset,hour,minute))

    def test_holiday_and_early_close_do_not_reuse_wrong_session(self):
        et=q.ZoneInfo("America/New_York")
        for day in ((2026,1,19),(2026,4,3),(2026,7,3),(2026,12,25)):
            stamp=q.datetime(*day,10,0,tzinfo=et).timestamp()
            self.assertIsNone(q.us_market_period(stamp))
        thanksgiving_friday=q.datetime(2026,11,27,13,0,tzinfo=et).timestamp()
        self.assertEqual(q.us_market_period(thanksgiving_friday),"AFTER")
        self.assertIsNone(q.us_market_period(q.datetime(2026,11,27,17,0,tzinfo=et).timestamp()))
        christmas_eve=q.datetime(2026,12,24,13,0,tzinfo=et).timestamp()
        self.assertEqual(q.us_market_period(christmas_eve),"AFTER")

if __name__=="__main__":
    unittest.main()
