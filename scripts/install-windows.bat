@echo off
rem Font Manage 安装器（Windows）— 双击运行：安装到 %%LOCALAPPDATA%%\Font Manage、创建桌面快捷方式并启动。
setlocal EnableExtensions
cd /d "%~dp0"
set "SRC=%~dp0"
if exist "%SRC%dist\win\font-workspace.exe" set "SRC=%SRC%dist\win"
if not exist "%SRC%font-workspace.exe" (
  echo 未找到 font-workspace.exe。请在解压后的发布文件夹内双击运行本脚本。
  if not "%CI%"=="true" pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js。Font Manage 需要 Node.js（https://nodejs.org，LTS 即可），安装后重新双击本脚本。
  if not "%CI%"=="true" pause
  exit /b 1
)
if not exist "C:\Program Files\Affinity" if not exist "%LOCALAPPDATA%\Programs\Affinity" echo 提示：未检测到 Affinity。仍可继续安装，但使用前请安装 Affinity 3 并启用其本机 MCP 脚本接口。
set "DEST=%LOCALAPPDATA%\Font Manage"
if not exist "%DEST%" mkdir "%DEST%"
robocopy "%SRC%" "%DEST%" /E /NFL /NDL /NJH /NJS >nul
rem 服务器与网页资源在发布包的上一级（zip 根），一并安装
for %%D in (server web config scripts src) do if exist "%~dp0%%D" robocopy "%~dp0%%D" "%DEST%\%%D" /E /NFL /NDL /NJH /NJS >nul
if exist "%~dp0package.json" copy /y "%~dp0package.json" "%DEST%\" >nul
> "%DEST%\Font Manage.cmd" echo @echo off
>> "%DEST%\Font Manage.cmd" echo node "%DEST%\scripts\start.cjs"
powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut([IO.Path]::Combine($env:USERPROFILE, 'Desktop', 'Font Manage.lnk')); $sc.TargetPath = '%DEST%\Font Manage.cmd'; $sc.WorkingDirectory = '%DEST%'; $sc.Description = 'Font Manage for Affinity'; $sc.Save()"
echo.
echo 安装完成：
echo   目录：%DEST%
echo   桌面快捷方式：%USERPROFILE%\Desktop\Font Manage.lnk
echo.
echo 首次使用：打开后会自动连接 Affinity；如连接失败，请在 Affinity 设置中启用本机 MCP 脚本接口。
if /i not "%CI%"=="true" start "" "%DEST%\Font Manage.cmd"
if not "%CI%"=="true" pause
exit /b 0
