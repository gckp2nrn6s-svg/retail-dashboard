#!/bin/zsh
# Stop and remove the NAV bridge launchd services.
UID_NUM="$(id -u)"
LA="$HOME/Library/LaunchAgents"
for svc in navproxy navtunnel; do
  label="com.lesouverain.$svc"
  launchctl bootout "gui/$UID_NUM/$label" 2>/dev/null || true
  rm -f "$LA/$label.plist"
  echo "removed $label"
done
echo "✓ NAV bridge services uninstalled."
