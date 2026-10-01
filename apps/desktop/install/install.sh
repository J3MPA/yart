#!/bin/sh
# Installs yart: the app into ~/Applications and the yart and yart-mcp commands
# into ~/.local/bin. Installing over an existing install replaces it, which is
# how yart is updated. Nothing here needs sudo.
#
#   curl -fsSL https://github.com/J3MPA/yart/releases/latest/download/install.sh | sh
#
# YART_RELEASE_URL points it at somewhere else to download the app from.
#
# Downloaded with curl rather than a browser on purpose: macOS only checks an
# app with Gatekeeper when the download is marked quarantined, and curl does not
# mark it, so the app's free ad-hoc signature is enough for it to open.
set -eu

release_url=${YART_RELEASE_URL:-https://github.com/J3MPA/yart/releases/latest/download}
app_dir="$HOME/Applications"
bin_dir="$HOME/.local/bin"
app="$app_dir/yart.app"
bundle_id=io.github.j3mpa.yart
lsregister=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

say() { printf '%s\n' "$*"; }
fail() {
  printf 'yart: %s\n' "$*" >&2
  exit 1
}

[ "$(uname -s)" = Darwin ] || fail "yart only runs on macOS for now."

case "$(uname -m)" in
  arm64) arch=arm64 ;;
  x86_64)
    # A shell running under Rosetta reports Intel on Apple Silicon.
    if [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then
      arch=arm64
    else
      arch=x64
    fi
    ;;
  *) fail "unsupported architecture: $(uname -m)" ;;
esac

zip="yart-darwin-$arch.zip"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

say "Downloading $zip"
curl -fsSL -o "$work/$zip" "$release_url/$zip"
curl -fsSL -o "$work/$zip.sha256" "$release_url/$zip.sha256"
(cd "$work" && shasum -a 256 -c "$zip.sha256" >/dev/null 2>&1) ||
  fail "$zip does not match its checksum, so nothing was installed."
ditto -x -k "$work/$zip" "$work/unpacked"
[ -d "$work/unpacked/yart.app" ] || fail "$zip does not contain yart.app."

# A running app is not replaced underneath itself, and a daemon left running
# would go on serving the old version's code.
was_running=false
if [ "$(osascript -e "application id \"$bundle_id\" is running" 2>/dev/null)" = true ]; then
  was_running=true
  osascript -e "quit app id \"$bundle_id\"" >/dev/null 2>&1 || true
fi
pkill -f "$app/Contents/Resources/app.asar/packages/daemon/dist/cli.mjs" 2>/dev/null || true

updating=false
[ -d "$app" ] && updating=true
mkdir -p "$app_dir" "$bin_dir"
rm -rf "$app"
mv "$work/unpacked/yart.app" "$app"
# So that yart:// links reach it before it has ever been opened.
"$lsregister" -f "$app" 2>/dev/null || true

for command in yart yart-mcp; do
  link="$bin_dir/$command"
  if [ -e "$link" ] && [ ! -L "$link" ]; then
    say "Replacing $link, which was not a link to yart.app"
  fi
  ln -sf "$app/Contents/Resources/bin/$command" "$link"
done

version=$(defaults read "$app/Contents/Info" CFBundleShortVersionString 2>/dev/null || echo unknown)
if [ "$updating" = true ]; then
  say "Updated yart to $version in $app"
else
  say "Installed yart $version in $app"
fi
[ "$was_running" = true ] && open "$app"

case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *)
    say ""
    say "$bin_dir is not on your PATH, so the yart command will not be found."
    say "Add this line to your shell's profile, such as ~/.zshrc:"
    say "  export PATH=\"$bin_dir:\$PATH\""
    ;;
esac

if [ "$updating" = true ]; then
  say ""
  say "Agent sessions already running keep the old yart-mcp until they restart."
else
  # An absolute path, because Claude Code starts MCP servers with its own
  # environment, which may not include the shell's PATH.
  say ""
  say "To let Claude Code use yart, register it:"
  say "  claude mcp add -s user yart -- $bin_dir/yart-mcp"
  say ""
  say "Notifications and the dock badge are set under System Settings >"
  say "Notifications > yart once yart has sent its first notification. The badge"
  say "starts off there: turn on Badge application icon to see the unseen count."
fi
