"""The installed service must give the measured ARM64 inference (~1.4 s) room to finish."""
import ast
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import server  # noqa: E402


class ProductionDeadlineTest(unittest.TestCase):
    def test_deadline_covers_measured_inference_and_stays_bounded(self):
        self.assertGreaterEqual(server.PRODUCTION_INFERENCE_TIMEOUT_SECONDS, 1.65)
        self.assertLessEqual(server.PRODUCTION_INFERENCE_TIMEOUT_SECONDS, 5)

    def test_main_passes_the_production_deadline_to_the_server(self):
        tree = ast.parse((ROOT / "server.py").read_text(encoding="utf-8"))
        main = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "main")
        calls = [node for node in ast.walk(main) if isinstance(node, ast.Call)
                 and getattr(node.func, "id", None) == "RuntimeServer"]
        self.assertEqual(len(calls), 1)
        keywords = {kw.arg: kw.value for kw in calls[0].keywords}
        self.assertIsInstance(keywords.get("inference_timeout"), ast.Name)
        self.assertEqual(keywords["inference_timeout"].id, "PRODUCTION_INFERENCE_TIMEOUT_SECONDS")


if __name__ == "__main__":
    unittest.main()
