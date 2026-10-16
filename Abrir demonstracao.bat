@echo off
REM Abre a demonstracao do deManas no navegador. Deixe esta janela aberta durante a apresentacao.
cd /d "%~dp0"
echo.
echo  deManas - demonstracao
echo  No celular (mesmo Wi-Fi), use o endereco "Network" que aparece abaixo.
echo  Para encerrar, feche esta janela.
echo.
npm run dev -- --port 5180 --open
