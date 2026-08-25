@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul
title GitLite - Dev

:: go to script dir
pushd "%~dp0"

echo ==========================================
echo   GitLite One-Click Start (Tauri Dev)
echo ==========================================
echo.

:: --- kill previous instance ---
echo [0/3] Checking for previous instance...
set "FOUND=0"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":1420" ^| findstr "LISTENING"') do (
    if not "%%a"=="0" (
        echo   Found process on port 1420 PID=%%a, killing...
        taskkill /PID %%a /F >nul 2>nul
        set "FOUND=1"
    )
)
:: Fallback: any process holding 1420 (ESTABLISHED, etc.)
if "!FOUND!"=="0" (
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":1420"') do (
        if not "%%a"=="0" (
            echo   Found process on port 1420 PID=%%a, killing...
            taskkill /PID %%a /F >nul 2>nul
            set "FOUND=1"
        )
    )
)
:: Also kill stray GitLite.exe if still running
tasklist ^| findstr /I "GitLite.exe" >nul 2>nul
if not errorlevel 1 (
    echo   Found GitLite.exe, killing...
    taskkill /IM GitLite.exe /F >nul 2>nul
    set "FOUND=1"
)
if "!FOUND!"=="1" (
    echo   Previous instance stopped, waiting 2s for port release...
    timeout /t 2 /nobreak >nul
) else (
    echo   No previous instance found.
)
echo.

:: --- check env ---
echo [1/3] Checking environment...

:: Fix cargo not in PATH after rustup install (default location)
if exist "%USERPROFILE%\.cargo\bin\cargo.exe" set "PATH=%USERPROFILE%\.cargo\bin;!PATH!"

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found. Please install Node.js 18+ from https://nodejs.org/
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo   Node: %%v

where cargo >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Rust/Cargo not found. Please install Rust from https://rustup.rs/
    echo   Also ensure %USERPROFILE%\.cargo\bin is in PATH and restart terminal
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('cargo --version') do echo   Rust: %%v

where git >nul 2>nul
if errorlevel 1 (
    echo [WARN] Git not found, some features will be unavailable
) else (
    for /f "tokens=*" %%v in ('git --version') do echo   Git: %%v
)

echo.

:: --- deps ---
echo [2/3] Checking dependencies...
if not exist "node_modules" (
    echo   node_modules not found, running npm install...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed
        echo   Hint: try npm config set registry https://registry.npmmirror.com
        pause
        exit /b 1
    )
) else (
    echo   Dependencies exist, skip install.
)

echo.

:: --- start ---
echo [3/3] Starting Tauri dev...
echo   Command: npm run tauri:dev
echo   Note: first build may take 1-3 minutes
echo   Press Ctrl+C to stop
echo.

call npm run tauri:dev

if errorlevel 1 (
    echo.
    echo [ERROR] Start failed. Common causes:
    echo   1. Port 1420 still occupied - manually run netstat -ano ^| findstr 1420
    echo   2. Rust compile error - run rustup update
    echo   3. Missing VS Build Tools - see TROUBLESHOOTING.md
    echo   4. Tauri CLI missing - run npm install -g @tauri-apps/cli
)

echo.
pause
popd
endlocal
