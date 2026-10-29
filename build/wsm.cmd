@echo off
setlocal
set ELECTRON_RUN_AS_NODE=1
REM bin\wsm.cmd -> ..\WorkspaceManager.exe; bin\cmd\wsm.cmd -> ..\..\WorkspaceManager.exe
set "ROOT="
if exist "%~dp0..\WorkspaceManager.exe" (
  for %%I in ("%~dp0..") do set "ROOT=%%~fI"
)
if not defined ROOT if exist "%~dp0..\..\WorkspaceManager.exe" (
  for %%I in ("%~dp0..\..") do set "ROOT=%%~fI"
)
if not defined ROOT (
  echo Workspace Manager CLI executable not found. 1>&2
  exit /b 1
)
set "EXE=%ROOT%\WorkspaceManager.exe"
set "CLI=%ROOT%\resources\app.asar\out\cli\index.js"
REM Windows PowerShell 5 (and VS Code/Copilot ConPTY) reads the console buffer of native
REM commands. WorkspaceManager.exe is a GUI-subsystem binary, so that ReadConsoleOutput
REM fails with Access Denied 0x5. Redirect so the GUI process never owns the console.
set "OUT=%TEMP%\wsm-%RANDOM%%RANDOM%.out"
set "ERR=%TEMP%\wsm-%RANDOM%%RANDOM%.err"
"%EXE%" "%CLI%" %* >"%OUT%" 2>"%ERR%"
set "CODE=%ERRORLEVEL%"
type "%OUT%"
type "%ERR%" 1>&2
del /f /q "%OUT%" "%ERR%" >nul 2>&1
exit /b %CODE%
