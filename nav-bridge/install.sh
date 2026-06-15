#!/bin/zsh
# Install the NAV bridge as two always-on macOS launchd services:
#   • com.lesouverain.navproxy  — runs nav-proxy.js on :4001 (talks to NAV SQL)
#   • com.lesouverain.navtunnel — ngrok static domain → :4001 (stable public URL)
#
# Both auto-start on login and auto-restart on crash/sleep, so the dashboard's
# NAV data path no longer dies when the laptop sleeps or ngrok is closed.
#
# Usage:  ./nav-bridge/install.sh <your-static-domain.ngrok-free.app>
set -e

DOMAIN="$1"
if [[ -z "$DOMAIN" ]]; then
  echo "ERROR: pass your ngrok static domain, e.g.:"
  echo "  ./nav-bridge/install.sh le-souverain-nav.ngrok-free.app"
  exit 1
fi
# strip any scheme the user may have pasted
DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN%/}"

DIR="$(cd "$(dirname "$0")" && pwd)"
LA="$HOME/Library/LaunchAgents"
mkdir -p "$LA"

# Free :4001 from any manually-started proxy so the launchd one can bind it.
echo "→ Freeing port 4001 (any manual proxy)…"
lsof -ti :4001 2>/dev/null | xargs kill -9 2>/dev/null || true

echo "→ Installing proxy service…"
cp "$DIR/com.lesouverain.navproxy.plist" "$LA/com.lesouverain.navproxy.plist"

echo "→ Generating tunnel service for domain: $DOMAIN"
sed "s/__NGROK_DOMAIN__/$DOMAIN/" "$DIR/com.lesouverain.navtunnel.plist.template" \
  > "$LA/com.lesouverain.navtunnel.plist"

UID_NUM="$(id -u)"
for svc in navproxy navtunnel; do
  label="com.lesouverain.$svc"
  echo "→ (Re)loading $label…"
  launchctl bootout "gui/$UID_NUM/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$UID_NUM" "$LA/$label.plist"
  launchctl enable "gui/$UID_NUM/$label"
done

echo ""
echo "✓ Installed. Both services are running and will auto-start on login."
echo "  Logs:   $DIR/navproxy.log   $DIR/navtunnel.log"
echo "  Status: launchctl list | grep lesouverain"
echo ""
echo "Next: point Railway at the stable URL (once, never again):"
echo "  railway variables --set NAV_PROXY_URL=https://$DOMAIN"
