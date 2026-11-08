@echo off
rem REOBOTE | Ligar REOBOTE na internet.bat - dois cliques para colocar o REOBOTE na internet (veja ferramentas\ligar-internet.ps1)
chcp 65001 > nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ferramentas\ligar-internet.ps1"
