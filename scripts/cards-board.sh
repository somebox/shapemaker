#!/usr/bin/env bash
# Keep the committed Cards snapshot synchronized with local board state.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ws="$root/.cards"
snapshot="$ws/backlog.jsonl"
cards_bin="${CARDS_BIN:-cards}"

command -v "$cards_bin" >/dev/null 2>&1 || {
  echo "cards-board: cannot find cards binary ($cards_bin)" >&2
  exit 1
}

export_board() {
  "$cards_bin" export --workspace "$ws" --state-only --out "$snapshot"
  echo "cards-board: wrote ${snapshot#$root/}"
}

check_board() {
  local tmp
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' RETURN
  "$cards_bin" export --workspace "$ws" --state-only --out "$tmp" >/dev/null
  if ! cmp -s "$snapshot" "$tmp"; then
    echo "cards-board: ${snapshot#$root/} is stale; run scripts/cards-board.sh export" >&2
    exit 1
  fi
  echo "cards-board: snapshot is current"
}

install_hook() {
  local name="$1" hook="$root/.git/hooks/$1"
  [ -d "$root/.git" ] || { echo "cards-board: not a git repository" >&2; exit 1; }
  if [ -e "$hook" ]; then
    echo "cards-board: refusing to overwrite existing $name hook: $hook" >&2
    exit 1
  fi
  cat > "$hook" <<HOOK
#!/usr/bin/env bash
set -euo pipefail
cd "$root"
scripts/cards-board.sh $([ "$name" = pre-commit ] && echo export || echo check)
HOOK
  chmod +x "$hook"
  echo "cards-board: installed $name hook"
}

case "${1:-}" in
  export) export_board ;;
  check) check_board ;;
  install-hooks)
    for hook in pre-commit pre-push; do
      [ ! -e "$root/.git/hooks/$hook" ] || {
        echo "cards-board: refusing to overwrite existing $hook hook: $root/.git/hooks/$hook" >&2
        exit 1
      }
    done
    install_hook pre-commit
    install_hook pre-push
    ;;
  *) echo "usage: scripts/cards-board.sh {export|check|install-hooks}" >&2; exit 2 ;;
esac
