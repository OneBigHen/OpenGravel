#!/usr/bin/env python3
"""Set the OpenGravel Hermes kanban concurrency limits in config.yaml."""
import re
import sys
from pathlib import Path


def configure(path: Path) -> None:
    text = path.read_text()
    text = re.sub(r"(?m)^(  max_in_progress:\s*)\d+", r"\g<1>3", text)
    pattern = r"(?m)^(  max_in_progress_per_profile:\s*).*$"
    text, count = re.subn(pattern, r"\g<1>2", text, count=1)
    if count == 0:
        text, count = re.subn(
            r"(?m)^(  max_in_progress:\s*.*)$",
            r"\g<1>\n  max_in_progress_per_profile: 2",
            text,
            count=1,
        )
    if count == 0:
        raise ValueError("could not find kanban.max_in_progress in config")
    path.write_text(text)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(f"usage: {Path(sys.argv[0]).name} CONFIG.yaml")
    configure(Path(sys.argv[1]))
    print("kanban: max_in_progress=3, per_profile=2 (restart the gateway to apply)")


if __name__ == "__main__":
    main()
