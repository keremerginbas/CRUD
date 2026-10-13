@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 veya daha yeni surumunu kurun, sonra bu dosyayi tekrar acin.
  pause
  exit /b 1
)
where pnpm >nul 2>nul
if errorlevel 1 (
  echo Once bir terminalde su komutu calistirin: npm install -g pnpm@10.15.1
  pause
  exit /b 1
)
call pnpm install --frozen-lockfile
if errorlevel 1 (
  echo Kurulum basarisiz. Yukaridaki hata mesajini kontrol edin.
  pause
  exit /b 1
)
if not exist .env copy .env.example .env >nul
call pnpm build
if errorlevel 1 (
  echo Derleme basarisiz. Yukaridaki hata mesajini kontrol edin.
  pause
  exit /b 1
)
echo Kurulum tamamlandi. 2-CRM-BASLAT.cmd dosyasini acin.
pause
