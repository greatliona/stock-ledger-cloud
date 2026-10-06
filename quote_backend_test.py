import unittest
from unittest.mock import patch
from datetime import datetime, timezone
from quote_backend import fetch_us_quotes, select_quote

class QuoteTests(unittest.TestCase):
    def test_newest_session_not_fixed_priority(self):
        row = {"currency":"USD", "regularMarketPrice":100, "regularMarketTime":990,
               "overnightMarketPrice":90, "overnightMarketTime":900}
        self.assertEqual(select_quote([row],1000)["price"],100)
        row.update(overnightMarketTime=999, marketState="OVERNIGHT")
        self.assertEqual(select_quote([row],1000)["session"],"夜盤")

    def test_missing_or_old_overnight_preserves_price(self):
        for stamp in [None, 1]:
            row={"currency":"USD","marketState":"OVERNIGHT","regularMarketPrice":100,
                 "regularMarketTime":999,"overnightMarketPrice":90,"overnightMarketTime":stamp}
            with self.assertRaises(ValueError): select_quote([row],10000)

    def test_invalid_price_currency_and_future(self):
        for row in [{"currency":"EUR","regularMarketPrice":100,"regularMarketTime":999},
                    {"currency":"USD","regularMarketPrice":float("nan"),"regularMarketTime":999},
                    {"currency":"USD","regularMarketPrice":100,"regularMarketTime":2000}]:
            with self.assertRaises(ValueError): select_quote([row],1000)

    @patch("quote_backend.yf.Ticker")
    def test_batch_overnight_parameter_partial_failure_and_dedup(self,ticker):
        row={"symbol":"AAPL","currency":"USD","marketState":"OVERNIGHT",
             "overnightMarketPrice":123.45,"overnightMarketTime":datetime.now(timezone.utc).timestamp()}
        ticker.return_value._data.get_raw_json.return_value={"quoteResponse":{"result":[row]}}
        result=fetch_us_quotes(["AAPL","AAPL","BAD"])
        self.assertEqual(result["quotes"]["AAPL"]["price"],123.45)
        self.assertIn("BAD",result["errors"])
        calls=ticker.return_value._data.get_raw_json.call_args_list
        self.assertEqual([c.kwargs["params"]["overnightPrice"] for c in calls],["true","false"])
        self.assertEqual(calls[0].kwargs["params"]["symbols"],"AAPL,BAD")

    @patch("quote_backend.yf.Ticker")
    def test_optional_snapshot_failure_does_not_discard_night(self,ticker):
        row={"symbol":"AAPL","currency":"USD","marketState":"OVERNIGHT",
             "overnightMarketPrice":123.45,"overnightMarketTime":datetime.now(timezone.utc).timestamp()}
        ticker.return_value._data.get_raw_json.side_effect=[{"quoteResponse":{"result":[row]}},RuntimeError("offline"),RuntimeError("offline")]
        self.assertEqual(fetch_us_quotes(["AAPL"])["quotes"]["AAPL"]["price"],123.45)

    @patch("quote_backend.yf.Ticker")
    def test_retry_alternate_host(self,ticker):
        row={"symbol":"AAPL","currency":"USD","regularMarketPrice":123.45,
             "regularMarketTime":datetime.now(timezone.utc).timestamp()}
        response={"quoteResponse":{"result":[row]}}
        ticker.return_value._data.get_raw_json.side_effect=[RuntimeError("offline"),response,response]
        self.assertIn("AAPL",fetch_us_quotes(["AAPL"])["quotes"])

    @patch("quote_backend.yf.Ticker")
    def test_invalid_input_never_requests(self,ticker):
        for symbols in [[], ["http://bad"], ["AAPL"]*51, None, [[]]]:
            with self.assertRaises(ValueError): fetch_us_quotes(symbols)
        ticker.assert_not_called()

    @patch("quote_backend.yf.Ticker")
    def test_incomplete_request_preserves_price(self,ticker):
        ticker.return_value._data.get_raw_json.side_effect=RuntimeError("offline")
        self.assertFalse(fetch_us_quotes(["AAPL"])["quotes"])

if __name__ == "__main__": unittest.main()
