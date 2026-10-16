@echo off
REM Envia as alteracoes ja salvas para o GitHub, que publica o site sozinho em uns 2 minutos.
cd /d "%~dp0"
echo.
echo  Enviando o deManas para o GitHub...
echo  Se abrir uma janela de login, escolha "Sign in with your browser"
echo  e autorize no Chrome da deManas (conta demanassistema-bit).
echo.
git push -u origin main
echo.
if errorlevel 1 (echo  Algo deu errado. Copie a mensagem acima e mande para o Claude.) else (echo  Pronto! O site atualiza em uns 2 minutos.)
echo.
pause
