@echo off
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\WorkspaceManager.exe" "%~dp0..\resources\app.asar\out\cli\index.js" %*
exit /b %ERRORLEVEL%
