@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title XRE CRM
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js bulunamadi. https://nodejs.org adresinden Node.js 22 LTS kurun,
  echo bilgisayari yeniden baslatmadan bu dosyaya tekrar cift tiklayin.
  start "" https://nodejs.org/tr/download
  pause
  exit /b 1
)
where pnpm >nul 2>nul
if errorlevel 1 (
  echo pnpm kuruluyor...
  call npm install -g pnpm@10.15.1
  if errorlevel 1 (
    echo pnpm kurulamadi. Bu dosyaya sag tiklayip "Yonetici olarak calistir" deneyin.
    pause
    exit /b 1
  )
)
if not exist node_modules\express (
  echo Paketler kuruluyor ^(ilk acilista birkac dakika surer^)...
  call pnpm install --frozen-lockfile
  if errorlevel 1 (
    echo Paket kurulumu basarisiz. Internet baglantinizi kontrol edin.
    pause
    exit /b 1
  )
)
if not exist .env copy .env.example .env >nul
if not exist dist\server.js (
  echo Uygulama derleniyor...
  call pnpm build
  if errorlevel 1 (
    echo Derleme basarisiz. Yukaridaki hatayi gonderin.
    pause
    exit /b 1
  )
)
set "OLDPID="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":3000 .*LISTENING"') do set "OLDPID=%%p"
if defined OLDPID (
  echo.
  echo 3000 portunu baska bir program kullaniyor ^(PID %OLDPID%^). Buyuk ihtimalle eski XRE CRM acik.
  choice /c EH /m "Eski CRM kapatilsin mi"
  if errorlevel 2 (
    echo Eski pencereyi kapatip bu dosyayi tekrar acin.
    pause
    exit /b 1
  )
  taskkill /PID %OLDPID% /F >nul
  timeout /t 2 >nul
)
echo.
echo XRE CRM aciliyor: http://localhost:3000
echo Bu pencereyi KAPATMAYIN. Kapatirsaniz CRM durur.
echo.
start "" cmd /c "timeout /t 4 >nul & start "" http://localhost:3000"
node scripts/start-local.mjs
pause
