@echo off
if "%~1"=="--version" (
  echo version 1.9.1
  exit /b 0
)
if "%~1"=="with spaces" (
  echo space-match
  exit /b 0
)
if "%~1"=="C:\Program Files\include" (
  echo path-match
  exit /b 0
)
if "%~1"=="" (
  echo empty-match
  exit /b 0
)
exit /b 9
