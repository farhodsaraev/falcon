#!/usr/bin/env bash
# Removes Falcon from this Mac. No administrator password needed.
#
#   bash uninstall.sh [--delete-data | --keep-data] [--yes]
# or, without a copy of Falcon:
#   curl -fsSL https://raw.githubusercontent.com/farhodsaraev/falcon/main/installer/uninstall.sh | bash
#
# It removes the Falcon app, his files, the engine he runs on and its start-at-login entry. What Falcon
# remembers about the user and the AI key are removed only when the user agrees (or --delete-data).
set -uo pipefail

FALCON_HOME="${FALCON_HOME:-$HOME/Library/Application Support/Falcon}"
DELETE_DATA=""
ASSUME_YES=""
for arg in "$@"; do
  case "$arg" in
    --delete-data) DELETE_DATA=yes ;;
    --keep-data) DELETE_DATA=no ;;
    --yes|-y) ASSUME_YES=yes ;;
  esac
done
say() { printf '  %s\n' "$1"; }

# Questions go to the person at the keyboard, even when this script arrived through a pipe.
ask() {
  local answer=""
  if [ -r /dev/tty ]; then read -r -p "  $1 " answer </dev/tty || answer=""; fi
  printf '%s' "$answer"
}

printf '\n  F A L C O N   uninstall\n\n'
if [ -z "$ASSUME_YES" ]; then
  case "$(ask 'Remove Falcon from this Mac? [y/N]')" in [yY]*) ;; *) say "Nothing was removed."; exit 0 ;; esac
fi
if [ -z "$DELETE_DATA" ]; then
  if [ -n "$ASSUME_YES" ]; then DELETE_DATA=no
  else
    case "$(ask 'Also delete what Falcon remembers about you, his connections (such as Telegram) and your AI key? [y/N]')" in
      [yY]*) DELETE_DATA=yes ;; *) DELETE_DATA=no ;;
    esac
  fi
fi

# ---- 1. Close Falcon ----
pkill -f "$FALCON_HOME/app/src/app/launch.js" 2>/dev/null || true
pkill -f "$HOME/.falcon/window" 2>/dev/null || true

# ---- 2. The engine: its start-at-login entry, then the engine itself ----
OPENCLAW=""
for candidate in "$HOME/.openclaw/bin/openclaw" "$(command -v openclaw 2>/dev/null || true)"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then OPENCLAW="$candidate"; break; fi
done
if [ -n "$OPENCLAW" ]; then
  say "Stopping the engine..."
  "$OPENCLAW" uninstall --service --yes --non-interactive >/dev/null 2>&1 || true
fi
pkill -f "openclaw.*gateway" 2>/dev/null || true
for agent in "$HOME"/Library/LaunchAgents/*openclaw*.plist; do
  [ -e "$agent" ] || continue
  launchctl bootout "gui/$(id -u)" "$agent" >/dev/null 2>&1 || true
  rm -f "$agent"
done
# The engine Falcon's installer puts in place lives in the user's own folder, with its own Node.js.
rm -rf "$HOME/.openclaw/bin" "$HOME/.openclaw/tools"

# ---- 3. The Falcon app and his files ----
say "Removing Falcon..."
rm -rf "$HOME/Applications/Falcon.app" "$FALCON_HOME"
[ -L "$HOME/Desktop/Falcon" ] && rm -f "$HOME/Desktop/Falcon"

# ---- 4. What Falcon knows, only if the user agreed ----
if [ "$DELETE_DATA" = yes ]; then
  rm -rf "$HOME/.openclaw" "$HOME/.falcon" "$HOME/Documents/Falcon Samples" "$HOME/Library/Logs/Falcon.log"
  say "Falcon has been removed, together with what he remembered."
else
  say "Falcon has been removed. What he remembers about you was kept."
fi
printf '\n'
# Started from Falcon's own Settings there is no Terminal to read this: say it on screen instead.
if [ ! -t 1 ] && command -v osascript >/dev/null 2>&1; then
  osascript -e 'display notification "Falcon has been removed." with title "Falcon"' >/dev/null 2>&1 || true
fi
exit 0
