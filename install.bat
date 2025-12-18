@echo off
echo ========================================
echo Instalacao do Git Manager Discord Bot
echo ========================================
echo.

REM Verificar se Node.js esta instalado
node -v > nul 2>&1

if %errorlevel% neq 0 (
  echo ERRO: Node.js nao encontrado!
  echo.
  echo Por favor, instale o Node.js antes de continuar:
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)

echo Node.js encontrado!
node -v
echo.

REM Criar arquivo start.bat
if exist "start.bat" del /F "start.bat" 2>nul

echo @echo off > "start.bat"
echo echo ======================================== >> "start.bat"
echo echo Git Manager Discord Bot >> "start.bat"
echo echo ======================================== >> "start.bat"
echo echo. >> "start.bat"
echo IF NOT EXIST "node_modules" ^( >> "start.bat"
echo   echo Instalando dependencias... >> "start.bat"
echo   call npm install >> "start.bat"
echo   echo. >> "start.bat"
echo ^) >> "start.bat"
echo echo Iniciando bot... >> "start.bat"
echo call npm start >> "start.bat"

echo Arquivo start.bat criado com sucesso!
echo.

REM Configurar firewall para webhook GitHub (porta 3001 - apenas TCP)
echo ========================================
echo Configuracao do Firewall - Webhook GitHub
echo ========================================
echo.

REM Verificar se esta executando como administrador
net session > nul 2>&1
if %errorlevel% neq 0 (
  echo AVISO: Nao foi possivel configurar o firewall automaticamente.
  echo Execute este script como Administrador para abrir a porta 3001 (TCP).
  echo.
) else (
  set "port=3001"
  set "rule_name=GitHub-Webhook-GitManager"
  
  echo Abrindo porta %port% TCP para webhook do GitHub...
  echo.
  
  REM Verificar e criar regra TCP de entrada (apenas TCP)
  netsh advfirewall firewall show rule name="%rule_name%-tcp-in" > nul
  if not errorlevel 1 (
    echo Porta %port% TCP (entrada) ja esta aberta.
  ) else (
    netsh advfirewall firewall add rule name="%rule_name%-tcp-in" dir=in action=allow protocol=TCP localport=%port% > nul
    if %errorlevel% equ 0 (
      echo Porta %port% TCP (entrada) aberta com sucesso.
    ) else (
      echo ERRO ao abrir porta %port% TCP (entrada).
    )
  )
  
  REM Verificar e criar regra TCP de saida (apenas TCP)
  netsh advfirewall firewall show rule name="%rule_name%-tcp-out" > nul
  if not errorlevel 1 (
    echo Porta %port% TCP (saida) ja esta aberta.
  ) else (
    netsh advfirewall firewall add rule name="%rule_name%-tcp-out" dir=out action=allow protocol=TCP localport=%port% > nul
    if %errorlevel% equ 0 (
      echo Porta %port% TCP (saida) aberta com sucesso.
    ) else (
      echo ERRO ao abrir porta %port% TCP (saida).
    )
  )
  
  echo.
  echo Firewall configurado para porta %port% TCP (webhook GitHub)!
  echo.
)

echo ========================================
echo Instalacao concluida!
echo ========================================
echo.
echo Para iniciar o bot, execute: start.bat
echo.
pause

