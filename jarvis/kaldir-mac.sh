#!/bin/bash
PLIST="$HOME/Library/LaunchAgents/com.jarvis.acilis.plist"
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
echo "  JARVIS girişten kaldırıldı. (Dosyalar ~/Jarvis içinde duruyor, istersen silebilirsin.)"
