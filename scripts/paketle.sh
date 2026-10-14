#!/usr/bin/env bash
# cPanel'e yüklenecek zip'i hazırlar: React build + server (node_modules, veritabanı ve .env hariç).
set -euo pipefail
cd "$(dirname "$0")/.."
# Panelin yayınlanacağı alt yol (kök dizin için: BASE_PATH= npm run paket)
BASE_PATH="${BASE_PATH-/sms}"
PUBLIC_URL="$BASE_PATH" npm run build
rm -rf dist && mkdir -p dist/sms-otomasyon
cp -r build dist/sms-otomasyon/build
mkdir -p dist/sms-otomasyon/server
cp -r server/src server/scripts server/package.json server/package-lock.json server/.env.example dist/sms-otomasyon/server/
cp KURULUM-CPANEL.md dist/sms-otomasyon/
(cd dist && zip -qr sms-otomasyon-cpanel.zip sms-otomasyon)
echo "Hazır: dist/sms-otomasyon-cpanel.zip"
