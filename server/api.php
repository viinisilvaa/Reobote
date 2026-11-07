<?php
// REOBOTE | server/api.php — Servidor: entrada da API (segurança, sessão e rotas)
declare(strict_types=1);

// Ponto de entrada da API REOBOTE: valida a origem, inicia a sessao e despacha a rota correspondente.

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/journey.php';
require_once __DIR__ . '/lib/notify.php';
require_once __DIR__ . '/lib/records.php';

$sessionSecret = reobote_env('SESSION_SECRET', '');
if (strlen((string) $sessionSecret) < 32) {
    error_log('SESSION_SECRET ausente ou menor que 32 caracteres em server/.env.');
    reobote_fail('Configure SESSION_SECRET com pelo menos 32 caracteres em server/.env.', 500);
}

// Tabela de rotas: metodo, expressao do caminho e funcao responsavel.
$GLOBALS['reobote_routes'] = [];
// Registra uma rota da API: método HTTP, caminho (expressão regular; grupos entre parênteses viram parâmetros) e a função que responde.
function route(string $method, string $pattern, callable $handler): void
{
    $GLOBALS['reobote_routes'][] = [$method, '#^' . $pattern . '$#', $handler];
}

// Protecao contra requisicoes de outros sites: a origem deve ser a mesma e operacoes de escrita
// precisam do cabecalho X-Reobote, que formularios externos nao conseguem enviar.
function api_require_same_origin(string $method): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '') {
        $host = $_SERVER['HTTP_HOST'] ?? '';
        // Origens aceitas: o próprio site e o aplicativo Android (Capacitor usa https://localhost internamente).
        // Outras origens podem ser liberadas em APP_ALLOWED_ORIGINS (separadas por vírgula) no server/.env.
        $extra = array_filter(array_map('trim', explode(',', (string) reobote_env('APP_ALLOWED_ORIGINS', 'https://localhost,capacitor://localhost'))));
        $allowed = array_merge(['http://' . $host, 'https://' . $host], $extra);
        if ($host === '' || !in_array($origin, $allowed, true)) {
            reobote_fail('Origem da requisição não autorizada.', 403);
        }
    }
    if (!in_array($method, ['GET', 'HEAD', 'OPTIONS'], true) && ($_SERVER['HTTP_X_REOBOTE'] ?? '') !== '1') {
        reobote_fail('Requisição sem o cabeçalho de segurança esperado.', 403);
    }
}

require __DIR__ . '/routes/auth.php';
require __DIR__ . '/routes/me.php';
require __DIR__ . '/routes/employees.php';
require __DIR__ . '/routes/catalog.php';
require __DIR__ . '/routes/central.php';

try {
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $path = rtrim(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/', '/');
    api_require_same_origin($method);

    // Identifica o servidor REOBOTE (o aplicativo usa para testar o endereço configurado); nao depende do banco.
    if ($path === '/api/config' && $method === 'GET') {
        reobote_json(['app' => 'REOBOTE']);
    }
    reobote_start_session();

    $pathMatched = false;
    foreach ($GLOBALS['reobote_routes'] as [$routeMethod, $pattern, $handler]) {
        if (!preg_match($pattern, $path, $match)) {
            continue;
        }
        $pathMatched = true;
        if ($routeMethod !== $method) {
            continue;
        }
        $params = array_values(array_filter($match, 'is_int', ARRAY_FILTER_USE_KEY));
        array_shift($params);
        $handler(reobote_db(), ...$params);
        reobote_fail('A rota não produziu resposta.', 500);
    }
    reobote_fail($pathMatched ? 'Método não permitido para esta rota.' : 'Rota da API não encontrada.', $pathMatched ? 405 : 404);
} catch (Throwable $error) {
    error_log('Erro na API REOBOTE: ' . $error->getMessage() . ' em ' . $error->getFile() . ':' . $error->getLine());
    if (!headers_sent()) {
        $message = $error instanceof PDOException
            ? 'Não foi possível acessar o banco de dados. Verifique a configuração e execute php server/setup.php.'
            : 'Não foi possível concluir a requisição.';
        reobote_fail($message, 500);
    }
}
