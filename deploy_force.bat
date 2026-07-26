@echo off
cd /d "C:\test wms\thermaltrue"
echo ========================================
echo Thermaltrue - Force Deploy
echo ========================================
echo.
echo Step 1/4: Stopping service...
sc.exe stop ThermaltrueServer >nul 2>&1
timeout /t 2 /nobreak >nul

echo Step 2/4: Force-kill any lingering process...
taskkill /f /im server.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo Step 3/5: Copying server.exe...
copy /Y "target\release\server.exe" "C:\Program Files\Thermaltrue\server.exe"
if %errorlevel% neq 0 (
    echo [FAIL] Copy failed! Is the file still locked?
    pause
    exit /b 1
)

echo Step 4/5: Copying frontend dist...
if exist "C:\Program Files\Thermaltrue\dist" rmdir /S /Q "C:\Program Files\Thermaltrue\dist"
xcopy /E /I /Q "dist" "C:\Program Files\Thermaltrue\dist" >nul

echo Step 5/5: Starting service...
sc.exe start ThermaltrueServer >nul 2>&1
timeout /t 3 /nobreak >nul

echo.
sc.exe query ThermaltrueServer | findstr STATE
echo.
echo Done!
pause
