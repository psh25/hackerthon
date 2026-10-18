@echo off
"%SystemRoot%\System32\chcp.com" 65001 >nul
call "%~dp0start.cmd" --setup
exit /b %ERRORLEVEL%
