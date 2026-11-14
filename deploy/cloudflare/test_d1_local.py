"""SQLite compatibility check for the D1 schema and atomic SQL; no Cloudflare calls."""
import sqlite3
import unittest
from pathlib import Path


SCHEMA = Path(__file__).with_name("schema.sql").read_text(encoding="utf-8")
MIGRATION = Path(__file__).with_name("migrations").joinpath("0001_initial.sql").read_text(encoding="utf-8")


class D1LocalSqlTests(unittest.TestCase):
    def test_versioned_migration_matches_reviewed_schema(self):
        self.assertEqual(MIGRATION, SCHEMA)

    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        self.db.executescript(SCHEMA)

    def test_one_time_challenge_and_owner_scoped_history(self):
        self.db.execute("INSERT INTO challenges VALUES(?,?,?,?,?,?,0)",
                        ("nonce", "a.testnet", "message", "host", "https://host", 100,))
        claim = "UPDATE challenges SET used=1 WHERE nonce_hash=? AND used=0 AND expires_at>?"
        self.assertEqual(self.db.execute(claim, ("nonce", 50)).rowcount, 1)
        self.assertEqual(self.db.execute(claim, ("nonce", 50)).rowcount, 0)
        self.db.execute("INSERT INTO sessions VALUES(?,?,?,?,?,0)",
                        ("token", "a.testnet", "https://host", "public", 100))
        self.assertIsNone(self.db.execute(
            "SELECT owner FROM sessions WHERE token_hash=? AND owner=?",
            ("token", "b.testnet")).fetchone())
        self.db.execute("INSERT INTO observed_payments VALUES(?,?,?)", ("a.testnet", "pay1", 50))
        self.assertEqual(self.db.execute(
            "SELECT payment_id FROM observed_payments WHERE owner=?",
            ("b.testnet",)).fetchall(), [])

    def test_atomic_rate_limit_and_cleanup(self):
        sql = ("INSERT INTO rate_limits(bucket,scope,subject_hash,hits) VALUES(?,?,?,1) "
               "ON CONFLICT(bucket,scope,subject_hash) DO UPDATE SET hits=hits+1 WHERE hits<?")
        for expected in (1, 1, 0):
            self.assertEqual(self.db.execute(sql, (2000, "auth", "hashed-ip", 2)).rowcount, expected)
        self.assertEqual(self.db.execute("SELECT hits FROM rate_limits").fetchone()[0], 2)
        self.db.execute("DELETE FROM rate_limits WHERE bucket<?", (2001,))
        self.assertEqual(self.db.execute("SELECT count(*) FROM rate_limits").fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main()
