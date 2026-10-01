#!/bin/sh
# Removes yart: stops the app and its daemon, removes the app, and removes the
# yart and yart-mcp commands if they still point into it. Running it twice is
# harmless.
#
#   uninstall.sh [--purge]
#
# The app's own data, its seen state and drafts, is kept unless --purge is
# given, since a draft is something a person wrote. Reviews are never touched:
# they live in each repository's .git/yart and belong to that repository.
set -eu

app="$HOME/Applications/yart.app"
bin_dir="$HOME/.local/bin"
data="$HOME/Library/Application Support/yart"
bundle_id=io.github.j3mpa.yart
lsregister=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

purge=false
case "${1:-}" in
  --purge) purge=true ;;
  '') ;;
  *)
    printf 'yart: unknown option %s\n' "$1" >&2
    exit 1
    ;;
esac

say() { printf '%s\n' "$*"; }

if [ "$(osascript -e "application id \"$bundle_id\" is running" 2>/dev/null)" = true ]; then
  osascript -e "quit app id \"$bundle_id\"" >/dev/null 2>&1 || true
fi
pkill -f "$app/Contents/Resources/app.asar/packages/daemon/dist/cli.mjs" 2>/dev/null || true

if [ -d "$app" ]; then
  "$lsregister" -u "$app" 2>/dev/null || true
  rm -rf "$app"
  say "Removed $app"
else
  say "No yart.app in $HOME/Applications"
fi

for command in yart yart-mcp; do
  link="$bin_dir/$command"
  if [ -L "$link" ]; then
    case "$(readlink "$link")" in
      "$app"/*)
        rm -f "$link"
        say "Removed $link"
        ;;
    esac
  fi
done

if [ -d "$data" ]; then
  if [ "$purge" = true ]; then
    rm -rf "$data"
    say "Removed seen state and drafts from $data"
  else
    say "Kept seen state and drafts in $data; run with --purge to remove them."
  fi
fi

say ""
say "Reviews are left where they are, in each repository's .git/yart."
say "If yart is registered with Claude Code, remove it with:"
say "  claude mcp remove -s user yart"
