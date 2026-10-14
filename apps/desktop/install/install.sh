#!/bin/sh
# Installs yart: the app into ~/Applications, and the yart and yart-mcp commands
# into ~/.local/bin. An install over an existing install replaces it. This is how
# yart updates. Nothing here needs sudo.
#
#   curl -fsSL https://github.com/J3MPA/yart/releases/latest/download/install.sh | sh
#
# YART_RELEASE_URL gives a different place to download the app from.
#
# Use curl, not a browser, on purpose. macOS examines an app with Gatekeeper only
# when the download has a quarantine mark. curl does not mark it. Thus the free
# ad-hoc signature of the app is sufficient to open it.
set -eu

# The release workflow puts the tag of this release here. Thus the installer of a
# release installs that release. Only this lets you install a pre-release, because
# "latest" on GitHub ignores pre-releases. When it is empty, as in the
# repository, it installs the latest release.
release_tag=
if [ -n "$release_tag" ]; then
  default_url="https://github.com/J3MPA/yart/releases/download/$release_tag"
else
  default_url=https://github.com/J3MPA/yart/releases/latest/download
fi
release_url=${YART_RELEASE_URL:-$default_url}
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
    # A shell that runs under Rosetta tells Intel on Apple Silicon.
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

# Do not replace an app while it runs. A daemon that still ran would continue to
# serve the code of the old version.
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
# Thus yart:// links get to the app before it was ever opened.
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
  # A full path, because Claude Code starts MCP servers with its own environment.
  # That environment can be without the PATH of the shell.
  say ""
  say "To let Claude Code use yart, register it:"
  say "  claude mcp add -s user yart -- $bin_dir/yart-mcp"
  say ""
  say "Notifications and the dock badge are set under System Settings >"
  say "Notifications > yart once yart has sent its first notification. The badge"
  say "starts off there: turn on Badge application icon to see the unseen count."
fi
