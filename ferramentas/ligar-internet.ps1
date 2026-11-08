# REOBOTE | ferramentas/ligar-internet.ps1 — Liga o REOBOTE na internet (túnel da Cloudflare) e publica o endereço
#
# Para que serve: o aplicativo (APK) de quem está fora do seu Wi-Fi precisa de um endereço na internet.
# Este script:
#   1. confere se o REOBOTE está rodando no XAMPP (http://localhost:3000);
#   2. liga um túnel gratuito da Cloudflare, que gera um endereço https://....trycloudflare.com;
#   3. grava esse endereço no servidor.json e envia ao GitHub (o app lê esse arquivo ao abrir);
#   4. fica ligado enquanto esta janela estiver aberta. Fechou a janela, o túnel desliga.
#
# Uso: dois cliques em "Ligar REOBOTE na internet.bat", na pasta do projeto.

$ErrorActionPreference = "Stop"
$projeto = Split-Path -Parent $PSScriptRoot                 # pasta do projeto REOBOTE
$cloudflared = "C:\xampp\cloudflared\cloudflared.exe"       # programa do túnel (baixado do GitHub da Cloudflare)
$log = Join-Path $env:TEMP "reobote-tunel.log"              # o túnel escreve aqui o endereço gerado

# Mostra uma mensagem de erro e espera o Enter, para a janela não fechar sozinha.
function Parar($mensagem) {
    Write-Host ""
    Write-Host $mensagem -ForegroundColor Red
    Read-Host "Pressione Enter para fechar"
    exit 1
}

Write-Host "REOBOTE - ligando na internet..." -ForegroundColor Cyan

if (-not (Test-Path $cloudflared)) {
    Parar "Não encontrei o programa do túnel em $cloudflared. Baixe o cloudflared-windows-amd64.exe em https://github.com/cloudflare/cloudflared/releases e salve com esse nome nessa pasta."
}

# 1. O REOBOTE precisa estar rodando no XAMPP (Apache e MySQL ligados).
try {
    Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:3000/api/config" -TimeoutSec 5 | Out-Null
} catch {
    Parar "O REOBOTE não respondeu em http://localhost:3000. Abra o painel do XAMPP e dê Start no Apache e no MySQL."
}

# 2. Liga o túnel (na mesma janela: fechar a janela desliga o túnel) e espera o endereço aparecer no log.
Remove-Item $log -ErrorAction SilentlyContinue
$tunel = Start-Process -FilePath $cloudflared -ArgumentList @("tunnel", "--no-autoupdate", "--url", "http://localhost:3000", "--logfile", "`"$log`"") -NoNewWindow -PassThru
$endereco = $null
for ($i = 0; $i -lt 60 -and -not $endereco; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path $log) {
        $achado = Select-String -Path $log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" | Select-Object -First 1
        if ($achado) { $endereco = $achado.Matches[0].Value }
    }
}
if (-not $endereco) {
    Stop-Process -Id $tunel.Id -ErrorAction SilentlyContinue
    Parar "O túnel não gerou um endereço em 60 segundos. Confira a internet do computador e tente de novo."
}

# 3. Grava o endereço no servidor.json (UTF-8 sem BOM) e envia ao GitHub.
$json = @"
{
  "_comentario": "Endereço ATUAL do servidor REOBOTE. O aplicativo (APK) lê este arquivo toda vez que abre. Atualizado automaticamente por ferramentas/ligar-internet.ps1. Deixe vazio para o app usar o endereço de app/js/config.js.",
  "servidor": "$endereco"
}
"@
[System.IO.File]::WriteAllText((Join-Path $projeto "servidor.json"), $json + "`n", (New-Object System.Text.UTF8Encoding $false))
Push-Location $projeto
try {
    git add servidor.json
    git commit -q -m "Endereço atual do servidor (túnel ligado em $(Get-Date -Format 'dd/MM/yyyy HH:mm'))"
    git push -q
    $publicado = $LASTEXITCODE -eq 0
} catch {
    $publicado = $false
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "REOBOTE na internet: $endereco" -ForegroundColor Green
Write-Host "Central: $endereco/central/"
if ($publicado) {
    Write-Host "Endereço publicado no GitHub. Os aplicativos pegam o endereço novo ao serem abertos (pode levar até 5 minutos)." -ForegroundColor Green
} else {
    Write-Host "Não consegui enviar o servidor.json ao GitHub. Envie pelo GitHub Desktop ou edite o arquivo no site." -ForegroundColor Yellow
}
Write-Host ""
Write-Host "DEIXE ESTA JANELA ABERTA. Fechar a janela desliga o REOBOTE da internet." -ForegroundColor Yellow

# 4. Mantém o túnel ligado até a janela ser fechada.
Wait-Process -Id $tunel.Id
