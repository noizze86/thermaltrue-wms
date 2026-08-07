@echo off
echo === Thermaltrue Cost Fix Deployer ===
echo This window will run with admin privileges.
echo.
echo Step 1: Force-killing server process...
taskkill /F /IM server.exe >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Process killed
) else (
    echo [WARN] taskkill returned %errorlevel% (may already be stopped)
)
echo.
timeout /t 5 /nobreak >nul
echo Step 2: Copying server.exe...
copy /Y "C:\test wms\thermaltrue\target\release\server.exe" "C:\Program Files\Thermaltrue\server.exe"
if %errorlevel% equ 0 (
    echo [OK] server.exe deployed successfully
) else (
    echo [FAIL] Copy failed with code %errorlevel%
)
echo.
echo Step 3: Starting service...
sc start ThermaltrueServer >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Service started
) else (
    echo [WARN] sc start returned %errorlevel% (starting via fallback)
    start "" "C:\Program Files\Thermaltrue\server.exe" run
)
echo.
echo === Deployment complete ===
echo.
pause
