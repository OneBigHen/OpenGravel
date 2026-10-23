#!/usr/bin/env python3
"""Create the OpenGravel iPhone cards on the Hermes board from cards/*.md.

Idempotent: every card uses the idempotency key ogv-ios:<ID>, so re-running
returns existing task ids instead of duplicating cards.

usage: load_board.py [--dry-run] [--board opengravel-ios]
"""
import argparse, json, os, re, subprocess, sys, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
CARDS = HERE / "cards"
REPO_SLUG = "OneBigHen/OpenGravel"
PREAMBLE = """> **Card {id} · OpenGravel iPhone.** Before anything else, read `docs/native-app/ENGINEERING.md` §1 (worker contract),
> then the sections of `docs/native-app/SPEC.md` named below. Your worktree is your current directory; branch `{branch}`.
> Finish with exactly one board call. For code or doc changes: `kanban_request_review(reviewer="ogv-reviewer", ...)`.

"""


def parse_card(path: Path) -> dict:
    text = path.read_text()
    m = re.match(r"(?s)^---\n(.*?)\n---\n(.*)$", text)
    if not m:
        sys.exit(f"{path.name}: missing front matter")
    meta, body = {}, m.group(2).strip() + "\n"
    for line in m.group(1).splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, _, value = line.partition(":")
        value = value.strip()
        if value.startswith("[") and value.endswith("]"):
            value = [v.strip() for v in value[1:-1].split(",") if v.strip()]
        elif value.lower() in ("true", "false"):
            value = value.lower() == "true"
        meta[key.strip()] = value
    for req in ("id", "title"):
        if req not in meta:
            sys.exit(f"{path.name}: missing {req}")
    meta.setdefault("parents", [])
    meta.setdefault("skills", [])
    meta.setdefault("blocked", False)
    meta.setdefault("contract", "local" if meta["blocked"] else "pr")
    meta["body"] = body
    meta["slug"] = re.sub(r"[^a-z0-9]+", "-", meta["title"].lower()).strip("-")[:40].rstrip("-")
    meta["branch"] = f"ogv/{meta['id'].lower()}-{meta['slug']}"
    return meta


def topo(cards: dict) -> list:
    order, seen, stack = [], set(), set()

    def visit(cid):
        if cid in seen:
            return
        if cid in stack:
            sys.exit(f"dependency cycle at {cid}")
        if cid not in cards:
            sys.exit(f"unknown parent {cid}")
        stack.add(cid)
        for p in cards[cid]["parents"]:
            visit(p)
        stack.discard(cid)
        seen.add(cid)
        order.append(cid)

    for cid in sorted(cards):
        visit(cid)
    return order


def hermes(args: list, dry: bool) -> str:
    cmd = ["hermes", *args]
    if dry:
        print("  $", " ".join(a if " " not in a else repr(a) for a in cmd))
        return ""
    env = dict(os.environ, PATH=f"{Path.home()}/.local/bin:{Path.home()}/.npm-global/bin:" + os.environ.get("PATH", ""))
    res = subprocess.run(cmd, capture_output=True, text=True, env=env)
    out = "\n".join(l for l in res.stdout.splitlines() if not l.startswith("Config ref"))
    if res.returncode != 0:
        sys.exit(f"hermes {' '.join(args[:4])} failed:\n{out}\n{res.stderr[-2000:]}")
    return out


def task_id(output: str) -> str:
    start = output.find("{")
    if start >= 0:
        try:
            data = json.loads(output[start:])
            for key in ("id", "task_id"):
                if key in data:
                    return data[key]
            if isinstance(data.get("task"), dict):
                return data["task"]["id"]
        except json.JSONDecodeError:
            pass
    m = re.search(r"\bt_[0-9a-f]{6,}\b", output)
    if not m:
        sys.exit(f"could not find a task id in:\n{output}")
    return m.group(0)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--board", default="opengravel-ios")
    args = ap.parse_args()

    cards = {c["id"]: c for c in (parse_card(p) for p in sorted(CARDS.glob("*.md")))}
    ids = {}
    for cid in topo(cards):
        c = cards[cid]
        print(f"{cid}: {c['title']}")
        with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as fh:
            fh.write(PREAMBLE.format(id=cid, branch=c["branch"]) + c["body"])
            body_file = fh.name
        cmd = ["kanban", "--board", args.board, "create", f"[{cid}] {c['title']}",
               "--body-file", body_file, "--idempotency-key", f"ogv-ios:{cid}",
               "--created-by", "ogv-plan", "--json"]
        if c.get("assignee"):
            cmd += ["--assignee", c["assignee"]]
        for p in c["parents"]:
            cmd += ["--parent", ids[p]]
        if c.get("priority"):
            cmd += ["--priority", str(c["priority"])]
        if c["blocked"]:
            cmd += ["--initial-status", "blocked"]
        else:
            cmd += ["--project", "opengravel", "--workspace", "worktree", "--branch", c["branch"],
                    "--max-runtime", str(c.get("max_runtime", "2h"))]
        cmd += ["--completion-contract", REPO_SLUG if c["contract"] == "pr" else "local-only"]
        for s in (["ogv-board-ops"] if not c["blocked"] else []) + c["skills"]:
            cmd += ["--skill", s]
        out = hermes(cmd, args.dry_run)
        ids[cid] = f"<{cid}>" if args.dry_run else task_id(out)
        os.unlink(body_file)
    print(f"\n{len(ids)} cards {'would be ' if args.dry_run else ''}on board {args.board}.")
    if not args.dry_run:
        dest = Path.home() / ".hermes" / "ogv-ios-task-ids.json"
        dest.write_text(json.dumps(ids, indent=2))
        print(f"Card id -> task id map: {dest}")


if __name__ == "__main__":
    main()
