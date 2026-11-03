@echo off
chcp 65001 > nul
echo [대기오염 모니터링 로컬 서버를 실행합니다...]
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
pause

