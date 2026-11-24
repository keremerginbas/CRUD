#!/bin/bash
# JARVIS'i ~/Jarvis klasörüne kopyalar ve her girişte açılmasını sağlar.
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Jarvis"
PLIST="$HOME/Library/LaunchAgents/com.jarvis.acilis.plist"

# İndirilenler/Masaüstü gibi korumalı klasörlerden açılışta okunamaz; o yüzden ~/Jarvis'e kopyalanır.
mkdir -p "$DEST"
if [ "$SRC" != "$DEST" ]; then
  # Mevcut ayarlar.js varsa üzerine yazma
  [ -f "$DEST/ayarlar.js" ] && cp "$DEST/ayarlar.js" "$DEST/.ayarlar.yedek"
  cp -R "$SRC/." "$DEST/"
  [ -f "$DEST/.ayarlar.yedek" ] && mv "$DEST/.ayarlar.yedek" "$DEST/ayarlar.js"
fi
chmod +x "$DEST/baslat-mac.sh"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.jarvis.acilis</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$DEST/baslat-mac.sh</string>
    <string>--giris</string>
  </array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo ""
echo "  [OK] JARVIS kuruldu: $DEST"
echo "  Her girişte seni karşılayacak, patron. (Şimdi de açılıyor...)"
echo "  Ayarlar (şehir, takvim): open -e ~/Jarvis/ayarlar.js"
echo "  Kaldırmak için: bash ~/Jarvis/kaldir-mac.sh"
