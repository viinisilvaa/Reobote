<?php
// REOBOTE | server/lib/auth.php — Servidor: login, sessão, perfis e permissões
declare(strict_types=1);

// Sessao, conta autenticada e permissoes configuraveis por cargo.

// Catalogo de permissoes que a administracao pode atribuir a cada cargo.
const REOBOTE_PERMISSIONS = [
    'app' => 'Aplicativo: registrar a própria jornada',
    'dashboard' => 'Central: painel principal e mapa',
    'notifications' => 'Central: notificações',
    'employees' => 'Central: gerenciar colaboradores e acessos',
    'jobs' => 'Central: cargos, jornadas e feriados',
    'units' => 'Central: unidades e QR Codes',
    'reports' => 'Central: relatórios',
    'settings' => 'Central: configurações e auditoria',
];

// Perfis de acesso: administrador tem tudo; gestor tem a Central (exceto configuracoes); colaborador segue o cargo.
const REOBOTE_ROLES = [
    'admin' => 'Administrador',
    'dispatcher' => 'Gestor da Central',
    'employee' => 'Colaborador',
];

const REOBOTE_SESSION_HOURS = 10;
const REOBOTE_REMEMBER_DAYS = 30;

// Indica se o acesso é seguro (HTTPS), inclusive atrás de proxy; em produção sempre considera seguro.
function reobote_is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https'
        || reobote_env('APP_ENV') === 'production';
}

// Opções do cookie de sessão: inacessível ao JavaScript (HttpOnly), seguro em HTTPS e restrito ao próprio site (SameSite).
function reobote_cookie_options(int $expires): array
{
    return [
        'expires' => $expires,
        'path' => '/',
        'secure' => reobote_is_https(),
        'httponly' => true,
        'samesite' => 'Lax',
    ];
}

// Inicia a sessão PHP com cookies seguros e encerra sessões cujo prazo já venceu.
function reobote_start_session(): void
{
    session_name('reobote_sid');
    $options = reobote_cookie_options(0);
    unset($options['expires']);
    $options['lifetime'] = REOBOTE_REMEMBER_DAYS * 86400;
    session_set_cookie_params($options);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.gc_maxlifetime', (string) (REOBOTE_REMEMBER_DAYS * 86400));

    // Central no GitHub Pages: a sessão vem no cabeçalho X-Reobote-Session (token) em vez de cookie,
    // porque o navegador bloqueia cookies entre sites diferentes. "-" = ainda sem token (antes do login).
    // O modo estrito acima recusa tokens inventados (o PHP cria uma sessão nova nesse caso).
    $token = $_SERVER['HTTP_X_REOBOTE_SESSION'] ?? null;
    if ($token !== null) {
        if (preg_match('/^[A-Za-z0-9,-]{22,256}$/', $token)) {
            session_id($token);
        }
        // Devolve o token atual em toda resposta: ele muda no login (session_regenerate_id) e fica
        // vazio no logout. O cliente guarda o valor recebido (compartilhado/js/api-client.js).
        header_register_callback(static function (): void {
            header('X-Reobote-Session: ' . (session_status() === PHP_SESSION_ACTIVE ? session_id() : ''));
        });
    }
    session_start();

    // A expiracao real e controlada aqui: sessoes comuns duram algumas horas; "manter conectado" dura dias.
    if (isset($_SESSION['expires_at']) && time() > (int) $_SESSION['expires_at']) {
        $_SESSION = [];
        session_regenerate_id(true);
    }
}

// Cria uma sessão nova após o login (troca o identificador para evitar sequestro de sessão). "remember" mantém conectado por 30 dias.
function reobote_login_session(int $userId, bool $remember): void
{
    session_regenerate_id(true);
    $_SESSION = [
        'user_id' => $userId,
        'remember' => $remember,
        'expires_at' => time() + ($remember ? REOBOTE_REMEMBER_DAYS * 86400 : REOBOTE_SESSION_HOURS * 3600),
    ];
    setcookie(session_name(), session_id(), reobote_cookie_options($remember ? time() + REOBOTE_REMEMBER_DAYS * 86400 : 0));
}

// Encerra a sessão e apaga o cookie no navegador.
function reobote_logout_session(): void
{
    $_SESSION = [];
    session_destroy();
    setcookie(session_name(), '', reobote_cookie_options(time() - 3600));
}

// Permissoes efetivas de uma conta, combinando perfil e cargo.
function reobote_effective_permissions(string $role, ?string $jobPermissions): array
{
    // Administrador e Gestor da Central: tudo o que existe na Central (inclusive Configurações).
    // Usam só o navegador: não batem ponto nem usam o aplicativo dos técnicos.
    if ($role === 'admin' || $role === 'dispatcher') {
        return array_values(array_diff(array_keys(REOBOTE_PERMISSIONS), ['app']));
    }
    // Colaborador: somente o aplicativo (quando o cargo libera o aplicativo). Não entra na Central.
    $permissions = [];
    if ($jobPermissions) {
        $decoded = json_decode($jobPermissions, true);
        if (is_array($decoded)) {
            $permissions = $decoded;
        }
    }
    return in_array('app', $permissions, true) ? ['app'] : [];
}

// Carrega a conta da sessao no banco a cada requisicao, refletindo desativacoes e mudancas de permissao na hora.
function reobote_current_user(): ?array
{
    static $cache = false;
    if ($cache !== false) {
        return $cache;
    }
    $userId = (int) ($_SESSION['user_id'] ?? 0);
    if ($userId <= 0) {
        return $cache = null;
    }
    $query = reobote_db()->prepare(
        'SELECT u.id, u.employee_id, u.email, u.role, u.active, u.must_change_password, u.last_seen_at,
                e.name, e.photo_path, e.active AS employee_active, e.job_id, j.name AS job_name, j.permissions
         FROM users u
         LEFT JOIN employees e ON e.id = u.employee_id
         LEFT JOIN jobs j ON j.id = e.job_id
         WHERE u.id = ? LIMIT 1'
    );
    $query->execute([$userId]);
    $row = $query->fetch();
    if (!$row || !(int) $row['active'] || ($row['employee_id'] !== null && !(int) $row['employee_active'])) {
        $_SESSION = [];
        return $cache = null;
    }
    // Marca a conta como ativa agora ("Online"). Grava no máximo uma vez por minuto.
    if ($row['last_seen_at'] === null || strtotime($row['last_seen_at'] . ' UTC') < time() - 60) {
        reobote_db()->prepare('UPDATE users SET last_seen_at = UTC_TIMESTAMP() WHERE id = ?')->execute([$userId]);
    }
    $permissions = reobote_effective_permissions((string) $row['role'], $row['permissions']);
    return $cache = [
        'id' => (string) $row['id'],
        'employeeId' => $row['employee_id'] === null ? null : (string) $row['employee_id'],
        'email' => $row['email'],
        'role' => $row['role'],
        'roleLabel' => REOBOTE_ROLES[$row['role']] ?? $row['role'],
        'name' => $row['name'] ?: $row['email'],
        'job' => $row['job_name'],
        'hasPhoto' => (bool) $row['photo_path'],
        'permissions' => $permissions,
        'centralAccess' => count(array_diff($permissions, ['app'])) > 0,
        'mustChangePassword' => (bool) $row['must_change_password'],
    ];
}

// Exige uma sessao valida e, por padrao, a senha definitiva ja criada.
function reobote_user(bool $allowPasswordChange = false): array
{
    $user = reobote_current_user();
    if ($user === null) {
        reobote_fail('Entre na sua conta para continuar.', 401, 'unauthenticated');
    }
    if ($user['mustChangePassword'] && !$allowPasswordChange) {
        reobote_fail('Crie sua senha definitiva antes de continuar.', 403, 'password_change_required');
    }
    return $user;
}

// Indica se a conta tem uma permissão (ex.: "reports").
function reobote_has(array $user, string $permission): bool
{
    return in_array($permission, $user['permissions'], true);
}

// Exige ao menos uma das permissoes informadas.
function reobote_require(array $user, string ...$permissions): void
{
    foreach ($permissions as $permission) {
        if (reobote_has($user, $permission)) {
            return;
        }
    }
    reobote_fail('Seu perfil não tem permissão para acessar esta área.', 403, 'forbidden');
}

// Quem pode consultar dados de outros colaboradores.
function reobote_can_view_team(array $user): bool
{
    return reobote_has($user, 'dashboard') || reobote_has($user, 'employees') || reobote_has($user, 'reports');
}

// Gestores veem qualquer colaborador; colaboradores só veem os próprios dados.
function reobote_can_view_employee(array $user, string $employeeId): bool
{
    return reobote_can_view_team($user) || (string) $user['employeeId'] === $employeeId;
}
