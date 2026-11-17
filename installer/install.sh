#!/usr/bin/env bash
# Falcon installer for macOS. No administrator password needed.
#
# One line, pasted into Terminal:
#   curl -fsSL https://raw.githubusercontent.com/farhodsaraev/falcon/main/installer/install.sh | bash
#
# It installs the engine Falcon runs on (which brings Node.js if missing), copies Falcon
# into this user's Library, creates a Falcon app with an icon, and opens Falcon's window.
# The window itself then asks for the AI key and finishes the setup.
#
# Options (environment variables): FALCON_NO_LAUNCH=1, FALCON_HOME=<folder>, FALCON_ZIP_URL=<url>
set -euo pipefail

FALCON_HOME="${FALCON_HOME:-$HOME/Library/Application Support/Falcon}"
APP_DIR="$FALCON_HOME/app"
ZIP_URL="${FALCON_ZIP_URL:-https://github.com/farhodsaraev/falcon/archive/refs/heads/main.zip}"
LOG="${TMPDIR:-/tmp}/falcon-install.log"
say() { printf '  %s\n' "$1"; }
fail() { printf '\n  Falcon could not be installed: %s\n  Details: %s\n\n' "$1" "$LOG" >&2; exit 1; }

printf '\n  F A L C O N\n\n'
: >"$LOG"

# Finds a command the way a new Terminal window would, so tools installed a moment ago are seen.
find_tool() {
  local name="$1" found=""
  for dir in "$HOME/.openclaw/bin" "$HOME/.openclaw/tools/node/bin" "$HOME/.local/bin" "$HOME/.npm-global/bin"; do
    if [ -x "$dir/$name" ]; then found="$dir/$name"; break; fi
  done
  # FALCON_PRETEND_BARE=1 is for testing only: behave as on a Mac with no developer tools at all.
  if [ -z "$found" ] && [ -z "${FALCON_PRETEND_BARE:-}" ]; then
    for dir in /opt/homebrew/bin /usr/local/bin; do
      if [ -x "$dir/$name" ]; then found="$dir/$name"; break; fi
    done
    if [ -z "$found" ]; then found="$(command -v "$name" 2>/dev/null || true)"; fi
    if [ -z "$found" ] && [ -x /bin/zsh ]; then
      found="$(/bin/zsh -lic "command -v $name" 2>/dev/null | grep '^/' | tail -1 || true)"
    fi
  fi
  printf '%s' "$found"
}
node_major() { "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

# ---- 1. Engine ----
# Installed into this user's own folder together with its own private copy of Node.js. This route
# needs no Homebrew, no developer tools and no administrator password, so it works on any Mac.
OPENCLAW="$(find_tool openclaw)"
if [ -z "$OPENCLAW" ]; then
  say "Installing the engine (a few minutes)..."
  ENGINE_INSTALLER="$(mktemp "${TMPDIR:-/tmp}/falcon-engine.XXXXXX")"
  curl -fsSL https://openclaw.ai/install-cli.sh -o "$ENGINE_INSTALLER" >>"$LOG" 2>&1 || fail "the engine installer could not be downloaded"
  # Run it from a file with nothing on its input, so it can never sit waiting for an answer nobody sees.
  /bin/bash "$ENGINE_INSTALLER" --no-onboard >>"$LOG" 2>&1 </dev/null || { rm -f "$ENGINE_INSTALLER"; fail "the engine did not install"; }
  rm -f "$ENGINE_INSTALLER"
  OPENCLAW="$(find_tool openclaw)"
  [ -n "$OPENCLAW" ] || fail "the engine was installed but cannot be found"
fi

# Node.js: prefer the one the engine itself runs on.
NODE=""
ENGINE_REAL="$(/usr/bin/python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$OPENCLAW" 2>/dev/null || echo "$OPENCLAW")"
for candidate in "$HOME/.openclaw/tools/node/bin/node" "$(dirname "$OPENCLAW")/node" "$(dirname "$ENGINE_REAL")/node" "$(find_tool node)"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ] && [ "$(node_major "$candidate")" -ge 24 ]; then NODE="$candidate"; break; fi
done
if [ -z "$NODE" ]; then
  # Last resort: ask the engine's own launcher which Node it uses.
  NODE="$(head -1 "$ENGINE_REAL" 2>/dev/null | sed -n 's/^#!\(\/[^ ]*node\).*/\1/p')"
  [ -n "$NODE" ] && [ -x "$NODE" ] && [ "$(node_major "$NODE")" -ge 24 ] || fail "Node.js 24 or newer was not found"
fi

# ---- 2. Falcon's files ----
copy_falcon() {
  local from="$1"
  # A running Falcon would keep serving his old files: close him first (only his own processes).
  pkill -f "$APP_DIR/src/app/launch.js" 2>/dev/null || true
  rm -rf "$APP_DIR"
  mkdir -p "$APP_DIR/src"
  cp -R "$from/src/app" "$APP_DIR/src/app"
  cp -R "$from/ui" "$APP_DIR/ui"
  cp -R "$from/falcon-agent" "$APP_DIR/falcon-agent"
  cp "$from/installer/falcon.png" "$APP_DIR/falcon.png" 2>/dev/null || cp "$from/falcon.png" "$APP_DIR/falcon.png" 2>/dev/null || true
  printf '{ "name": "falcon", "version": "0.1.0", "private": true, "type": "module" }\n' >"$APP_DIR/package.json"
  # Sample files so the "things to try" work on a fresh Mac
  local samples="$HOME/Documents/Falcon Samples"
  if [ -d "$from/demo" ] && [ ! -e "$samples" ]; then
    mkdir -p "$samples" && find "$from/demo" -maxdepth 1 -type f ! -name '~$*' -exec cp {} "$samples/" \; 2>>"$LOG" || true
  fi
}

SELF_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; fi
if [ -n "$SELF_DIR" ] && [ -f "$SELF_DIR/src/app/launch.js" ]; then
  say "Copying Falcon..."
  copy_falcon "$SELF_DIR"
else
  say "Downloading Falcon..."
  TMP="$(mktemp -d)"
  curl -fsSL "$ZIP_URL" -o "$TMP/falcon.zip" >>"$LOG" 2>&1 || fail "the download failed"
  /usr/bin/unzip -q "$TMP/falcon.zip" -d "$TMP/unpacked" >>"$LOG" 2>&1 || fail "the download could not be unpacked"
  LAUNCH="$(find "$TMP/unpacked" -path '*/src/app/launch.js' | head -1)"
  [ -n "$LAUNCH" ] || fail "the downloaded package is incomplete"
  copy_falcon "$(cd "$(dirname "$LAUNCH")/../.." && pwd)"
  rm -rf "$TMP"
fi
[ -f "$APP_DIR/src/app/launch.js" ] || fail "the Falcon files were not copied"

# ---- 3. The Falcon app: an icon in Applications and on the Desktop ----
say "Adding the Falcon app..."
BUNDLE="$HOME/Applications/Falcon.app"
rm -rf "$BUNDLE"
mkdir -p "$BUNDLE/Contents/MacOS" "$BUNDLE/Contents/Resources" "$HOME/Library/Logs"
cat >"$BUNDLE/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Falcon</string>
  <key>CFBundleDisplayName</key><string>Falcon</string>
  <key>CFBundleIdentifier</key><string>com.farhodsaraev.falcon</string>
  <key>CFBundleVersion</key><string>0.1.0</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>Falcon</string>
  <key>CFBundleIconFile</key><string>Falcon</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSMicrophoneUsageDescription</key><string>Falcon listens when you speak to him.</string>
  <key>NSAppleEventsUsageDescription</key><string>Falcon opens and controls apps such as Keynote for you.</string>
</dict>
</plist>
PLIST
cat >"$BUNDLE/Contents/MacOS/Falcon" <<LAUNCHER
#!/bin/bash
# Starts Falcon's window. Written by the Falcon installer.
export PATH="$(dirname "$NODE"):$(dirname "$OPENCLAW"):\$HOME/.openclaw/bin:\$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$APP_DIR" || exit 1
exec "$NODE" src/app/launch.js >>"\$HOME/Library/Logs/Falcon.log" 2>&1
LAUNCHER
chmod +x "$BUNDLE/Contents/MacOS/Falcon"
if [ -f "$APP_DIR/falcon.png" ]; then
  # Build a proper Mac icon from the picture; if that fails Falcon still works, with a plain icon.
  ICONSET="$(mktemp -d)/Falcon.iconset"
  mkdir -p "$ICONSET"
  for size in 16 32 128 256; do
    sips -z "$size" "$size" "$APP_DIR/falcon.png" --out "$ICONSET/icon_${size}x${size}.png" >>"$LOG" 2>&1 || true
  done
  iconutil -c icns "$ICONSET" -o "$BUNDLE/Contents/Resources/Falcon.icns" >>"$LOG" 2>&1 || true
fi
ln -sfn "$BUNDLE" "$HOME/Desktop/Falcon" 2>>"$LOG" || true

# ---- 4. Open Falcon ----
say "Done."
if [ -z "${FALCON_NO_LAUNCH:-}" ]; then
  say "Opening Falcon..."
  open "$BUNDLE" || fail "Falcon was installed but did not open; double-click Falcon in Applications"
fi
printf '\n'
