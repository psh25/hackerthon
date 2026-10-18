@echo off
"%SystemRoot%\System32\chcp.com" 65001 >nul
setlocal EnableExtensions DisableDelayedExpansion
set "APP_DIR=%~dp0"
if exist "%APP_DIR%scripts\launch.mjs" goto found_app
set "APP_DIR=%~dp0qixue-campus-spaces\"
if exist "%APP_DIR%scripts\launch.mjs" goto found_app
echo Project files not found. Extract the entire ZIP first, then run start.cmd.
pause
exit /b 1

:found_app
cd /d "%APP_DIR%"
if errorlevel 1 goto bad_directory
set "NODE_EXE="
if exist "%APP_DIR%runtime\node.exe" set "NODE_EXE=%APP_DIR%runtime\node.exe"
if defined NODE_EXE goto found_node
for /f "delims=" %%N in ('"%SystemRoot%\System32\where.exe" node.exe 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%N"
if defined NODE_EXE goto found_node
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if defined NODE_EXE goto found_node
echo.
echo Node.js not found. Install Node.js LTS with npm, then run start.cmd again.
echo Download: https://nodejs.org/
echo Do NOT open index.html directly. See README.md for Chinese instructions.
if exist "%APP_DIR%docs\NODE-REQUIRED.txt" type "%APP_DIR%docs\NODE-REQUIRED.txt"
pause
exit /b 1

:found_node
if "%~1"=="--setup" goto setup
if "%~1"=="--no-open" goto no_open
"%NODE_EXE%" "%APP_DIR%scripts\launch.mjs"
goto finished
:no_open
"%NODE_EXE%" "%APP_DIR%scripts\launch.mjs" --no-open
goto finished
:setup
"%NODE_EXE%" "%APP_DIR%scripts\setup-official.mjs"
set "RESULT=%ERRORLEVEL%"
pause
exit /b %RESULT%
:finished
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" pause
exit /b %RESULT%
:bad_directory
echo Cannot open project folder. Extract the entire project to a local folder.
pause
exit /b 1
