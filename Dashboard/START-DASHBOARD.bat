@echo off
cd /d "%~dp0"
echo Dashboard disponibil la http://127.0.0.1:8080/dashboard.html
python -m http.server 8080
if errorlevel 1 py -m http.server 8080
pause
