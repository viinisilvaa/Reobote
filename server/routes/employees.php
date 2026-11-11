<?php
// REOBOTE | server/routes/employees.php — API: colaboradores, fotos e correções de ponto
declare(strict_types=1);

// Gerenciamento de colaboradores e acessos, foto de identificacao, perfil e ajustes de registros pela Central.

function api_validate_reference(PDO $db, string $table, ?string $id, string $label): ?string
{
    if ($id === null || $id === '') {
        return null;
    }
    if (!ctype_digit($id)) {
        reobote_fail("$label inválido.");
    }
    $query = $db->prepare("SELECT COUNT(*) FROM `$table` WHERE id = ?");
    $query->execute([$id]);
    if (!(int) $query->fetchColumn()) {
        reobote_fail("$label não encontrado.");
    }
    return $id;
}

// Converte o salário digitado em centavos: aceita 2500, "2500.50", "2.500,50" ou "R$ 2.500,50".
// Vazio = sem salário informado.
function reobote_money_cents($value): ?int
{
    if ($value === null || $value === '') {
        return null;
    }
    if (is_int($value) || is_float($value)) {
        $number = (float) $value;
    } else {
        $text = preg_replace('/[^\d,.]/', '', (string) $value);
        if (str_contains($text, ',')) {
            $text = str_replace(['.', ','], ['', '.'], $text); // formato brasileiro: 2.500,50
        } elseif (preg_match('/^\d{1,3}(\.\d{3})+$/', $text)) {
            $text = str_replace('.', '', $text);               // só milhar: 1.500 = mil e quinhentos
        }
        if ($text === '' || !is_numeric($text)) {
            reobote_fail('Informe o salário em reais, por exemplo 2.500,00.');
        }
        $number = (float) $text;
    }
    if ($number <= 0 || $number > 1000000) {
        reobote_fail('Informe um salário entre R$ 0,01 e R$ 1.000.000,00.');
    }
    return (int) round($number * 100);
}

// Valida e normaliza os dados do formulario de colaborador.
function api_employee_input(PDO $db, array $user, array $body, ?array $current): array
{
    $settings = reobote_settings();
    $name = reobote_str($body, 'name', 160, true, 'Nome completo');
    $email = mb_strtolower((string) reobote_str($body, 'email', 190, true, 'E-mail'));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        reobote_fail('Informe um e-mail válido.');
    }
    $domain = mb_strtolower(trim($settings['email_domain']));
    if ($settings['require_email_domain'] === '1' && $domain !== '' && !str_ends_with($email, '@' . $domain)) {
        reobote_fail("Use um e-mail corporativo terminado em @$domain.");
    }
    $query = $db->prepare('SELECT COUNT(*) FROM users WHERE email = ? AND (employee_id IS NULL OR employee_id <> ?)');
    $query->execute([$email, $current['id'] ?? 0]);
    $query2 = $db->prepare('SELECT COUNT(*) FROM employees WHERE email = ? AND id <> ?');
    $query2->execute([$email, $current['id'] ?? 0]);
    if ((int) $query->fetchColumn() || (int) $query2->fetchColumn()) {
        reobote_fail('Já existe um colaborador ou acesso com este e-mail.');
    }
    // Matricula da empresa (opcional): letras, numeros, ponto, barra e hifen; nao pode repetir entre colaboradores.
    $registration = reobote_str($body, 'registration', 30, false, 'Matrícula');
    if ($registration !== null) {
        if (!preg_match('/^[0-9A-Za-z.\/-]{1,30}$/', $registration)) {
            reobote_fail('A matrícula deve ter só letras, números, ponto, barra ou hífen.');
        }
        $query3 = $db->prepare('SELECT name FROM employees WHERE registration = ? AND id <> ?');
        $query3->execute([$registration, $current['id'] ?? 0]);
        if ($owner = $query3->fetchColumn()) {
            reobote_fail("Esta matrícula já pertence a $owner.");
        }
    }
    $phone = reobote_str($body, 'phone', 32, false, 'Telefone');
    if ($phone !== null && !preg_match('/^[0-9 ()+\-.]{8,32}$/', $phone)) {
        reobote_fail('Informe um telefone válido.');
    }
    $jobId = api_validate_reference($db, 'jobs', isset($body['jobId']) ? (string) $body['jobId'] : null, 'Cargo');
    if ($jobId === null) {
        reobote_fail('Selecione o cargo do colaborador.');
    }
    $role = (string) ($body['role'] ?? ($current['role'] ?? 'employee'));
    if (!array_key_exists($role, REOBOTE_ROLES)) {
        reobote_fail('Perfil de acesso inválido.');
    }
    // Somente administradores concedem ou retiram perfis de administrador e gestor.
    $currentRole = $current['role'] ?? 'employee';
    if ($role !== $currentRole && ($role !== 'employee' || $currentRole !== 'employee') && $user['role'] !== 'admin') {
        reobote_fail('Somente administradores podem alterar perfis de administrador ou gestor.', 403);
    }
    // Salário mensal (opcional). Quando o campo não vem (ex.: ativar/desativar), mantém o atual.
    $salary = array_key_exists('salary', $body) ? reobote_money_cents($body['salary']) : ($current['salary_cents'] ?? null);
    return [
        'name' => $name,
        'registration' => $registration,
        'salary_cents' => $salary === null ? null : (int) $salary,
        'email' => $email,
        'phone' => $phone,
        'job_id' => $jobId,
        'schedule_id' => api_validate_reference($db, 'schedules', isset($body['scheduleId']) ? (string) $body['scheduleId'] : null, 'Jornada'),
        'unit_id' => api_validate_reference($db, 'units', isset($body['unitId']) ? (string) $body['unitId'] : null, 'Unidade'),
        'role' => $role,
        'active' => reobote_bool($body, 'active', (bool) ($current['active'] ?? true)),
    ];
}

// Mantem o historico de cargo e jornada: encerra o vinculo anterior e abre um novo quando algo muda.
function api_record_assignment(PDO $db, array $user, string $employeeId, string $jobId, ?string $scheduleId): void
{
    $query = $db->prepare('SELECT job_id, schedule_id FROM job_assignments WHERE employee_id = ? AND ended_at IS NULL ORDER BY assigned_at DESC, id DESC LIMIT 1');
    $query->execute([$employeeId]);
    $currentAssignment = $query->fetch();
    if ($currentAssignment && (string) $currentAssignment['job_id'] === $jobId && (string) ($currentAssignment['schedule_id'] ?? '') === (string) ($scheduleId ?? '')) {
        return;
    }
    $db->prepare('UPDATE job_assignments SET ended_at = UTC_TIMESTAMP() WHERE employee_id = ? AND ended_at IS NULL')->execute([$employeeId]);
    $job = $db->prepare('SELECT j.name, COALESCE(s1.id, s2.id) AS sid, COALESCE(s1.start_time, s2.start_time) AS st, COALESCE(s1.end_time, s2.end_time) AS et,
                                COALESCE(s1.tolerance_minutes, s2.tolerance_minutes, 0) AS tol
                         FROM jobs j LEFT JOIN schedules s1 ON s1.id = ? LEFT JOIN schedules s2 ON s2.id = j.default_schedule_id WHERE j.id = ?');
    $job->execute([$scheduleId, $jobId]);
    $row = $job->fetch();
    $db->prepare('INSERT INTO job_assignments (employee_id, job_id, schedule_id, title, schedule_start, schedule_end, tolerance_minutes, assigned_at, changed_by_user_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), ?)')
        ->execute([$employeeId, $jobId, $row['sid'], $row['name'], $row['st'], $row['et'], (int) $row['tol'], $user['id']]);
}

// Lista colaboradores com filtros (busca, cargo, unidade, ativos) e a situação atual de cada um.
route('GET', '/api/employees', static function (PDO $db): void {
    $user = reobote_user();
    if (!reobote_can_view_team($user)) {
        reobote_require($user, 'employees');
    }
    $sql = REOBOTE_EMPLOYEE_SELECT . ' WHERE e.deleted_at IS NULL'; // excluídos não aparecem
    $params = [];
    $search = trim((string) ($_GET['search'] ?? ''));
    if ($search !== '') {
        if (mb_strlen($search) > 100) {
            reobote_fail('Pesquisa muito longa.');
        }
        // Busca por nome, e-mail ou matrícula.
        $sql .= ' AND (e.name LIKE ? OR e.email LIKE ? OR e.registration LIKE ?)';
        $term = '%' . addcslashes($search, '%_\\') . '%';
        array_push($params, $term, $term, $term);
    }
    $active = (string) ($_GET['active'] ?? '1');
    if ($active === '1' || $active === '0') {
        $sql .= ' AND e.active = ?';
        $params[] = (int) $active;
    }
    if (!empty($_GET['jobId']) && ctype_digit((string) $_GET['jobId'])) {
        $sql .= ' AND e.job_id = ?';
        $params[] = $_GET['jobId'];
    }
    if (!empty($_GET['unitId']) && ctype_digit((string) $_GET['unitId'])) {
        $sql .= ' AND e.unit_id = ?';
        $params[] = $_GET['unitId'];
    }
    $sql .= ' ORDER BY e.name LIMIT 1000';
    $query = $db->prepare($sql);
    $query->execute($params);
    $rows = $query->fetchAll();
    $states = reobote_current_states($db, array_column($rows, 'id'));
    reobote_json(['employees' => array_map(static fn ($row) => reobote_employee_public($db, $row, $states[(string) $row['id']] ?? null), $rows)]);
});

// Cadastra colaborador e conta de acesso; devolve a senha temporária (exibida uma única vez).
route('POST', '/api/employees', static function (PDO $db): void {
    $user = reobote_user();
    reobote_require($user, 'employees');
    $data = api_employee_input($db, $user, reobote_body(), null);
    $password = reobote_temp_password();

    $db->beginTransaction();
    try {
        $db->prepare('INSERT INTO employees (name, registration, email, phone, job_id, schedule_id, unit_id, salary_cents, active, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, \'Offline\')')
            ->execute([$data['name'], $data['registration'], $data['email'], $data['phone'], $data['job_id'], $data['schedule_id'], $data['unit_id'], $data['salary_cents'], $data['active'] ? 1 : 0]);
        $employeeId = (string) $db->lastInsertId();
        $db->prepare('INSERT INTO users (employee_id, email, password_hash, role, active, must_change_password) VALUES (?, ?, ?, ?, 1, 1)')
            ->execute([$employeeId, $data['email'], password_hash($password, PASSWORD_DEFAULT), $data['role']]);
        api_record_assignment($db, $user, $employeeId, $data['job_id'], $data['schedule_id']);
        reobote_audit($db, $user, 'employee_created', 'employee', $employeeId, ['name' => $data['name'], 'email' => $data['email'], 'role' => $data['role']]);
        $db->commit();
    } catch (Throwable $error) {
        $db->rollBack();
        throw $error;
    }
    reobote_json([
        'employee' => reobote_employee_public($db, reobote_employee_row($db, $employeeId)),
        'temporaryPassword' => $password,
    ], 201);
});

// Dados de um colaborador com a situação atual.
route('GET', '/api/employees/(\d+)', static function (PDO $db, string $id): void {
    $user = reobote_user();
    if (!reobote_can_view_employee($user, $id)) {
        reobote_fail('Você só pode consultar o seu próprio cadastro.', 403);
    }
    $row = reobote_require_employee($db, $id);
    $states = reobote_current_states($db, [$id]);
    reobote_json(['employee' => reobote_employee_public($db, $row, $states[$id])]);
});

// Altera o cadastro; desativar bloqueia o acesso na hora. Mudanças ficam na auditoria.
route('PUT', '/api/employees/(\d+)', static function (PDO $db, string $id): void {
    $user = reobote_user();
    reobote_require($user, 'employees');
    $current = reobote_require_employee($db, $id);
    $data = api_employee_input($db, $user, reobote_body(), $current);
    if ((string) $user['employeeId'] === $id && (!$data['active'] || $data['role'] !== $current['role'])) {
        reobote_fail('Você não pode desativar o próprio acesso nem alterar o próprio perfil.');
    }
    $db->beginTransaction();
    try {
        $db->prepare('UPDATE employees SET name = ?, registration = ?, email = ?, phone = ?, job_id = ?, schedule_id = ?, unit_id = ?, salary_cents = ?, active = ? WHERE id = ?')
            ->execute([$data['name'], $data['registration'], $data['email'], $data['phone'], $data['job_id'], $data['schedule_id'], $data['unit_id'], $data['salary_cents'], $data['active'] ? 1 : 0, $id]);
        if ($current['user_id'] !== null) {
            $db->prepare('UPDATE users SET email = ?, role = ?, active = ? WHERE id = ?')
                ->execute([$data['email'], $data['role'], $data['active'] ? 1 : 0, $current['user_id']]);
        }
        api_record_assignment($db, $user, $id, $data['job_id'], $data['schedule_id']);
        $changes = [];
        foreach (['name', 'email', 'phone', 'job_id', 'schedule_id', 'unit_id', 'salary_cents', 'role', 'active'] as $field) {
            $before = $current[$field] ?? null;
            $after = $data[$field];
            if ((string) ($before ?? '') !== (string) (is_bool($after) ? (int) $after : ($after ?? ''))) {
                $changes[$field] = ['de' => $before, 'para' => $after];
            }
        }
        if ($changes) {
            reobote_audit($db, $user, isset($changes['active']) ? ($data['active'] ? 'employee_reactivated' : 'employee_deactivated') : 'employee_updated', 'employee', $id, $changes);
        }
        $db->commit();
    } catch (Throwable $error) {
        $db->rollBack();
        throw $error;
    }
    reobote_json(['employee' => reobote_employee_public($db, reobote_employee_row($db, $id))]);
});

// Gera nova senha temporaria; o colaborador cria a senha definitiva no proximo acesso.
route('POST', '/api/employees/(\d+)/reset-password', static function (PDO $db, string $id): void {
    $user = reobote_user();
    reobote_require($user, 'employees');
    $employee = reobote_require_employee($db, $id);
    if ($employee['role'] === 'admin' && $user['role'] !== 'admin') {
        reobote_fail('Somente administradores podem redefinir o acesso de outro administrador.', 403);
    }
    $password = reobote_temp_password();
    if ($employee['user_id'] === null) {
        $db->prepare('INSERT INTO users (employee_id, email, password_hash, role, active, must_change_password) VALUES (?, ?, ?, \'employee\', 1, 1)')
            ->execute([$id, $employee['email'], password_hash($password, PASSWORD_DEFAULT)]);
    } else {
        $db->prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?')
            ->execute([password_hash($password, PASSWORD_DEFAULT), $employee['user_id']]);
    }
    reobote_audit($db, $user, 'password_reset', 'employee', $id);
    reobote_json(['temporaryPassword' => $password]);
});

// Exclui o colaborador: some da lista, do painel, do mapa, dos relatórios e das notificações, e perde o
// acesso na hora. Os registros de ponto ficam guardados no banco (sem aparecer), como exige a lei.
// O e-mail e a matrícula ficam livres para um novo cadastro.
route('DELETE', '/api/employees/(\d+)', static function (PDO $db, string $id): void {
    $user = reobote_user();
    reobote_require($user, 'employees');
    $employee = reobote_require_employee($db, $id);
    if ((string) $user['employeeId'] === $id) {
        reobote_fail('Você não pode excluir o próprio cadastro.');
    }
    if (($employee['role'] ?? 'employee') !== 'employee' && $user['role'] !== 'admin') {
        reobote_fail('Somente administradores podem excluir contas de administrador ou gestor.', 403);
    }
    $freed = static fn (string $email): string => mb_substr('excluido-' . $id . '-' . time() . '-' . $email, 0, 190);
    $db->beginTransaction();
    try {
        $db->prepare('UPDATE employees SET deleted_at = UTC_TIMESTAMP(), active = 0, email = ?, registration = NULL WHERE id = ?')
            ->execute([$freed((string) $employee['email']), $id]);
        if ($employee['user_id'] !== null) {
            $db->prepare('UPDATE users SET active = 0, email = ?, last_seen_at = NULL WHERE id = ?')
                ->execute([$freed((string) $employee['email']), $employee['user_id']]);
        }
        reobote_audit($db, $user, 'employee_deleted', 'employee', $id, ['name' => $employee['name'], 'email' => $employee['email'], 'matricula' => $employee['registration']]);
        $db->commit();
    } catch (Throwable $error) {
        $db->rollBack();
        throw $error;
    }
    reobote_json(['deleted' => true]);
});

// Envia ou troca a foto de identificação.
route('POST', '/api/employees/(\d+)/photo', static function (PDO $db, string $id): void {
    $user = reobote_user();
    reobote_require($user, 'employees');
    $employee = reobote_require_employee($db, $id);
    $fileName = reobote_store_photo($_FILES['photo'] ?? []);
    $db->prepare('UPDATE employees SET photo_path = ? WHERE id = ?')->execute([$fileName, $id]);
    reobote_delete_photo($employee['photo_path']);
    reobote_audit($db, $user, 'photo_updated', 'employee', $id);
    reobote_json(['employee' => reobote_employee_public($db, reobote_employee_row($db, $id))]);
});

// Remove a foto de identificação.
route('DELETE', '/api/employees/(\d+)/photo', static function (PDO $db, string $id): void {
    $user = reobote_user();
    reobote_require($user, 'employees');
    $employee = reobote_require_employee($db, $id);
    $db->prepare('UPDATE employees SET photo_path = NULL WHERE id = ?')->execute([$id]);
    reobote_delete_photo($employee['photo_path']);
    reobote_audit($db, $user, 'photo_removed', 'employee', $id);
    reobote_json(['removed' => true]);
});

// Entrega a foto somente a quem pode consultar o colaborador.
route('GET', '/api/employees/(\d+)/photo', static function (PDO $db, string $id): void {
    $user = reobote_user();
    if (!reobote_can_view_employee($user, $id)) {
        reobote_fail('Sem permissão para ver esta foto.', 403);
    }
    $query = $db->prepare('SELECT photo_path FROM employees WHERE id = ?');
    $query->execute([$id]);
    $fileName = (string) $query->fetchColumn();
    $path = $fileName !== '' && preg_match('/^[a-f0-9]{24}\.(jpg|png|webp)$/', $fileName, $match) ? reobote_photo_dir() . '/' . $fileName : null;
    if ($path === null || !is_file($path)) {
        reobote_fail('Foto não encontrada.', 404);
    }
    $types = ['jpg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp'];
    header('Content-Type: ' . $types[$match[1]]);
    header('Content-Length: ' . filesize($path));
    header('Cache-Control: private, max-age=86400');
    readfile($path);
    exit;
});

// Perfil completo: dados, historico de cargos, jornada dos ultimos dias e localizacoes autorizadas.
route('GET', '/api/employees/(\d+)/profile', static function (PDO $db, string $id): void {
    $user = reobote_user();
    if (!reobote_can_view_employee($user, $id)) {
        reobote_fail('Você só pode consultar o seu próprio perfil.', 403);
    }
    $row = reobote_require_employee($db, $id);
    [$from, $to] = reobote_date_range(367, 30);
    $states = reobote_current_states($db, [$id]);
    $query = $db->prepare(
        'SELECT ja.id, ja.title, ja.assigned_at, ja.ended_at, ja.schedule_start, ja.schedule_end, s.name AS schedule_name
         FROM job_assignments ja LEFT JOIN schedules s ON s.id = ja.schedule_id
         WHERE ja.employee_id = ? ORDER BY ja.assigned_at DESC, ja.id DESC LIMIT 50'
    );
    $query->execute([$id]);
    $jobs = array_map(static fn ($job) => [
        'id' => (string) $job['id'],
        'title' => $job['title'],
        'schedule' => $job['schedule_name'] ?? ($job['schedule_start'] ? substr((string) $job['schedule_start'], 0, 5) . ' às ' . substr((string) $job['schedule_end'], 0, 5) : null),
        'assignedAt' => reobote_iso($job['assigned_at']),
        'endedAt' => reobote_iso($job['ended_at']),
    ], $query->fetchAll());
    $query = $db->prepare('SELECT latitude, longitude, accuracy_m, recorded_at FROM employee_locations WHERE employee_id = ? ORDER BY recorded_at DESC LIMIT 200');
    $query->execute([$id]);
    $locations = array_map(static fn ($l) => [
        'latitude' => (float) $l['latitude'], 'longitude' => (float) $l['longitude'],
        'accuracyM' => $l['accuracy_m'] === null ? null : (float) $l['accuracy_m'], 'recordedAt' => reobote_iso($l['recorded_at']),
    ], $query->fetchAll());
    $journey = reobote_journey($db, $row, $from, $to);
    reobote_json([
        'employee' => reobote_employee_public($db, $row, $states[$id]),
        'jobs' => $jobs,
        'journey' => $journey,
        'pay' => reobote_journey_pay($db, $row, $journey, $from, $to), // valor ganho no período (null sem salário)
        'from' => $from,
        'to' => $to,
        'locations' => $locations,
        'canManage' => reobote_has($user, 'employees'),
    ]);
});

// Historico de jornada calculado para relatorios individuais.
route('GET', '/api/employees/(\d+)/attendance', static function (PDO $db, string $id): void {
    $user = reobote_user();
    if (!reobote_can_view_employee($user, $id)) {
        reobote_fail('Sem permissão para consultar este colaborador.', 403);
    }
    $row = reobote_require_employee($db, $id);
    [$from, $to] = reobote_date_range(367, 30);
    reobote_json(['employee' => reobote_employee_public($db, $row), 'from' => $from, 'to' => $to] + reobote_journey($db, $row, $from, $to));
});

// Lancamento manual pela Central (ex.: esquecimento do colaborador). Exige justificativa e fica na auditoria.
route('POST', '/api/employees/(\d+)/attendance', static function (PDO $db, string $id): void {
    $user = reobote_user();
    reobote_require($user, 'employees');
    $employee = reobote_require_employee($db, $id);
    $body = reobote_body();
    $type = (string) ($body['eventType'] ?? '');
    if (!array_key_exists($type, REOBOTE_EVENT_TYPES)) {
        reobote_fail('Tipo de registro inválido.');
    }
    $at = reobote_parse_datetime((string) ($body['occurredAt'] ?? ''), 'Data e hora do registro');
    if ($at > new DateTimeImmutable('+5 minutes', new DateTimeZone('UTC'))) {
        reobote_fail('Não é possível lançar registros no futuro.');
    }
    $reason = reobote_str($body, 'notes', 300, true, 'Justificativa');
    $unitId = api_validate_reference($db, 'units', isset($body['unitId']) ? (string) $body['unitId'] : null, 'Unidade');
    $result = reobote_record_event($db, $employee, $type, $at, [
        'validate' => false, 'source' => 'admin', 'notes' => $reason, 'unitId' => $unitId, 'userId' => $user['id'],
    ]);
    reobote_audit($db, $user, 'attendance_added', 'employee', $id, ['eventId' => $result['eventId'] ?? null, 'tipo' => $type, 'horario' => $at->format('c'), 'justificativa' => $reason]);
    reobote_json($result, 201);
});

// Anulacao de registro: o dado nao e apagado, apenas desconsiderado nos calculos, com motivo e autor.
route('POST', '/api/attendance/(\d+)/void', static function (PDO $db, string $eventId): void {
    $user = reobote_user();
    reobote_require($user, 'employees');
    $reason = reobote_str(reobote_body(), 'reason', 300, true, 'Motivo');
    $query = $db->prepare('SELECT employee_id, event_type, occurred_at FROM attendance_events WHERE id = ? AND voided_at IS NULL');
    $query->execute([$eventId]);
    $event = $query->fetch();
    if (!$event) {
        reobote_fail('Registro não encontrado ou já anulado.', 404);
    }
    $db->prepare('UPDATE attendance_events SET voided_at = UTC_TIMESTAMP(), voided_by_user_id = ?, void_reason = ? WHERE id = ?')
        ->execute([$user['id'], $reason, $eventId]);
    reobote_audit($db, $user, 'attendance_voided', 'employee', (string) $event['employee_id'], ['eventId' => $eventId, 'tipo' => $event['event_type'], 'horario' => reobote_iso($event['occurred_at']), 'motivo' => $reason]);
    reobote_json(['voided' => true]);
});

// Justificativa de falta/atraso (ex.: o técnico avisou a Central pelo WhatsApp). Tira a falta da contagem
// e libera o registro de ponto do dia, mesmo depois do limite. Fica no histórico de alterações.
route('POST', '/api/employees/(\d+)/justifications', static function (PDO $db, string $id): void {
    $user = reobote_user();
    reobote_require($user, 'employees');
    $employee = reobote_require_employee($db, $id);
    $body = reobote_body();
    $day = (string) ($body['date'] ?? '');
    reobote_date_value($day, 'Data');
    if ($day === '') {
        reobote_fail('Informe o dia da justificativa.');
    }
    $reason = reobote_str($body, 'reason', 300, true, 'Motivo');
    // Tipo: "absence" (faltou o dia) ou "late" (chegou atrasado).
    $kind = (string) ($body['kind'] ?? 'absence');
    if (!in_array($kind, ['absence', 'late'], true)) {
        reobote_fail('Escolha se a justificativa é de falta ou de atraso.');
    }
    $db->prepare('INSERT INTO attendance_justifications (employee_id, day, kind, reason, created_by_user_id) VALUES (?, ?, ?, ?, ?)
                  ON DUPLICATE KEY UPDATE kind = VALUES(kind), reason = VALUES(reason), created_by_user_id = VALUES(created_by_user_id), created_at = CURRENT_TIMESTAMP')
        ->execute([$id, $day, $kind, $reason, $user['id']]);
    reobote_audit($db, $user, 'absence_justified', 'employee', $id, ['date' => $day, 'tipo' => $kind === 'late' ? 'atraso' : 'falta', 'reason' => $reason, 'name' => $employee['name']]);
    reobote_json(['justification' => reobote_load_justifications($db, $id, $day, $day)[$day] ?? null]);
});

// Nome do arquivo da foto do atestado de uma justificativa (null quando não há).
function api_justification_attachment(PDO $db, string $employeeId, string $day): ?string
{
    $query = $db->prepare('SELECT attachment_path FROM attendance_justifications WHERE employee_id = ? AND day = ?');
    $query->execute([$employeeId, $day]);
    $path = $query->fetchColumn();
    return $path ? (string) $path : null;
}

// Envia ou troca a foto do atestado/comprovante de uma justificativa (JPG, PNG ou WEBP, até 10 MB).
route('POST', '/api/employees/(\d+)/justifications/(\d{4}-\d{2}-\d{2})/attachment', static function (PDO $db, string $id, string $day): void {
    $user = reobote_user();
    reobote_require($user, 'employees');
    $employee = reobote_require_employee($db, $id);
    $query = $db->prepare('SELECT id, attachment_path FROM attendance_justifications WHERE employee_id = ? AND day = ?');
    $query->execute([$id, $day]);
    $justification = $query->fetch();
    if (!$justification) {
        reobote_fail('Justifique o dia antes de anexar o atestado.', 404);
    }
    $fileName = reobote_store_photo($_FILES['attachment'] ?? [], 'atestados', 1800, 10);
    $db->prepare('UPDATE attendance_justifications SET attachment_path = ? WHERE id = ?')->execute([$fileName, $justification['id']]);
    reobote_delete_photo($justification['attachment_path'], 'atestados');
    reobote_audit($db, $user, 'justification_attachment', 'employee', $id, ['date' => $day, 'name' => $employee['name']]);
    reobote_json(['justification' => reobote_load_justifications($db, $id, $day, $day)[$day] ?? null]);
});

// Entrega a foto do atestado à Central e ao próprio técnico.
route('GET', '/api/employees/(\d+)/justifications/(\d{4}-\d{2}-\d{2})/attachment', static function (PDO $db, string $id, string $day): void {
    $user = reobote_user();
    if (!reobote_can_view_employee($user, $id)) {
        reobote_fail('Sem permissão para ver este atestado.', 403);
    }
    $fileName = (string) api_justification_attachment($db, $id, $day);
    $path = preg_match('/^[a-f0-9]{24}\.(jpg|png|webp)$/', $fileName, $match) ? reobote_photo_dir('atestados') . '/' . $fileName : null;
    if ($path === null || !is_file($path)) {
        reobote_fail('Atestado não encontrado.', 404);
    }
    $types = ['jpg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp'];
    header('Content-Type: ' . $types[$match[1]]);
    header('Content-Length: ' . filesize($path));
    header('Cache-Control: private, no-cache');
    readfile($path);
    exit;
});

// Remove a justificativa de um dia (a falta volta a contar).
route('DELETE', '/api/employees/(\d+)/justifications/(\d{4}-\d{2}-\d{2})', static function (PDO $db, string $id, string $day): void {
    $user = reobote_user();
    reobote_require($user, 'employees');
    $employee = reobote_require_employee($db, $id);
    reobote_delete_photo(api_justification_attachment($db, $id, $day), 'atestados');
    $db->prepare('DELETE FROM attendance_justifications WHERE employee_id = ? AND day = ?')->execute([$id, $day]);
    reobote_audit($db, $user, 'absence_justification_removed', 'employee', $id, ['date' => $day, 'name' => $employee['name']]);
    reobote_json(['removed' => true]);
});

// Localizações recentes do colaborador (as últimas 60), para o perfil atualizar a lista sozinho sem
// recarregar a página inteira. Mesma regra de acesso do perfil.
route('GET', '/api/employees/(\d+)/locations', static function (PDO $db, string $id): void {
    $user = reobote_user();
    if (!reobote_can_view_employee($user, $id)) {
        reobote_fail('Você só pode consultar o seu próprio perfil.', 403);
    }
    $query = $db->prepare('SELECT latitude, longitude, accuracy_m, recorded_at FROM employee_locations WHERE employee_id = ? ORDER BY recorded_at DESC LIMIT 60');
    $query->execute([$id]);
    reobote_json(['locations' => array_map(static fn ($l) => [
        'latitude' => (float) $l['latitude'], 'longitude' => (float) $l['longitude'],
        'accuracyM' => $l['accuracy_m'] === null ? null : (float) $l['accuracy_m'], 'recordedAt' => reobote_iso($l['recorded_at']),
    ], $query->fetchAll())]);
});
