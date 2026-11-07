<?php
declare(strict_types=1);

// Cadastros de apoio: cargos e permissoes, jornadas e escalas, feriados, unidades e QR Codes.

function api_can_read_catalog(array $user): void
{
    if (!reobote_can_view_team($user)) {
        reobote_require($user, 'jobs', 'units', 'employees');
    }
}

// Impede nomes repetidos (ex.: dois cargos com o mesmo nome), ignorando o próprio registro em edição.
function api_unique(PDO $db, string $table, string $column, string $value, ?string $exceptId, string $message): void
{
    $query = $db->prepare("SELECT COUNT(*) FROM `$table` WHERE `$column` = ? AND id <> ?");
    $query->execute([$value, $exceptId ?? 0]);
    if ((int) $query->fetchColumn()) {
        reobote_fail($message);
    }
}

// Cargos -------------------------------------------------------------------------------------

route('GET', '/api/permissions', static function (PDO $db): void {
    reobote_user();
    reobote_json([
        'permissions' => array_map(static fn ($key, $label) => ['key' => $key, 'label' => $label], array_keys(REOBOTE_PERMISSIONS), REOBOTE_PERMISSIONS),
        'roles' => array_map(static fn ($key, $label) => ['key' => $key, 'label' => $label], array_keys(REOBOTE_ROLES), REOBOTE_ROLES),
    ]);
});

// Formato de um cargo enviado ao navegador (com permissões e quantidade de colaboradores).
function api_job_public(array $row): array
{
    $permissions = json_decode((string) ($row['permissions'] ?? '[]'), true);
    return [
        'id' => (string) $row['id'],
        'name' => $row['name'],
        'description' => $row['description'],
        'permissions' => is_array($permissions) ? array_values(array_intersect(array_keys(REOBOTE_PERMISSIONS), $permissions)) : [],
        'defaultScheduleId' => $row['default_schedule_id'] === null ? null : (string) $row['default_schedule_id'],
        'defaultSchedule' => $row['schedule_name'] ?? null,
        'employeeCount' => (int) ($row['employee_count'] ?? 0),
    ];
}

// Valida os dados do formulário de cargo.
function api_job_input(PDO $db, array $body, ?string $id): array
{
    $name = reobote_str($body, 'name', 120, true, 'Nome do cargo');
    api_unique($db, 'jobs', 'name', $name, $id, 'Já existe um cargo com esse nome.');
    $permissions = $body['permissions'] ?? [];
    if (!is_array($permissions)) {
        reobote_fail('Permissões inválidas.');
    }
    $permissions = array_values(array_intersect(array_keys(REOBOTE_PERMISSIONS), array_map('strval', $permissions)));
    return [
        'name' => $name,
        'description' => reobote_str($body, 'description', 500, false, 'Descrição'),
        'permissions' => json_encode($permissions),
        'default_schedule_id' => api_validate_reference($db, 'schedules', isset($body['defaultScheduleId']) ? (string) $body['defaultScheduleId'] : null, 'Jornada padrão'),
    ];
}

const API_JOB_SELECT = 'SELECT j.*, s.name AS schedule_name, (SELECT COUNT(*) FROM employees e WHERE e.job_id = j.id AND e.active = 1) AS employee_count
                        FROM jobs j LEFT JOIN schedules s ON s.id = j.default_schedule_id';

// Lista os cargos.
route('GET', '/api/jobs', static function (PDO $db): void {
    api_can_read_catalog(reobote_user());
    reobote_json(['jobs' => array_map('api_job_public', $db->query(API_JOB_SELECT . ' ORDER BY j.name')->fetchAll())]);
});

// Cria um cargo (registrado na auditoria).
route('POST', '/api/jobs', static function (PDO $db): void {
    $user = reobote_user();
    reobote_require($user, 'jobs');
    $data = api_job_input($db, reobote_body(), null);
    $db->prepare('INSERT INTO jobs (name, description, permissions, default_schedule_id) VALUES (?, ?, ?, ?)')
        ->execute([$data['name'], $data['description'], $data['permissions'], $data['default_schedule_id']]);
    $id = (string) $db->lastInsertId();
    reobote_audit($db, $user, 'job_created', 'job', $id, ['nome' => $data['name'], 'permissoes' => json_decode($data['permissions'])]);
    $query = $db->prepare(API_JOB_SELECT . ' WHERE j.id = ?');
    $query->execute([$id]);
    reobote_json(['job' => api_job_public($query->fetch())], 201);
});

// Altera um cargo e suas permissões (vale para todos os colaboradores do cargo).
route('PUT', '/api/jobs/(\d+)', static function (PDO $db, string $id): void {
    $user = reobote_user();
    reobote_require($user, 'jobs');
    $data = api_job_input($db, reobote_body(), $id);
    $query = $db->prepare('UPDATE jobs SET name = ?, description = ?, permissions = ?, default_schedule_id = ? WHERE id = ?');
    $query->execute([$data['name'], $data['description'], $data['permissions'], $data['default_schedule_id'], $id]);
    reobote_audit($db, $user, 'job_updated', 'job', $id, ['nome' => $data['name'], 'permissoes' => json_decode($data['permissions'])]);
    $query = $db->prepare(API_JOB_SELECT . ' WHERE j.id = ?');
    $query->execute([$id]);
    $row = $query->fetch();
    if (!$row) {
        reobote_fail('Cargo não encontrado.', 404);
    }
    reobote_json(['job' => api_job_public($row)]);
});

// Exclui um cargo, somente se nenhum colaborador estiver vinculado a ele.
route('DELETE', '/api/jobs/(\d+)', static function (PDO $db, string $id): void {
    $user = reobote_user();
    reobote_require($user, 'jobs');
    $query = $db->prepare('SELECT COUNT(*) FROM employees WHERE job_id = ?');
    $query->execute([$id]);
    if ((int) $query->fetchColumn()) {
        reobote_fail('Não é possível excluir um cargo com colaboradores vinculados (inclusive desativados). Altere o cargo deles antes.');
    }
    $query = $db->prepare('DELETE FROM jobs WHERE id = ?');
    $query->execute([$id]);
    reobote_audit($db, $user, 'job_deleted', 'job', $id);
    reobote_json(['deleted' => $query->rowCount() > 0]);
});

// Jornadas e escalas ------------------------------------------------------------------------

function api_schedule_input(PDO $db, array $body, ?string $id): array
{
    $name = reobote_str($body, 'name', 120, true, 'Nome da jornada');
    api_unique($db, 'schedules', 'name', $name, $id, 'Já existe uma jornada com esse nome.');
    $start = reobote_time_value(reobote_str($body, 'start', 5, true, 'Entrada'), 'Entrada');
    $end = reobote_time_value(reobote_str($body, 'end', 5, true, 'Saída'), 'Saída');
    if ($start === $end) {
        reobote_fail('Os horários de entrada e saída devem ser diferentes.');
    }
    $mode = (string) ($body['mode'] ?? 'weekly');
    if (!in_array($mode, ['weekly', 'cycle'], true)) {
        reobote_fail('Tipo de escala inválido.');
    }
    $days = preg_replace('/[^1-7]/', '', (string) ($body['workDays'] ?? ''));
    $days = implode('', array_unique(str_split((string) $days)));
    if ($mode === 'weekly' && $days === '') {
        reobote_fail('Selecione ao menos um dia de trabalho.');
    }
    $chars = str_split($days ?: '12345');
    sort($chars);
    $data = [
        'name' => $name,
        'start_time' => $start,
        'end_time' => $end,
        'break_minutes' => reobote_int($body, 'breakMinutes', 0, 240, 60, 'Intervalo de almoço'),
        'tolerance_minutes' => reobote_int($body, 'toleranceMinutes', 0, 120, 15, 'Tolerância'),
        'mode' => $mode,
        'work_days' => implode('', $chars),
        'cycle_work_days' => reobote_int($body, 'cycleWorkDays', 1, 14, 1, 'Dias de trabalho da escala'),
        'cycle_off_days' => reobote_int($body, 'cycleOffDays', 0, 14, 1, 'Dias de folga da escala'),
        'cycle_anchor' => reobote_date_value(reobote_str($body, 'cycleAnchor', 10), 'Data de início da escala'),
        'off_day_overtime' => reobote_bool($body, 'offDayOvertime', true) ? 1 : 0,
        'notes' => reobote_str($body, 'notes', 500, false, 'Observações'),
    ];
    if ($mode === 'cycle' && $data['cycle_anchor'] === null) {
        reobote_fail('Informe a data de início da escala (primeiro dia de trabalho).');
    }
    $minutes = reobote_schedule_expected_minutes($data);
    if ($minutes <= 0) {
        reobote_fail('O intervalo de almoço não pode ser maior que a jornada.');
    }
    return $data;
}

const API_SCHEDULE_SELECT = 'SELECT s.*,
        (SELECT COUNT(*) FROM jobs j WHERE j.default_schedule_id = s.id) AS job_count,
        (SELECT COUNT(*) FROM employees e WHERE e.active = 1 AND (e.schedule_id = s.id OR (e.schedule_id IS NULL AND e.job_id IN (SELECT j2.id FROM jobs j2 WHERE j2.default_schedule_id = s.id)))) AS employee_count
    FROM schedules s';

// Formato de uma jornada na listagem, com quantos cargos e colaboradores a usam.
function api_schedule_row_public(array $row): array
{
    return reobote_schedule_public($row) + [
        'notes' => $row['notes'],
        'jobCount' => (int) $row['job_count'],
        'employeeCount' => (int) $row['employee_count'],
    ];
}

// Lista as jornadas e escalas.
route('GET', '/api/schedules', static function (PDO $db): void {
    api_can_read_catalog(reobote_user());
    reobote_json(['schedules' => array_map('api_schedule_row_public', $db->query(API_SCHEDULE_SELECT . ' ORDER BY s.name')->fetchAll())]);
});

// Cria uma jornada.
route('POST', '/api/schedules', static function (PDO $db): void {
    $user = reobote_user();
    reobote_require($user, 'jobs');
    $data = api_schedule_input($db, reobote_body(), null);
    $columns = array_keys($data);
    $db->prepare('INSERT INTO schedules (' . implode(', ', $columns) . ') VALUES (' . implode(', ', array_fill(0, count($columns), '?')) . ')')
        ->execute(array_values($data));
    $id = (string) $db->lastInsertId();
    reobote_audit($db, $user, 'schedule_created', 'schedule', $id, $data);
    $query = $db->prepare(API_SCHEDULE_SELECT . ' WHERE s.id = ?');
    $query->execute([$id]);
    reobote_json(['schedule' => api_schedule_row_public($query->fetch())], 201);
});

// Altera uma jornada; os cálculos passam a usar os novos horários.
route('PUT', '/api/schedules/(\d+)', static function (PDO $db, string $id): void {
    $user = reobote_user();
    reobote_require($user, 'jobs');
    $data = api_schedule_input($db, reobote_body(), $id);
    $sets = implode(', ', array_map(static fn ($column) => "$column = ?", array_keys($data)));
    $db->prepare("UPDATE schedules SET $sets WHERE id = ?")->execute([...array_values($data), $id]);
    reobote_audit($db, $user, 'schedule_updated', 'schedule', $id, $data);
    $query = $db->prepare(API_SCHEDULE_SELECT . ' WHERE s.id = ?');
    $query->execute([$id]);
    $row = $query->fetch();
    if (!$row) {
        reobote_fail('Jornada não encontrada.', 404);
    }
    reobote_json(['schedule' => api_schedule_row_public($row)]);
});

// Exclui uma jornada que não esteja em uso.
route('DELETE', '/api/schedules/(\d+)', static function (PDO $db, string $id): void {
    $user = reobote_user();
    reobote_require($user, 'jobs');
    $query = $db->prepare('SELECT (SELECT COUNT(*) FROM jobs WHERE default_schedule_id = ?) + (SELECT COUNT(*) FROM employees WHERE schedule_id = ?)');
    $query->execute([$id, $id]);
    if ((int) $query->fetchColumn()) {
        reobote_fail('Esta jornada está vinculada a cargos ou colaboradores. Troque a jornada deles antes de excluir.');
    }
    $query = $db->prepare('DELETE FROM schedules WHERE id = ?');
    $query->execute([$id]);
    reobote_audit($db, $user, 'schedule_deleted', 'schedule', $id);
    reobote_json(['deleted' => $query->rowCount() > 0]);
});

// Feriados ------------------------------------------------------------------------------------

route('GET', '/api/holidays', static function (PDO $db): void {
    api_can_read_catalog(reobote_user());
    $year = (int) ($_GET['year'] ?? 0);
    $sql = 'SELECT id, holiday_date, name FROM holidays';
    $params = [];
    if ($year >= 2000 && $year <= 2100) {
        $sql .= ' WHERE YEAR(holiday_date) = ?';
        $params[] = $year;
    }
    $query = $db->prepare($sql . ' ORDER BY holiday_date');
    $query->execute($params);
    reobote_json(['holidays' => array_map(static fn ($h) => ['id' => (string) $h['id'], 'date' => $h['holiday_date'], 'name' => $h['name']], $query->fetchAll())]);
});

// Cadastra (ou renomeia) um feriado.
route('POST', '/api/holidays', static function (PDO $db): void {
    $user = reobote_user();
    reobote_require($user, 'jobs');
    $body = reobote_body();
    $date = reobote_date_value(reobote_str($body, 'date', 10, true, 'Data'), 'Data');
    $name = reobote_str($body, 'name', 120, true, 'Nome do feriado');
    $db->prepare('INSERT INTO holidays (holiday_date, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)')->execute([$date, $name]);
    reobote_audit($db, $user, 'holiday_saved', 'holiday', $date, ['nome' => $name]);
    reobote_json(['saved' => true], 201);
});

// Remove um feriado.
route('DELETE', '/api/holidays/(\d+)', static function (PDO $db, string $id): void {
    $user = reobote_user();
    reobote_require($user, 'jobs');
    $db->prepare('DELETE FROM holidays WHERE id = ?')->execute([$id]);
    reobote_audit($db, $user, 'holiday_deleted', 'holiday', $id);
    reobote_json(['deleted' => true]);
});

// Unidades ------------------------------------------------------------------------------------

function api_unit_public(array $row): array
{
    return [
        'id' => (string) $row['id'],
        'name' => $row['name'],
        'kind' => $row['kind'],
        'address' => $row['address'],
        'latitude' => $row['latitude'] === null ? null : (float) $row['latitude'],
        'longitude' => $row['longitude'] === null ? null : (float) $row['longitude'],
        'radiusM' => (int) $row['radius_m'],
        'active' => (bool) $row['active'],
        'employeeCount' => (int) ($row['employee_count'] ?? 0),
        'qrCount' => (int) ($row['qr_count'] ?? 0),
    ];
}

// Valida os dados do formulário de unidade (nome, endereço, coordenadas e raio de chegada).
function api_unit_input(PDO $db, array $body, ?string $id): array
{
    $name = reobote_str($body, 'name', 160, true, 'Nome da unidade');
    api_unique($db, 'units', 'name', $name, $id, 'Já existe uma unidade com esse nome.');
    $lat = $body['latitude'] ?? null;
    $lng = $body['longitude'] ?? null;
    $lat = $lat === null || $lat === '' ? null : filter_var($lat, FILTER_VALIDATE_FLOAT);
    $lng = $lng === null || $lng === '' ? null : filter_var($lng, FILTER_VALIDATE_FLOAT);
    if ($lat === false || $lng === false || ($lat !== null && ($lat < -90 || $lat > 90)) || ($lng !== null && ($lng < -180 || $lng > 180)) || (($lat === null) !== ($lng === null))) {
        reobote_fail('Informe latitude e longitude válidas (ou deixe as duas em branco).');
    }
    return [
        'name' => $name,
        'kind' => reobote_str($body, 'kind', 40, false, 'Tipo') ?? 'Unidade hospitalar',
        'address' => reobote_str($body, 'address', 300, false, 'Endereço'),
        'latitude' => $lat,
        'longitude' => $lng,
        'radius_m' => reobote_int($body, 'radiusM', 30, 5000, 300, 'Raio de chegada'),
        'active' => reobote_bool($body, 'active', true) ? 1 : 0,
    ];
}

const API_UNIT_SELECT = 'SELECT un.*, (SELECT COUNT(*) FROM employees e WHERE e.unit_id = un.id AND e.active = 1) AS employee_count,
        (SELECT COUNT(*) FROM qr_codes q WHERE q.unit_id = un.id AND q.active = 1) AS qr_count FROM units un';

// Lista as unidades de atendimento.
route('GET', '/api/units', static function (PDO $db): void {
    api_can_read_catalog(reobote_user());
    reobote_json(['units' => array_map('api_unit_public', $db->query(API_UNIT_SELECT . ' ORDER BY un.active DESC, un.name')->fetchAll())]);
});

// Cria uma unidade e o QR Code de chegada dela.
route('POST', '/api/units', static function (PDO $db): void {
    $user = reobote_user();
    reobote_require($user, 'units');
    $data = api_unit_input($db, reobote_body(), null);
    $db->prepare('INSERT INTO units (name, kind, address, latitude, longitude, radius_m, active) VALUES (?, ?, ?, ?, ?, ?, ?)')->execute(array_values($data));
    $id = (string) $db->lastInsertId();
    // Toda unidade nasce com o QR Code de chegada pronto para impressao.
    $db->prepare("INSERT INTO qr_codes (kind, label, unit_id, token) VALUES ('unit', ?, ?, ?)")->execute([$data['name'], $id, bin2hex(random_bytes(16))]);
    reobote_audit($db, $user, 'unit_created', 'unit', $id, ['nome' => $data['name']]);
    $query = $db->prepare(API_UNIT_SELECT . ' WHERE un.id = ?');
    $query->execute([$id]);
    reobote_json(['unit' => api_unit_public($query->fetch())], 201);
});

// Altera uma unidade (desativar bloqueia os QR Codes dela).
route('PUT', '/api/units/(\d+)', static function (PDO $db, string $id): void {
    $user = reobote_user();
    reobote_require($user, 'units');
    $data = api_unit_input($db, reobote_body(), $id);
    $db->prepare('UPDATE units SET name = ?, kind = ?, address = ?, latitude = ?, longitude = ?, radius_m = ?, active = ? WHERE id = ?')
        ->execute([...array_values($data), $id]);
    reobote_audit($db, $user, 'unit_updated', 'unit', $id, $data);
    $query = $db->prepare(API_UNIT_SELECT . ' WHERE un.id = ?');
    $query->execute([$id]);
    $row = $query->fetch();
    if (!$row) {
        reobote_fail('Unidade não encontrada.', 404);
    }
    reobote_json(['unit' => api_unit_public($row)]);
});

// Exclui uma unidade sem histórico; com histórico, ela deve ser desativada.
route('DELETE', '/api/units/(\d+)', static function (PDO $db, string $id): void {
    $user = reobote_user();
    reobote_require($user, 'units');
    $query = $db->prepare('SELECT (SELECT COUNT(*) FROM attendance_events WHERE unit_id = ?) + (SELECT COUNT(*) FROM employees WHERE unit_id = ?)');
    $query->execute([$id, $id]);
    if ((int) $query->fetchColumn()) {
        reobote_fail('A unidade possui registros ou colaboradores vinculados. Desative-a para preservar o histórico.');
    }
    $db->prepare('DELETE FROM units WHERE id = ?')->execute([$id]);
    reobote_audit($db, $user, 'unit_deleted', 'unit', $id);
    reobote_json(['deleted' => true]);
});

// QR Codes ------------------------------------------------------------------------------------

function api_qr_public(array $row): array
{
    return [
        'id' => (string) $row['id'],
        'kind' => $row['kind'],
        'kindLabel' => $row['kind'] === 'unit' ? 'Unidade' : 'Veículo',
        'label' => $row['label'],
        'unitId' => $row['unit_id'] === null ? null : (string) $row['unit_id'],
        'unit' => $row['unit_name'],
        'active' => (bool) $row['active'],
        'payload' => 'REOBOTE:' . ($row['kind'] === 'unit' ? 'U' : 'V') . ':' . $row['token'],
        'lastUsedAt' => reobote_iso($row['last_used_at'] ?? null),
    ];
}

const API_QR_SELECT = 'SELECT q.*, u.name AS unit_name,
        (SELECT MAX(a.occurred_at) FROM attendance_events a WHERE a.qr_code_id = q.id) AS last_used_at
    FROM qr_codes q LEFT JOIN units u ON u.id = q.unit_id';

// Busca um QR Code pelo número; responde 404 quando não existe.
function api_qr_find(PDO $db, string $id): array
{
    $query = $db->prepare(API_QR_SELECT . ' WHERE q.id = ?');
    $query->execute([$id]);
    $row = $query->fetch();
    if (!$row) {
        reobote_fail('QR Code não encontrado.', 404);
    }
    return $row;
}

// Lista os QR Codes de veículos e unidades, com o conteúdo a ser impresso.
route('GET', '/api/qr-codes', static function (PDO $db): void {
    reobote_require(reobote_user(), 'units');
    reobote_json(['qrCodes' => array_map('api_qr_public', $db->query(API_QR_SELECT . ' ORDER BY q.kind, q.active DESC, q.label')->fetchAll())]);
});

// Cria um QR Code de veículo ou um QR Code adicional de unidade (ex.: outra entrada).
route('POST', '/api/qr-codes', static function (PDO $db): void {
    $user = reobote_user();
    reobote_require($user, 'units');
    $body = reobote_body();
    $kind = (string) ($body['kind'] ?? '');
    if (!in_array($kind, ['vehicle', 'unit'], true)) {
        reobote_fail('Escolha se o QR Code é de veículo ou de unidade.');
    }
    $label = reobote_str($body, 'label', 160, true, $kind === 'vehicle' ? 'Identificação do veículo' : 'Descrição');
    $unitId = api_validate_reference($db, 'units', isset($body['unitId']) ? (string) $body['unitId'] : null, 'Unidade');
    if ($kind === 'unit' && $unitId === null) {
        reobote_fail('Selecione a unidade deste QR Code.');
    }
    $db->prepare('INSERT INTO qr_codes (kind, label, unit_id, token) VALUES (?, ?, ?, ?)')
        ->execute([$kind, $label, $kind === 'unit' ? $unitId : null, bin2hex(random_bytes(16))]);
    $id = (string) $db->lastInsertId();
    reobote_audit($db, $user, 'qr_created', 'qr_code', $id, ['tipo' => $kind, 'descricao' => $label]);
    reobote_json(['qrCode' => api_qr_public(api_qr_find($db, $id))], 201);
});

// Renomeia, desativa ou reativa um QR Code.
route('PUT', '/api/qr-codes/(\d+)', static function (PDO $db, string $id): void {
    $user = reobote_user();
    reobote_require($user, 'units');
    $current = api_qr_find($db, $id);
    $body = reobote_body();
    $label = reobote_str($body, 'label', 160, false, 'Descrição') ?? $current['label'];
    $active = reobote_bool($body, 'active', (bool) $current['active']);
    $db->prepare('UPDATE qr_codes SET label = ?, active = ? WHERE id = ?')->execute([$label, $active ? 1 : 0, $id]);
    reobote_audit($db, $user, $active ? 'qr_updated' : 'qr_deactivated', 'qr_code', $id, ['descricao' => $label, 'ativo' => $active]);
    reobote_json(['qrCode' => api_qr_public(api_qr_find($db, $id))]);
});

// Gera um novo codigo (por exemplo, se a etiqueta foi fotografada ou danificada); o anterior deixa de funcionar.
route('POST', '/api/qr-codes/(\d+)/regenerate', static function (PDO $db, string $id): void {
    $user = reobote_user();
    reobote_require($user, 'units');
    api_qr_find($db, $id);
    $db->prepare('UPDATE qr_codes SET token = ? WHERE id = ?')->execute([bin2hex(random_bytes(16)), $id]);
    reobote_audit($db, $user, 'qr_regenerated', 'qr_code', $id);
    reobote_json(['qrCode' => api_qr_public(api_qr_find($db, $id))]);
});
