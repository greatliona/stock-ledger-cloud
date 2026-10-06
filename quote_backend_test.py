import unittest
from unittest.mock import patch
from datetime import datetime, timezone
import pandas as pd
from quote_backend import fetch_us_quotes

class QuoteTests(unittest.TestCase):
    @patch("quote_backend.yf.Ticker")
    def test_success_partial_failure_and_deduplication(self, ticker):
        good = unittest.mock.Mock()
        good.history.return_value = pd.DataFrame({"Close":[123.45]}, index=pd.DatetimeIndex([datetime.now(timezone.utc)]))
        good.history_metadata = {"currency":"USD"}
        ticker.side_effect = [good, RuntimeError("offline")]
        result = fetch_us_quotes(["AAPL", "AAPL", "BAD"])
        self.assertEqual(result["quotes"]["AAPL"]["price"],123.45)
        self.assertIn("BAD",result["errors"])
        self.assertEqual(ticker.call_count,2)
    @patch("quote_backend.yf.Ticker")
    def test_invalid_input_never_requests(self, ticker):
        for symbols in [[], ["http://bad"], ["AAPL"] * 51, None]:
            with self.assertRaises(ValueError): fetch_us_quotes(symbols)
        ticker.assert_not_called()
    @patch("quote_backend.yf.Ticker")
    def test_wrong_currency_and_old_quote(self, ticker):
        ticker.return_value.history.return_value = pd.DataFrame({"Close":[12]}, index=pd.DatetimeIndex(["2020-01-01"],tz="UTC"))
        ticker.return_value.history_metadata = {"currency":"USD"}
        self.assertFalse(fetch_us_quotes(["AAPL"])["quotes"])
        ticker.return_value.history_metadata = {"currency":"EUR"}
        self.assertFalse(fetch_us_quotes(["AAPL"])["quotes"])

if __name__ == "__main__": unittest.main()
