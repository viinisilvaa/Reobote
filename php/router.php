<?php
// REOBOTE | php/router.php — Servidor: roteador para testes locais (php -S)
declare(strict_types=1);

// Roteador do servidor embutido do PHP (php -S 127.0.0.1:3000 php/router.php).
// Em producao, o Apache faz o mesmo papel com o .htaccess da raiz.

// Mesmos cabeçalhos de segurança do .htaccess (Apache).
header_remove('X-Powered-By');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('Permissions-Policy: geolocation=(self), camera=(self), microphone=()');
header('Cross-Origin-Opener-Policy: same-origin');
header('X-Permitted-Cross-Domain-Policies: none');
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com; img-src 'self' data: blob: https://tile.openstreetmap.org https://github.com https://*.githubusercontent.com; connect-src 'self'; frame-src 'self'; worker-src 'self' blob:; manifest-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'");
if (strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https') {
    header('Strict-Transport-Security: max-age=31536000');
}

// Página "não encontrada" com o técnico da REOBOTE.
function router_not_found(): never
{
    http_response_code(404);
    header('Content-Type: text/html; charset=utf-8');
    readfile(dirname(__DIR__) . '/central/html/404.html');
    exit;
}

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$lowerPath = strtolower(rawurldecode($path));

// Impede o acesso publico aos arquivos internos e a configuracao do projeto.
if (str_starts_with($lowerPath, '/php') || str_starts_with($lowerPath, '/server') || str_contains($lowerPath, '/.')) {
    router_not_found();
}

// Endereços principais: a Central (/central/) e o aplicativo (/app/) ficam em pastas separadas.
if ($path === '/' || $path === '/index.html' || $path === '/central' || $path === '/central/') {
    header('Location: /central/entrar.html', true, 302);
    exit;
}
if ($path === '/app') {
    header('Location: /app/', true, 302);
    exit;
}
if (str_starts_with($path, '/api/')) {
    require __DIR__ . '/api.php';
    exit;
}

$root = realpath(dirname(__DIR__));

// Páginas: os arquivos ficam em central/html/ e app/html/, mas os endereços continuam os mesmos
// (/central/entrar.html, /app/), igual ao .htaccess. Abrir direto a pasta html/ leva ao endereço normal.
if (preg_match('#^/(central|app)/html/(.*)$#', $path, $match)) {
    header('Location: /' . $match[1] . '/' . $match[2], true, 301);
    exit;
}
$page = null;
if (preg_match('#^/central/([^/]+\.html)$#', rawurldecode($path), $match)) {
    $page = '/central/html/' . $match[1];
} elseif ($path === '/app/' || $path === '/app/index.html') {
    $page = '/app/html/index.html';
}
if ($page !== null) {
    $pageFile = realpath($root . $page);
    if ($pageFile === false || !str_starts_with($pageFile, $root . DIRECTORY_SEPARATOR) || !is_file($pageFile)) {
        router_not_found();
    }
    header('Content-Type: text/html; charset=utf-8');
    readfile($pageFile);
    exit;
}

$file = realpath($root . $path);
$inside = $file !== false && str_starts_with($file, $root . DIRECTORY_SEPARATOR);

// Pasta com index.html, como o aplicativo em /app/.
if ($inside && is_dir($file) && is_file($file . DIRECTORY_SEPARATOR . 'index.html')) {
    header('Content-Type: text/html; charset=utf-8');
    readfile($file . DIRECTORY_SEPARATOR . 'index.html');
    exit;
}
// O service worker do aplicativo nunca deve ficar em cache.
if ($path === '/app/sw.js' && $inside) {
    header('Content-Type: application/javascript; charset=utf-8');
    header('Cache-Control: no-cache');
    readfile($file);
    exit;
}
// APK do aplicativo (pasta downloads/): tipo correto para o Android reconhecer como instalador.
if (str_ends_with($path, '.apk') && $inside && is_file($file)) {
    header('Content-Type: application/vnd.android.package-archive');
    header('Content-Length: ' . filesize($file));
    header('Content-Disposition: attachment; filename="' . basename($file) . '"');
    readfile($file);
    exit;
}
if (str_ends_with($path, '.webmanifest') && $inside && is_file($file)) {
    header('Content-Type: application/manifest+json; charset=utf-8');
    readfile($file);
    exit;
}

// Deixa o servidor PHP entregar os demais arquivos existentes do front-end.
if ($inside && is_file($file)) {
    return false;
}
router_not_found();
