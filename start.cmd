@echo off
setlocal
title limen-onebot
pushd "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto no_node

if not exist ".env" (
  node scripts\init.mjs
  if errorlevel 1 goto failed
)

node scripts\launch.mjs
if errorlevel 1 goto failed
goto done

:no_node
echo.
echo [ERROR] Node.js 22.5 or newer is required.
echo         Download: https://nodejs.org/
echo.
pause
goto done

:failed
echo.
echo [ERROR] Startup failed. See the messages above.
echo.
pause

:done
popd
endlocal
exit /b 0
