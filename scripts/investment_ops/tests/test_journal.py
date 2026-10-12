"""Synthetic contract tests, not broker response fixtures or mapping evidence."""
import copy
import unittest
from unittest.mock import Mock, patch

from investment_ops.domain import DomainValidationError
from investment_ops.journal import JournalError, batch_hash, import_batch, readiness, validate_batch


def synthetic_batch():
    trade = {
        "source_key": "TEST:2026-10-09:order1:fill1", "market": "US", "symbol": "TEST",
        "name": "Synthetic test", "currency": "USD", "side": "BUY", "trade_date": "2026-10-09",
        "executed_at": "2026-10-10T00:30:00+09:00", "settlement_date": None,
        "quantity": "0.12345678", "price": "100.00", "gross_amount": "12.345678",
        "fee": None, "tax": None, "status": "PROVISIONAL",
    }
    return {"schema_version": 1, "account_alias": "namuh-general", "source": "MANUAL_IMPORT", "complete": True,
            "observed_at": "2026-10-10T06:00:00+09:00", "executions": [trade],
            "cash_events": [{"source_key": "TEST:deposit1", "occurred_at": "2026-10-09T01:00:00Z", "currency": "USD", "kind": "DEPOSIT", "amount": "100", "description": "Synthetic deposit"}],
            "balances": [{"currency": "USD", "cash": "100", "withdrawable": None, "buying_power": "200", "settlements": [{"date": "2026-10-12", "amount": "-12.345678"}]}]}


class JournalTests(unittest.TestCase):
    def test_timezone_and_missing_costs_preserved(self):
        row = validate_batch(synthetic_batch())["executions"][0]
        self.assertEqual(row["executed_at"], "2026-10-09T15:30:00Z")
        self.assertEqual(row["trade_date"], "2026-10-09")
        self.assertEqual(row["quantity"], "0.12345678")
        self.assertIsNone(row["fee"])

    def test_partial_fills_retained_and_hash_reorder_stable(self):
        batch = synthetic_batch()
        second = copy.deepcopy(batch["executions"][0]); second["source_key"] += ":2"
        batch["executions"].append(second)
        original = validate_batch(batch)
        batch["executions"].reverse()
        self.assertEqual(batch_hash(original), batch_hash(validate_batch(batch)))
        self.assertEqual(len(original["executions"]), 2)

    def test_duplicate_fill_and_currency_rejected(self):
        for field in ("executions", "balances", "cash_events"):
            batch = synthetic_batch(); batch[field].append(copy.deepcopy(batch[field][0]))
            with self.assertRaises(JournalError): validate_batch(batch)

    def test_incomplete_batch_no_write(self):
        batch = synthetic_batch(); batch["complete"] = False
        client = Mock()
        with self.assertRaises(JournalError): import_batch(batch, "00000000-0000-0000-0000-000000000001", client=client)
        client.rpc.assert_not_called()

    def test_float_negative_quantity_and_future_observation_rejected(self):
        for key, value in [("price", 100.1), ("quantity", "-1"), ("executed_at", "2027-01-01T00:00:00Z")]:
            batch = synthetic_batch(); batch["executions"][0][key] = value
            with self.assertRaises((JournalError, DomainValidationError)): validate_batch(batch)

    def test_naive_timestamp_rejected(self):
        batch = synthetic_batch(); batch["observed_at"] = "2026-10-10T06:00:00"
        with self.assertRaises(DomainValidationError): validate_batch(batch)

    def test_unknown_fields_including_secret_rejected(self):
        batch = synthetic_batch(); batch["app_secret"] = "SYNTHETIC"
        with self.assertRaises(JournalError): validate_batch(batch)

    def test_isa_cannot_import_us_trades(self):
        batch = synthetic_batch(); batch["account_alias"] = "namuh-isa"
        with self.assertRaises(JournalError): validate_batch(batch)

    def test_atomic_rpc_instead_of_individual_writes(self):
        client = Mock(); client.rpc.return_value.execute.return_value.data = "synthetic-id"
        result = import_batch(synthetic_batch(), "00000000-0000-0000-0000-000000000001", client=client)
        self.assertEqual(result, "synthetic-id")
        client.rpc.assert_called_once()
        client.table.assert_not_called()

    def test_readiness_never_claims_verified_broker_mapping(self):
        status = readiness({"timezone": "Asia/Seoul", "collection_times": ["06:00", "16:00"], "user_id": None})
        self.assertFalse(status["collection_ready"])

    def test_deferred_kiwoom_does_not_require_credentials(self):
        with patch.dict('os.environ', {}, clear=True):
            status = readiness({"timezone": "Asia/Seoul", "collection_times": ["06:00", "16:00"], "user_id": None,
                                "accounts": [{"alias": "namuh-general", "enabled": True}, {"alias": "namuh-isa", "enabled": True}, {"alias": "kiwoom-main", "enabled": False}]})
        self.assertEqual(status["active_accounts"], ["namuh-general", "namuh-isa"])
        self.assertNotIn("KIWOOM_APP_KEY", status["missing_environment"])
        self.assertIn("NAMUH_APP_KEY", status["missing_environment"])


if __name__ == "__main__": unittest.main()
