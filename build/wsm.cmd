@echo off
setlocal
set ELECTRON_RUN_AS_NODE=1
set "EXE=%~dp0..\WorkspaceManager.exe"
set "CLI=%~dp0..\resources\app.asar\out\cli\index.js"
REM PowerShell 7 wraps native commands by reading the console buffer. WorkspaceManager.exe
REM is a GUI subsystem binary, so that ReadConsoleOutput fails with Access Denied 0x5.
REM Redirect to files so the GUI process never owns the console, then replay through cmd.
set "OUT=%TEMP%\wsm-%RANDOM%%RANDOM%.out"
set "ERR=%TEMP%\wsm-%RANDOM%%RANDOM%.err"
"%EXE%" "%CLI%" %* >"%OUT%" 2>"%ERR%"
set "CODE=%ERRORLEVEL%"
type "%OUT%"
type "%ERR%" 1>&2
del /f /q "%OUT%" "%ERR%" >nul 2>&1
exit /b %CODE%
