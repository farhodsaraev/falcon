@echo off
rem Double-click to start Falcon.
cd /d "%~dp0"
set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"
node src\app\launch.js
