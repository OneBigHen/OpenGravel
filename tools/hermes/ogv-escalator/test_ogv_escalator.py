"""Offline unit coverage for Hermes board setup and escalation behavior."""
import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))
import configure_parallel  # noqa: E402
import ogv_escalator  # noqa: E402

LOAD_BOARD_PATH = ROOT / "docs/native-app/board/load_board.py"
spec = importlib.util.spec_from_file_location("load_board", LOAD_BOARD_PATH)
load_board = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(load_board)


def task(task_id="t_123abc", assignee="ogv-builder", status="blocked", title="[F02] Scaffold"):
    return {
        "task": {"id": task_id, "assignee": assignee, "status": status, "title": title},
        "latest_summary": "worker needs help",
        "events": [{"kind": "blocked", "payload": {"kind": "worker"}}],
    }


class EscalatorTests(unittest.TestCase):
    def setUp(self):
        self.state = {"tasks": {}, "opus_runs": [], "gates_notified": [], "mac_down_since": None}

    def test_builder_block_escalates_reassigns_and_unblocks(self):
        with patch.object(ogv_escalator, "show", return_value=task()), \
             patch.object(ogv_escalator, "kanban") as kanban, \
             patch.object(ogv_escalator, "log"):
            ogv_escalator.handle("t_123abc", "blocked", self.state, dry=False)

        self.assertEqual([call.args[0] for call in kanban.call_args_list], ["comment", "reassign", "unblock"])
        self.assertEqual(kanban.call_args_list[1].args[1:], ("--reclaim", "--reason", "escalated: blocked: worker needs help", "t_123abc", "ogv-sol"))
        self.assertEqual(self.state["tasks"]["t_123abc"]["escalations"], ["ogv-sol"])

    def test_dependency_block_does_not_escalate(self):
        blocked = task()
        blocked["events"][-1]["payload"]["kind"] = "dependency"
        with patch.object(ogv_escalator, "show", return_value=blocked), \
             patch.object(ogv_escalator, "kanban") as kanban, \
             patch.object(ogv_escalator, "log"):
            ogv_escalator.handle("t_123abc", "blocked", self.state, dry=False)
        kanban.assert_not_called()
        self.assertEqual(self.state["tasks"]["t_123abc"]["escalations"], [])

    def test_third_review_rejection_escalates(self):
        review_task = task(status="in_progress")
        with patch.object(ogv_escalator, "show", return_value=review_task), \
             patch.object(ogv_escalator, "kanban") as kanban, \
             patch.object(ogv_escalator, "log"):
            for _ in range(3):
                ogv_escalator.handle("t_123abc", "changes_requested", self.state, dry=False)
        self.assertEqual(self.state["tasks"]["t_123abc"]["changes_requested"], 3)
        self.assertEqual(self.state["tasks"]["t_123abc"]["escalations"], ["ogv-sol"])
        self.assertEqual(kanban.call_args_list[0].args[0], "comment")

    def test_opus_uses_headless_no_prompt_permission_flag(self):
        with patch.object(ogv_escalator.time, "time", return_value=1234), \
             patch.object(ogv_escalator, "run") as run, \
             patch.object(ogv_escalator, "log"):
            run.return_value.returncode = 0
            ogv_escalator.wake_opus("sol-blocked", task(assignee="ogv-sol"), "blocked", self.state, dry=False)
        command = run.call_args.args[0]
        self.assertIn("--permission-prompts none", command[-1])
        self.assertEqual(self.state["opus_runs"], [1234])

    def test_failed_opus_start_is_recorded_on_card_without_owner_message(self):
        with patch.object(ogv_escalator, "run", return_value=subprocess.CompletedProcess([], 255, "", "ssh failed")), \
             patch.object(ogv_escalator, "kanban") as kanban, \
             patch.object(ogv_escalator, "log"):
            ogv_escalator.wake_opus("sol-blocked", task(assignee="ogv-sol"), "blocked", self.state, dry=False)
        self.assertEqual(kanban.call_args.args[0:3], ("comment", "--author", "ogv-escalator"))
        self.assertIn("Could not start Opus monitor", kanban.call_args.args[4])

    def test_mac_down_wakes_opus_once_without_direct_owner_message(self):
        failed = subprocess.CompletedProcess([], 255, "", "unreachable")
        with patch.object(ogv_escalator, "kanban", return_value=""), \
             patch.object(ogv_escalator, "run", side_effect=[failed, failed, failed]), \
             patch.object(ogv_escalator, "wake_opus") as wake_opus, \
             patch.object(ogv_escalator.time, "time", return_value=1234), \
             patch.object(ogv_escalator, "log"):
            ogv_escalator.sweep(self.state, dry=False)
        self.assertEqual(self.state["mac_down_since"], 1234)
        self.assertEqual(wake_opus.call_args.args[0:2], ("mac-unreachable", None))

    def test_returning_mac_wakes_opus(self):
        self.state["mac_down_since"] = 1000
        with patch.object(ogv_escalator, "kanban", return_value=""), \
             patch.object(ogv_escalator, "run", return_value=subprocess.CompletedProcess([], 0, "", "")), \
             patch.object(ogv_escalator, "wake_opus") as wake_opus, \
             patch.object(ogv_escalator, "log"):
            ogv_escalator.sweep(self.state, dry=False)
        self.assertIsNone(self.state["mac_down_since"])
        self.assertEqual(wake_opus.call_args.args[0:2], ("mac-restored", None))


class BoardSetupTests(unittest.TestCase):
    def test_parallel_limit_is_added_when_missing_and_updated_when_present(self):
        for source, expected in (
            ("kanban:\n  max_in_progress: 2\n", "kanban:\n  max_in_progress: 3\n  max_in_progress_per_profile: 2\n"),
            ("kanban:\n  max_in_progress: 2\n  max_in_progress_per_profile: 9\n", "kanban:\n  max_in_progress: 3\n  max_in_progress_per_profile: 2\n"),
        ):
            with self.subTest(source=source), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "config.yaml"
                path.write_text(source)
                configure_parallel.configure(path)
                self.assertEqual(path.read_text(), expected)

    def test_checked_in_cards_have_resolvable_acyclic_dependencies(self):
        cards_dir = ROOT / "docs/native-app/board/cards"
        cards = {card["id"]: card for card in (load_board.parse_card(p) for p in sorted(cards_dir.glob("*.md")))}
        order = load_board.topo(cards)
        self.assertEqual(len(cards), 51)
        self.assertEqual(len(order), len(cards))

    def test_topological_sort_rejects_unknown_parent_and_cycle(self):
        with self.assertRaises(SystemExit):
            load_board.topo({"A": {"parents": ["MISSING"]}})
        with self.assertRaises(SystemExit):
            load_board.topo({"A": {"parents": ["B"]}, "B": {"parents": ["A"]}})


if __name__ == "__main__":
    unittest.main()
