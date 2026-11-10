<?php
// REOBOTE | server/routes/auth.php — API: login, sessão, troca e recuperação de senha
declare(strict_types=1);

// Autenticacao: login, sessao atual, troca de senha, pedido de recuperacao de acesso e configuracao publica.

function api_login_limit(PDO $db, string $ipHash): void
{
    $db->exec('DELETE FROM login_attempts WHERE attempted_at < UTC_TIMESTAMP() - INTERVAL 1 DAY');
    $query = $db->prepare('SELECT COUNT(*) FROM login_attempts WHERE ip_hash = ? AND attempted_at >= UTC_TIMESTAMP() - INTERVAL 15 MINUTE');
    $query->execute([$ipHash]);
    if ((int) $query->fetchColumn() >= 10) {
        reobote_fail('Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.', 429);
    }
}

// Dados da sessao entregues ao navegador, com as regras que o aplicativo precisa conhecer.
function api_session_payload(array $user): array
{
    $settings = reobote_settings();
    return [
        'user' => $user,
        'company' => [
            'name' => $settings['company_name'],
            'email' => $settings['company_email'],
            'phone' => $settings['company_phone'],
            'emailDomain' => $settings['email_domain'],
        ],
        // Onde baixar o APK do aplicativo (página "Aplicativo" da Central).
        'downloads' => [
            'apkUrl' => $settings['apk_download_url'] !== '' ? $settings['apk_download_url'] : REOBOTE_APK_URL_PADRAO,
            'customApkUrl' => $settings['apk_download_url'] !== '',
        ],
        'rules' => [
            'timezone' => $settings['timezone'],
            'offlineMaxDays' => (int) $settings['offline_max_days'],
            'requestGpsOnCheckin' => $settings['request_gps_on_checkin'] === '1',
        ],
        'serverTime' => gmdate('Y-m-d\TH:i:s\Z'),
    ];
}

// Login: confere e-mail e senha, limita tentativas por IP, bloqueia contas desativadas e cria a sessão.
route('POST', '/api/auth/login', static function (PDO $db): void {
    $body = reobote_body();
    $email = mb_strtolower(trim((string) ($body['email'] ?? '')));
    $password = (string) ($body['password'] ?? '');
    if ($email === '' || $password === '' || strlen($email) > 190 || strlen($password) > 256) {
        reobote_fail('Informe e-mail e senha válidos.');
    }
    $ipHash = reobote_hash_ip();
    $emailHash = hash_hmac('sha256', $email, (string) reobote_env('SESSION_SECRET', ''));
    api_login_limit($db, $ipHash);

    $query = $db->prepare(
        'SELECT u.id, u.password_hash, u.active, e.active AS employee_active
         FROM users u LEFT JOIN employees e ON e.id = u.employee_id
         WHERE u.email = ? LIMIT 1'
    );
    $query->execute([$email]);
    $account = $query->fetch();
    // Mesmo sem conta, verifica um hash para que o tempo de resposta nao revele quais e-mails existem.
    $valid = $account ? password_verify($password, (string) $account['password_hash']) : (bool) password_hash($password, PASSWORD_DEFAULT) && false;
    if (!$account || !$valid) {
        $db->prepare('INSERT INTO login_attempts (ip_hash, email_hash) VALUES (?, ?)')->execute([$ipHash, $emailHash]);
        reobote_fail('E-mail ou senha incorretos.', 401);
    }
    if (!(int) $account['active'] || ($account['employee_active'] !== null && !(int) $account['employee_active'])) {
        reobote_fail('Este acesso está desativado. Procure a administração.', 403, 'account_disabled');
    }
    if (password_needs_rehash($account['password_hash'], PASSWORD_DEFAULT)) {
        $db->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([password_hash($password, PASSWORD_DEFAULT), $account['id']]);
    }
    $db->prepare('DELETE FROM login_attempts WHERE ip_hash = ? AND email_hash = ?')->execute([$ipHash, $emailHash]);
    $db->prepare('UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?')->execute([$account['id']]);

    reobote_login_session((int) $account['id'], reobote_bool($body, 'remember'));
    reobote_json(api_session_payload(reobote_current_user()));
});

// Dados da sessão atual (conta, permissões, empresa e regras). Também funciona quando a senha temporária ainda precisa ser trocada.
route('GET', '/api/auth/me', static function (PDO $db): void {
    reobote_json(api_session_payload(reobote_user(true)));
});

// Sair: encerra a sessão.
route('POST', '/api/auth/logout', static function (PDO $db): void {
    // Ao sair, a conta fica "Offline" na hora.
    if (!empty($_SESSION['user_id'])) {
        $db->prepare('UPDATE users SET last_seen_at = NULL WHERE id = ?')->execute([(int) $_SESSION['user_id']]);
    }
    reobote_logout_session();
    http_response_code(204);
    exit;
});

// Troca de senha (inclusive a obrigatória após senha temporária). Exige a senha atual.
route('POST', '/api/auth/change-password', static function (PDO $db): void {
    $user = reobote_user(true);
    $body = reobote_body();
    $current = (string) ($body['currentPassword'] ?? '');
    $new = (string) ($body['newPassword'] ?? '');
    $query = $db->prepare('SELECT password_hash FROM users WHERE id = ?');
    $query->execute([$user['id']]);
    if (!password_verify($current, (string) $query->fetchColumn())) {
        reobote_fail('A senha atual está incorreta.');
    }
    reobote_validate_new_password($new);
    if (hash_equals($current, $new)) {
        reobote_fail('A nova senha deve ser diferente da senha atual.');
    }
    $db->prepare('UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = UTC_TIMESTAMP() WHERE id = ?')
        ->execute([password_hash($new, PASSWORD_DEFAULT), $user['id']]);
    reobote_audit($db, $user, 'password_changed', 'user', $user['id']);
    session_regenerate_id(true);
    reobote_json(['changed' => true]);
});

// Recuperacao de acesso: avisa a administracao, que gera uma nova senha temporaria.
// A resposta e sempre a mesma para nao revelar se o e-mail esta cadastrado.
route('POST', '/api/auth/forgot', static function (PDO $db): void {
    $body = reobote_body();
    $email = mb_strtolower(trim((string) ($body['email'] ?? '')));
    $ipHash = reobote_hash_ip();
    api_login_limit($db, $ipHash);
    $db->prepare('INSERT INTO login_attempts (ip_hash, email_hash) VALUES (?, ?)')
        ->execute([$ipHash, hash_hmac('sha256', 'forgot:' . $email, (string) reobote_env('SESSION_SECRET', ''))]);
    if (filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $query = $db->prepare('SELECT u.id, e.id AS employee_id, COALESCE(e.name, u.email) AS name FROM users u LEFT JOIN employees e ON e.id = u.employee_id WHERE u.email = ? AND u.active = 1');
        $query->execute([$email]);
        if ($account = $query->fetch()) {
            reobote_notify($db, 'access_request', $account['name'] . ' pediu ajuda para acessar a conta',
                "Gere uma nova senha temporária em Colaboradores para $email.", $account['employee_id'] ? (string) $account['employee_id'] : null, null,
                'access:' . $account['id'] . ':' . gmdate('Y-m-d'));
        }
    }
    reobote_json(['message' => 'Se o e-mail estiver cadastrado, a administração foi avisada e entrará em contato com uma senha temporária.']);
});
