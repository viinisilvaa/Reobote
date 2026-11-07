<?php
declare(strict_types=1);

// Configuracao, conexao com o banco e utilitarios compartilhados pela API e pelos scripts de terminal.

// Carrega a configuracao de ambiente sem expor o arquivo .env ao navegador.
function reobote_env(string $key, ?string $default = null): ?string
{
    static $values;
    if ($values === null) {
        $values = [];
        $file = __DIR__ . '/.env';
        if (is_file($file)) {
            foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
                $line = trim($line);
                if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) {
                    continue;
                }
                [$name, $value] = explode('=', $line, 2);
                $values[trim($name)] = trim(trim($value), "\"'");
            }
        }
    }

    $value = getenv($key);
    return $value !== false ? $value : ($values[$key] ?? $default);
}

// Abre a conexao PDO (uma por requisicao) e fixa o banco em UTC para registros consistentes.
function reobote_db(bool $withoutDatabase = false): PDO
{
    static $shared;
    if (!$withoutDatabase && $shared instanceof PDO) {
        return $shared;
    }

    $host = reobote_env('MYSQL_HOST', '127.0.0.1');
    $port = reobote_env('MYSQL_PORT', '3306');
    $database = reobote_env('MYSQL_DATABASE', 'reobote');
    $user = reobote_env('MYSQL_USER');
    $password = reobote_env('MYSQL_PASSWORD');

    if ($user === null || $user === '' || $password === null) {
        throw new RuntimeException('Configure MYSQL_USER e MYSQL_PASSWORD em server/.env.');
    }
    if (!preg_match('/^[a-zA-Z0-9_]+$/', (string) $database)) {
        throw new RuntimeException('MYSQL_DATABASE deve conter somente letras, numeros e underline.');
    }

    $dsn = sprintf(
        'mysql:host=%s;port=%s;%scharset=utf8mb4',
        $host,
        $port,
        $withoutDatabase ? '' : 'dbname=' . $database . ';'
    );
    $pdo = new PDO($dsn, $user, $password, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
        PDO::ATTR_STRINGIFY_FETCHES => false,
    ]);
    if (!$withoutDatabase) {
        $pdo->exec("SET time_zone = '+00:00'");
        $shared = $pdo;
    }
    return $pdo;
}

// Responde a API em JSON e encerra a requisicao com o status informado.
function reobote_json(array $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    exit;
}

// Resposta de erro padronizada; o codigo opcional permite ao front-end reagir a casos especificos.
function reobote_fail(string $message, int $status = 400, ?string $code = null): never
{
    reobote_json(array_filter(['error' => $message, 'code' => $code], static fn ($value) => $value !== null), $status);
}

// Le e valida corpos JSON, com limite de tamanho para entradas da API.
function reobote_body(): array
{
    static $cached;
    if ($cached !== null) {
        return $cached;
    }
    if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 262144) {
        reobote_fail('A requisicao excede o limite permitido.', 413);
    }
    $raw = file_get_contents('php://input', false, null, 0, 262145);
    if ($raw === false || $raw === '') {
        return $cached = [];
    }
    if (strlen($raw) > 262144) {
        reobote_fail('A requisicao excede o limite permitido.', 413);
    }
    try {
        $data = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        reobote_fail('O corpo da requisicao deve conter JSON valido.');
    }
    if (!is_array($data)) {
        reobote_fail('O corpo da requisicao deve ser um objeto JSON.');
    }
    return $cached = $data;
}

// Leitura tipada de campos do corpo, com mensagens de validacao em portugues.
function reobote_str(array $data, string $key, int $max, bool $required = false, string $label = 'Campo'): ?string
{
    $value = $data[$key] ?? null;
    if ($value === null || (is_string($value) && trim($value) === '')) {
        if ($required) {
            reobote_fail("$label e obrigatorio.");
        }
        return null;
    }
    if (!is_string($value) && !is_int($value) && !is_float($value)) {
        reobote_fail("$label invalido.");
    }
    $value = trim((string) $value);
    if (mb_strlen($value) > $max) {
        reobote_fail("$label deve ter no maximo $max caracteres.");
    }
    return $value;
}

// Lê um número inteiro do corpo da requisição dentro de um intervalo; usa o padrão quando o campo não foi enviado.
function reobote_int(array $data, string $key, int $min, int $max, ?int $default = null, string $label = 'Campo'): ?int
{
    $value = $data[$key] ?? null;
    if ($value === null || $value === '') {
        return $default;
    }
    $int = filter_var($value, FILTER_VALIDATE_INT);
    if ($int === false || $int < $min || $int > $max) {
        reobote_fail("$label deve ser um numero entre $min e $max.");
    }
    return $int;
}

// Lê um valor verdadeiro/falso do corpo da requisição (aceita true/false, 1/0, "sim" do navegador etc.).
function reobote_bool(array $data, string $key, bool $default = false): bool
{
    if (!array_key_exists($key, $data)) {
        return $default;
    }
    return filter_var($data[$key], FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? $default;
}

// Valida um horário no formato HH:MM e devolve sempre com 5 caracteres (ex.: "08:00").
function reobote_time_value(?string $value, string $label): ?string
{
    if ($value === null || $value === '') {
        return null;
    }
    if (!preg_match('/^([01]\d|2[0-3]):([0-5]\d)(:00)?$/', $value)) {
        reobote_fail("$label deve estar no formato HH:MM.");
    }
    return substr($value, 0, 5);
}

// Valida uma data no formato AAAA-MM-DD (ex.: "2026-11-07"), recusando datas inexistentes como 31/02.
function reobote_date_value(?string $value, string $label): ?string
{
    if ($value === null || $value === '') {
        return null;
    }
    $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value);
    if (!$date || $date->format('Y-m-d') !== $value) {
        reobote_fail("$label deve ser uma data valida (AAAA-MM-DD).");
    }
    return $value;
}

// Le um intervalo de datas da query string, com limite de dias.
function reobote_date_range(int $maxDays, ?int $defaultDays = null): array
{
    $tz = reobote_timezone();
    $today = new DateTimeImmutable('today', $tz);
    $to = (string) ($_GET['to'] ?? '');
    $from = (string) ($_GET['from'] ?? '');
    if ($to === '' && $defaultDays !== null) {
        $to = $today->format('Y-m-d');
    }
    if ($from === '' && $defaultDays !== null) {
        $from = $today->modify('-' . ($defaultDays - 1) . ' days')->format('Y-m-d');
    }
    reobote_date_value($from, 'Data inicial');
    reobote_date_value($to, 'Data final');
    if ($from === '' || $to === '' || $from > $to) {
        reobote_fail('Informe um intervalo de datas valido.');
    }
    $days = (new DateTimeImmutable($from))->diff(new DateTimeImmutable($to))->days + 1;
    if ($days > $maxDays) {
        reobote_fail("O intervalo maximo e de $maxDays dias.");
    }
    return [$from, $to];
}

// Configuracoes institucionais e regras do sistema, guardadas na tabela settings.
const REOBOTE_SETTING_DEFAULTS = [
    'company_name' => 'Central REOBOTE',
    'company_email' => 'central@reobote.com',
    'company_phone' => '',
    'email_domain' => 'reobote.com',
    'require_email_domain' => '0',
    'timezone' => 'America/Sao_Paulo',
    'offline_max_days' => '7',
    'request_gps_on_checkin' => '1',
    'shift_gap_hours' => '16',
    // Link de download do APK (ex.: o link "latest" das Releases do GitHub). Vazio = /downloads/reobote.apk.
    'apk_download_url' => '',
];

// Devolve as configurações do sistema (tabela settings), com os valores padrão para o que não foi configurado. Fica em memória durante a requisição.
function reobote_settings(bool $refresh = false): array
{
    static $settings;
    if ($settings !== null && !$refresh) {
        return $settings;
    }
    $settings = REOBOTE_SETTING_DEFAULTS;
    try {
        foreach (reobote_db()->query('SELECT name, value FROM settings') as $row) {
            if (array_key_exists($row['name'], $settings)) {
                $settings[$row['name']] = (string) $row['value'];
            }
        }
    } catch (Throwable) {
        // Banco indisponivel ou tabela ainda inexistente antes do setup: usa os valores padrao.
    }
    return $settings;
}

// Fuso horário da empresa (Configurações); usado para saber o "dia" de cada registro e calcular atrasos.
function reobote_timezone(): DateTimeZone
{
    static $tz;
    if ($tz === null) {
        try {
            $tz = new DateTimeZone(reobote_settings()['timezone']);
        } catch (Throwable) {
            $tz = new DateTimeZone('America/Sao_Paulo');
        }
    }
    return $tz;
}

// Datas do banco (UTC) em ISO 8601 para o navegador.
function reobote_iso(?string $utc): ?string
{
    if ($utc === null || $utc === '') {
        return null;
    }
    return (new DateTimeImmutable($utc, new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s\Z');
}

// Data e hora atual em UTC no formato do banco de dados.
function reobote_now_utc(): string
{
    return gmdate('Y-m-d H:i:s');
}

// Identifica o endereço IP de forma irreversível (hash), para limitar tentativas de login sem guardar o IP em texto.
function reobote_hash_ip(): string
{
    return hash_hmac('sha256', (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown'), (string) reobote_env('SESSION_SECRET', ''));
}

// Senha temporaria legivel (sem caracteres ambiguos) para o primeiro acesso.
function reobote_temp_password(): string
{
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    $password = '';
    for ($i = 0; $i < 12; $i++) {
        $password .= $alphabet[random_int(0, strlen($alphabet) - 1)];
    }
    return substr($password, 0, 4) . '-' . substr($password, 4, 4) . '-' . substr($password, 8, 4);
}

// Regras para a senha definitiva: de 10 a 256 caracteres, com letras e números.
function reobote_validate_new_password(string $password): void
{
    if (strlen($password) < 10 || strlen($password) > 256) {
        reobote_fail('A nova senha deve ter entre 10 e 256 caracteres.');
    }
    if (!preg_match('/[A-Za-z]/', $password) || !preg_match('/\d/', $password)) {
        reobote_fail('A nova senha deve conter letras e numeros.');
    }
}
