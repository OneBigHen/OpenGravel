#!/usr/bin/env python3
"""OpenGravel board escalator: event-driven supervision for the opengravel-ios Hermes board.

Listens to `hermes kanban watch` (the board's own event stream, not a timer) and applies the
escalation ladder from docs/native-app/board/README.md:

  ogv-builder (DeepSeek) --blocked/gave up/3 review rounds--> ogv-sol (Codex gpt-6.1-sol)
  ogv-sol / ogv-reviewer --blocked/gave up--> Opus monitor (Claude Code headless on docker-dev)
  Opus monitor --only if the owner is truly needed--> owner message (hermes send)

Also wakes the Opus monitor when a gate card's parents are all done, and runs a light health sweep
(every 30 min) for things that produce no event: stranded ready cards, the Mac being unreachable.

Run as a systemd user service (ogv-escalator.service). State: ~/.hermes/ogv-escalator/state.json.
`--dry-run` logs decisions without acting. `--once TASK_ID KIND` handles one synthetic event.
"""
from __future__ import annotations

import argparse, json, os, re, shlex, subprocess, sys, threading, time
from datetime import datetime
from pathlib import Path

BOARD = os.environ.get("OGV_BOARD", "opengravel-ios")
OWNER_TARGET = os.environ.get("OGV_OWNER_TARGET", "slack")
OPUS_HOST = os.environ.get("OGV_OPUS_HOST", "dev-server")
OPUS_REPO = os.environ.get("OGV_OPUS_REPO", "/root/Vibe/ogv-opus-monitor")
OPUS_MAX_PER_DAY = int(os.environ.get("OGV_OPUS_MAX_PER_DAY", "8"))
SWEEP_SECONDS = int(os.environ.get("OGV_SWEEP_SECONDS", "600"))
STATE_DIR = Path.home() / ".hermes" / "ogv-escalator"
STATE_FILE = STATE_DIR / "state.json"
LOG_FILE = STATE_DIR / "escalator.log"
PATH_PREFIX = f"{Path.home()}/.local/bin:{Path.home()}/.npm-global/bin:{Path.home()}/bin"

WATCH_KINDS = "blocked,gave_up,block_loop_detected,changes_requested,completed,crashed,timed_out"
EVENT_RE = re.compile(r"^\[[^\]]+\]\s+(t_[0-9a-f]+)\s+(\S+)")
CARD_RE = re.compile(r"^\[([A-Z]\d{2})\]")
QUOTA_RE = re.compile(r"quota|rate.?limit|429|usage limit|exit(ed)? (code )?75|insufficient_quota", re.I)
OWNER_RE = re.compile(r"OWNER ASK:", re.I)

LADDER = {"ogv-builder": "ogv-sol"}          # next tier for implementation profiles
TOP_TIER = {"ogv-sol", "ogv-reviewer"}        # blocks here go to the Opus monitor

_lock = threading.Lock()


def log(msg: str) -> None:
    line = f"{datetime.now():%Y-%m-%d %H:%M:%S} {msg}"
    print(line, flush=True)
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    with LOG_FILE.open("a") as fh:
        fh.write(line + "\n")


def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {"tasks": {}, "opus_runs": [], "gates_notified": [], "mac_down_since": None}


def save_state(state: dict) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2))
    tmp.replace(STATE_FILE)


def run(cmd: list[str], timeout: int = 120) -> subprocess.CompletedProcess:
    env = dict(os.environ, PATH=f"{PATH_PREFIX}:{os.environ.get('PATH', '')}")
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=env)
    res.stdout = "\n".join(l for l in res.stdout.splitlines() if not l.startswith("Config ref"))
    return res


def kanban(*args: str, dry: bool = False, mutate: bool = True) -> str:
    cmd = ["hermes", "kanban", "--board", BOARD, *args]
    if dry and mutate:
        log(f"  DRY: {shlex.join(cmd)}")
        return ""
    res = run(cmd)
    if res.returncode != 0:
        log(f"  ! {shlex.join(cmd[:6])} failed: {res.stderr.strip()[-300:]}")
    return res.stdout


def show(task_id: str) -> dict | None:
    out = kanban("show", task_id, "--json", mutate=False)
    start = out.find("{")
    if start < 0:
        return None
    try:
        return json.loads(out[start:])
    except json.JSONDecodeError:
        return None


def card_id(task: dict) -> str:
    m = CARD_RE.match(task["task"]["title"])
    return m.group(1) if m else task["task"]["id"]


def tstate(state: dict, task_id: str) -> dict:
    return state["tasks"].setdefault(task_id, {"escalations": [], "changes_requested": 0, "quota_retries": 0})


# ---------------------------------------------------------------- tier moves

def escalate_to(task: dict, profile: str, why: str, state: dict, dry: bool) -> None:
    tid = task["task"]["id"]
    ts = tstate(state, tid)
    if profile in ts["escalations"]:
        log(f"  {tid} already escalated to {profile}; sending to Opus instead")
        return wake_opus("stuck-after-escalation", task, why, state, dry)
    prior = task["task"].get("assignee")
    note = (f"ESCALATED {prior} -> {profile} by ogv-escalator.\nWhy: {why}\n"
            f"Last summary: {(task.get('latest_summary') or '')[:800]}\n"
            "Pick up where the previous worker stopped: same branch and worktree, read every run summary and "
            "comment first (skill ogv-board-ops, 'Taking over an escalated card'). Do not restart from scratch "
            "unless you say why.")
    kanban("comment", "--author", "ogv-escalator", tid, note, dry=dry)
    kanban("reassign", "--reclaim", "--reason", f"escalated: {why[:120]}", tid, profile, dry=dry)
    if task["task"]["status"] in ("blocked", "triage"):
        kanban("unblock", tid, dry=dry)
    ts["escalations"].append(profile)
    log(f"  {card_id(task)} {tid}: {prior} -> {profile} ({why[:80]})")


def wake_opus(reason: str, task: dict | None, detail: str, state: dict, dry: bool) -> None:
    now = time.time()
    state["opus_runs"] = [t for t in state["opus_runs"] if now - t < 86400]
    label = card_id(task) if task else "board"
    if len(state["opus_runs"]) >= OPUS_MAX_PER_DAY:
        message = f"Opus escalation budget used up today ({OPUS_MAX_PER_DAY}); needs a look: {detail[:300]}"
        if task:
            kanban("comment", "--author", "ogv-escalator", task["task"]["id"], message, dry=dry)
        log(f"  Opus escalation budget exhausted for {label}")
        return
    tid = task["task"]["id"] if task else ""
    reach_board = (f"ssh megaplex \"pct exec 124 -- su claw -s /bin/bash -lc 'hermes kanban --board "
                   f"{BOARD} show {tid}'\"" if tid else
                   f"ssh megaplex \"pct exec 124 -- su claw -s /bin/bash -lc 'hermes kanban --board {BOARD} diagnostics'\"")
    wrap_up = ("End by writing a one-paragraph summary as a comment on the card (author opus-monitor)." if task else
               "End by recording a one-paragraph summary in your run log; if a card is affected, add the summary as its comment.")
    prompt = (
        f"You are the OpenGravel Opus monitor. Reason: {reason}. Card {label} ({tid}) on Hermes board {BOARD}.\n"
        f"Detail: {detail[:1500]}\n\n"
        "Read docs/native-app/board/OPUS-MONITOR.md in this repo first and follow it exactly. "
        f"Reach the board with: {reach_board}. Resolve it yourself if you can (re-scope, fix card, comment + unblock, gate review). "
        "Message the owner only for things only the owner can do, using the OWNER ASK format in OPUS-MONITOR.md. "
        f"{wrap_up}"
    )
    remote = (f"cd {shlex.quote(OPUS_REPO)} && git fetch -q origin main && git reset -q --hard origin/main; "
              f"nohup flock -w 1800 /tmp/ogv-opus.lock timeout 3600 claude -p --model opus --permission-mode auto "
              f"--permission-prompts none "
              f"{shlex.quote(prompt)} > /tmp/ogv-opus-{label}-{int(now)}.log 2>&1 < /dev/null &")
    if dry:
        log(f"  DRY opus <- {reason} {label}")
        return
    res = run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", OPUS_HOST, remote], timeout=60)
    state["opus_runs"].append(now)
    log(f"  Opus woken for {label} ({reason}): rc={res.returncode}")
    if res.returncode != 0:
        if task:
            kanban("comment", "--author", "ogv-escalator", tid,
                   f"Could not start Opus monitor ({reason}): {res.stderr.strip()[-300:]}", dry=dry)


# ---------------------------------------------------------------- event handling

def handle(task_id: str, kind: str, state: dict, dry: bool) -> None:
    task = show(task_id)
    if not task:
        return
    assignee = task["task"].get("assignee")
    status = task["task"]["status"]
    summary = task.get("latest_summary") or ""
    log(f"event {kind} {card_id(task)} {task_id} @{assignee} status={status}")

    if kind == "completed":
        return check_gates(state, dry)

    if assignee is None:                       # owner/gate/backlog cards are expected to sit blocked
        return

    ts = tstate(state, task_id)
    if kind == "changes_requested":
        ts["changes_requested"] += 1
        if ts["changes_requested"] >= 3 and assignee in LADDER:
            escalate_to(task, LADDER[assignee], f"{ts['changes_requested']} review rounds without approval", state, dry)
        return

    if kind in ("crashed", "timed_out"):       # the dispatcher retries these itself; gave_up follows if it can't
        return

    if status not in ("blocked", "triage"):
        return
    last_block = next((e for e in reversed(task.get("events", [])) if e.get("kind") == "blocked"), {})
    block_kind = (last_block.get("payload") or {}).get("kind")
    if block_kind == "dependency":
        return

    if QUOTA_RE.search(summary) and ts["quota_retries"] < 3:
        ts["quota_retries"] += 1
        delay = 1800 * ts["quota_retries"]
        log(f"  quota-looking block; retry {ts['quota_retries']}/3 in {delay // 60} min")
        if not dry:
            threading.Timer(delay, lambda: kanban("unblock", task_id)).start()
        return

    if OWNER_RE.search(summary) and assignee in TOP_TIER:
        return wake_opus("owner-ask-review", task, summary, state, dry)   # Opus decides whether to bother the owner

    if assignee in LADDER:
        return escalate_to(task, LADDER[assignee], f"{kind}: {summary[:300]}", state, dry)
    if assignee in TOP_TIER:
        return wake_opus(f"{assignee}-{kind}", task, summary, state, dry)


def check_gates(state: dict, dry: bool) -> None:
    out = kanban("list", "--json", mutate=False)
    start = out.find("[") if out.find("[") >= 0 and (out.find("{") < 0 or out.find("[") < out.find("{")) else out.find("{")
    try:
        data = json.loads(out[start:]) if start >= 0 else []
    except json.JSONDecodeError:
        return
    tasks = data if isinstance(data, list) else data.get("tasks", [])
    for t in tasks:
        title = t.get("title", "")
        if not title.startswith("[G") or t.get("status") != "blocked" or t["id"] in state["gates_notified"]:
            continue
        full = show(t["id"])
        if not full:
            continue
        parents = full.get("parents", [])
        if parents and all((p.get("status") if isinstance(p, dict) else None) in ("done", "archived") for p in parents):
            state["gates_notified"].append(t["id"])
            wake_opus("gate-ready", full, f"All parents of {title} are done. Run the gate checklist.", state, dry)


def sweep(state: dict, dry: bool) -> None:
    diag = kanban("diagnostics", mutate=False)
    if re.search(r"stranded|stuck|critical", diag, re.I):
        log("sweep: diagnostics flagged problems")
        wake_opus("board-diagnostics", None, diag[-1500:], state, dry)
    mac = run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "macbook", "true"], timeout=30)
    if mac.returncode != 0:
        run([f"{Path.home()}/bin/wake-mac.py", "--timeout", "60"], timeout=90)
        mac = run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "macbook", "true"], timeout=30)
    if mac.returncode != 0:
        if not state.get("mac_down_since"):
            state["mac_down_since"] = time.time()
            wake_opus("mac-unreachable", None,
                      "The MacBook build rig is unreachable after one wake attempt. Swift cards will wait; "
                      "check power, dock, and FileVault if owner action is needed.", state, dry)
    elif state.get("mac_down_since"):
        state["mac_down_since"] = None
        wake_opus("mac-restored", None, "The MacBook build rig is reachable again.", state, dry)
    check_gates(state, dry)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--once", nargs=2, metavar=("TASK_ID", "KIND"))
    ap.add_argument("--sweep-now", action="store_true")
    args = ap.parse_args()
    state = load_state()

    if args.once:
        handle(args.once[0], args.once[1], state, args.dry_run)
        save_state(state)
        return
    if args.sweep_now:
        sweep(state, args.dry_run)
        save_state(state)
        return

    def sweeper():
        while True:
            with _lock:
                try:
                    sweep(state, args.dry_run)
                    save_state(state)
                except Exception as exc:  # keep supervising whatever happens
                    log(f"sweep error: {exc!r}")
            time.sleep(SWEEP_SECONDS)

    threading.Thread(target=sweeper, daemon=True).start()
    log(f"ogv-escalator watching board {BOARD} ({'dry-run' if args.dry_run else 'live'})")
    env = dict(os.environ, PATH=f"{PATH_PREFIX}:{os.environ.get('PATH', '')}")
    proc = subprocess.Popen(["hermes", "kanban", "--board", BOARD, "watch", "--kinds", WATCH_KINDS, "--interval", "2"],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env)
    assert proc.stdout
    for line in proc.stdout:
        m = EVENT_RE.match(line.strip())
        if not m:
            continue
        with _lock:
            try:
                handle(m.group(1), m.group(2), state, args.dry_run)
                save_state(state)
            except Exception as exc:
                log(f"handler error on {line.strip()[:120]}: {exc!r}")
    sys.exit(f"watch stream ended (rc={proc.wait()}); systemd will restart the escalator")


if __name__ == "__main__":
    main()
