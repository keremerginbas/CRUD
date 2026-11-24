#!/bin/bash
# J.A.R.V.I.S. açılış ekranı — macOS başlatıcı
DIR="$(cd "$(dirname "$0")" && pwd)"

# Girişte çağrıldıysa masaüstü ve internet hazır olsun diye bekle
[ "$1" = "--giris" ] && sleep 6

# --- Takvimi indir (ayarlar.js içindeki TAKVIM_URL) ---
URLS=$(sed -n 's/^[[:space:]]*TAKVIM_URL[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$DIR/ayarlar.js" | head -1)
if [ -n "$URLS" ]; then
  TMP="$(mktemp)"
  IFS=',' read -ra LIST <<< "$URLS"
  for u in "${LIST[@]}"; do
    u="$(echo "$u" | xargs)"; u="${u/#webcal:\/\//https://}"
    [ -n "$u" ] && curl -fsSL --max-time 15 "$u" >> "$TMP" && printf '\r\n' >> "$TMP"
  done
  if [ -s "$TMP" ]; then
    printf 'window.TAKVIM_ICS_B64 = "%s";\n' "$(base64 < "$TMP" | tr -d '\n')" > "$DIR/takvim.js"
  fi
  rm -f "$TMP"
fi

# --- Ekranı aç: Edge > Chrome > Brave > Safari ---
PAGE="file://${DIR// /%20}/index.html"
PROFILE="$HOME/Library/Application Support/JarvisEkrani"
for APP in "Microsoft Edge" "Google Chrome" "Brave Browser"; do
  if [ -d "/Applications/$APP.app" ] || [ -d "$HOME/Applications/$APP.app" ]; then
    open -na "$APP" --args --app="$PAGE" --start-fullscreen \
      --autoplay-policy=no-user-gesture-required \
      --user-data-dir="$PROFILE" --no-first-run --no-default-browser-check
    exit 0
  fi
done
open -a Safari "$PAGE"
