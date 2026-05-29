@echo off
cd /d "%~dp0"
set /p GEMINI_KEY="Paste GEMINI_API_KEY: "
<NUL set /p="%GEMINI_KEY%" | npx wrangler secret put GEMINI_API_KEY
echo.
echo Done!
pause
