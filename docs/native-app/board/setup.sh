#!/usr/bin/env bash
# One-time, idempotent Hermes setup for the OpenGravel iPhone board.
# Run on Hermes (CT124) as user claw. Usage: setup.sh [--parallel]
set -euo pipefail
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"

REPO=/mnt/hermes-bulk/ogv/OpenGravel
BOARD=opengravel-ios
PROJECT=opengravel

quiet() { "$@" 2>&1 | grep -v -E '^Config ref|DirectSDK' || true; }

# 1. Repository on the data disk (the root disk is nearly full).
if [ ! -d "$REPO/.git" ]; then
  mkdir -p "$(dirname "$REPO")"
  git clone https://github.com/OneBigHen/OpenGravel.git "$REPO"
fi
git -C "$REPO" fetch -q origin main
grep -qxF '.worktrees/' "$REPO/.git/info/exclude" || echo '.worktrees/' >> "$REPO/.git/info/exclude"

# 2. Worker profiles, cloned from vibe-dev, with their own default model.
set_model() { # profile model provider
  python3 - "$HOME/.hermes/profiles/$1/config.yaml" "$2" "$3" <<'PY'
import re, sys
path, model, provider = sys.argv[1:]
text = open(path).read()
m = re.search(r'(?ms)^model:\n(.*?)(?=^\S)', text)
if not m:
    sys.exit(f"no top-level model: block in {path}")
block = m.group(1)
block = re.sub(r'(?m)^(\s+default:\s*).*$', lambda g: g.group(1) + model, block, count=1)
block = re.sub(r'(?m)^(\s+provider:\s*).*$', lambda g: g.group(1) + provider, block, count=1)
open(path, 'w').write(text[:m.start(1)] + block + text[m.end(1):])
print(f"{path}: model={model} provider={provider}")
PY
}
make_profile() { # name model provider description
  if ! quiet hermes profile list | grep -qw "$1"; then
    quiet hermes profile create "$1" --clone-from vibe-dev --description "$4"
  fi
  set_model "$1" "$2" "$3"
}
make_profile ogv-builder deepseek/deepseek-v4.1-flash commandcode \
  "OpenGravel iPhone implementer. Builds one card at a time in its worktree, following docs/native-app/ENGINEERING.md."
make_profile ogv-sol gpt-6.1-sol openai-codex \
  "OpenGravel iPhone implementer for hard cards (scaffold, mac-gate, contract, map, navigation)."
make_profile ogv-reviewer gpt-6.1-sol openai-codex \
  "OpenGravel iPhone reviewer. Approves only with passing gates and screenshots that match SPEC.md; squash-merges on approval."

# 2b. Personas (SOUL.md) and the shared board skill for each profile.
for p in ogv-builder ogv-sol ogv-reviewer; do
  install -m 644 "$REPO/tools/hermes/profiles/$p/SOUL.md" "$HOME/.hermes/profiles/$p/SOUL.md"
  install -D -m 644 "$REPO/tools/hermes/skills/ogv-board-ops/SKILL.md" \
    "$HOME/.hermes/profiles/$p/skills/opengravel/ogv-board-ops/SKILL.md"
done
install -D -m 644 "$REPO/tools/hermes/skills/ogv-board-ops/SKILL.md" "$HOME/.hermes/skills/opengravel/ogv-board-ops/SKILL.md"

# 3. Board and project.
if ! quiet hermes kanban boards list | grep -qw "$BOARD"; then
  quiet hermes kanban boards create "$BOARD" --name "OpenGravel iPhone" \
    --description "Native SwiftUI iPhone app. Plan: docs/native-app/PLAN.md" --default-workdir "$REPO"
fi
if ! quiet hermes project list | grep -qw "$PROJECT"; then
  quiet hermes project create "OpenGravel" "$REPO" --slug "$PROJECT" --primary "$REPO" --board "$BOARD"
else
  quiet hermes project bind-board "$PROJECT" "$BOARD"
fi

# 4. Escalator: event-driven supervision (DeepSeek -> Sol -> Opus -> owner).
mkdir -p "$HOME/.hermes/ogv-escalator" "$HOME/.config/systemd/user"
install -m 755 "$REPO/tools/hermes/ogv-escalator/ogv_escalator.py" "$HOME/.hermes/ogv-escalator/ogv_escalator.py"
install -m 644 "$REPO/tools/hermes/ogv-escalator/ogv-escalator.service" "$HOME/.config/systemd/user/ogv-escalator.service"
systemctl --user daemon-reload
systemctl --user enable --now ogv-escalator.service
systemctl --user restart ogv-escalator.service

# 5. Optional: more cards in flight at once.
if [ "${1:-}" = "--parallel" ]; then
  python3 - "$HOME/.hermes/config.yaml" <<'PY'
import re, sys
p = sys.argv[1]; t = open(p).read()
t = re.sub(r'(?m)^(  max_in_progress:\s*)\d+', r'\g<1>3', t)
pattern = r'(?m)^(  max_in_progress_per_profile:\s*).*$'
t, count = re.subn(pattern, r'\g<1>2', t, count=1)
if count == 0:
    t, count = re.subn(r'(?m)^(  max_in_progress:\s*.*)$', r'\g<1>\n  max_in_progress_per_profile: 2', t, count=1)
if count == 0:
    sys.exit("could not find kanban.max_in_progress in config")
open(p, 'w').write(t); print("kanban: max_in_progress=3, per_profile=2 (restart the gateway to apply)")
PY
fi

echo "Setup done. Next: python3 $REPO/docs/native-app/board/load_board.py --dry-run"
