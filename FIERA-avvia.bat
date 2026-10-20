@echo off
rem INSIDE MONICHS - avvio per la fiera (offline).
rem Avvia il server locale e apre Chrome a schermo intero in modalita' kiosk.
cd /d "%~dp0"
if not exist "dist\index.html" (
  echo.
  echo   Build mancante. Eseguire prima: npm install  e poi  npm run build
  echo.
  pause
  exit /b 1
)
start "Inside Monichs - server" /min node scripts\serve-dist.mjs 8080
timeout /t 2 /nobreak >nul
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
  echo   Chrome non trovato: aprire manualmente http://localhost:8080 e premere F per lo schermo intero.
  start "" http://localhost:8080/
  exit /b 0
)
rem profilo dedicato: il kiosk si apre anche se Chrome e' gia' aperto; l'audio parte senza clic
start "" "%CHROME%" --kiosk --autoplay-policy=no-user-gesture-required --no-first-run --disable-pinch --overscroll-history-navigation=0 --disable-features=Translate --user-data-dir="%LocalAppData%\InsideMonichsKiosk" http://localhost:8080/
