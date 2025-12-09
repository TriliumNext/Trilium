@echo off
:: Try to get powershell to launch Trilium since it deals with UTF-8 characters in current path
:: If there's no powershell available, fallback to unicode enabled command interpreter

WHERE powershell.exe > NUL 2>&1
IF %ERRORLEVEL% NEQ 0 GOTO BATCH ELSE GOTO POWERSHELL

:POWERSHELL
powershell -ExecutionPolicy Bypass -NonInteractive -NoLogo -Command "Set-Item -Path Env:TRILIUM_DATA_DIR -Value './trilium-data'; ./trilium.exe"
GOTO END

:BATCH
:: Make sure we support UTF-8 characters
chcp 65001

:: Get Current Trilium executable directory and compute data directory
SET DIR=%~dp0
SET DIR=%DIR:~0,-1%
SET TRILIUM_DATA_DIR=%DIR%\trilium-data
cd "%DIR%"
start trilium.exe
GOTO END

:END
