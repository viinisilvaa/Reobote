<?php
// REOBOTE | server/routes/central.php — API: painel, mapa, notificações, relatórios e configurações
declare(strict_types=1);

// Rotas da Central REOBOTE: painel, mapa, notificacoes, relatorios, configuracoes e auditoria.

// Colaboradores ativos com cargo e escala, usados pelos calculos coletivos.
function api_active_employees(PDO $db, ?string $jobId = null, ?string $unitId = null, ?string $employeeId = null, bool $includeInactive = false): array
{
    // Só técnicos (perfil Colaborador): Administrador e Gestor não batem ponto e ficam fora do painel, mapa e relatórios.
    $sql = REOBOTE_EMPLOYEE_SELECT . ($includeInactive ? ' WHERE 1 = 1' : ' WHERE e.active = 1') . " AND (u.role IS NULL OR u.role = 'employee') AND e.deleted_at IS NULL";
    $params = [];
    if ($jobId !== null) {
        $sql .= ' AND e.job_id = ?';
        $params[] = $jobId;
    }
    if ($unitId !== null) {
        $sql .= ' AND e.unit_id = ?';
        $params[] = $unitId;
    }
    if ($employeeId !== null) {
        $sql .= ' AND e.id = ?';
        $params[] = $employeeId;
    }
    $query = $db->prepare($sql . ' ORDER BY e.name');
    $query->execute($params);
    return $query->fetchAll();
}

// Lê um identificador numérico da URL (ex.: ?jobId=3); null quando ausente ou inválido.
function api_query_id(string $key): ?string
{
    $value = (string) ($_GET[$key] ?? '');
    return $value !== '' && ctype_digit($value) ? $value : null;
}

// Painel principal ----------------------------------------------------------------------------

route('GET', '/api/dashboard', static function (PDO $db): void {
    $user = reobote_user();
    reobote_require($user, 'dashboard');
    reobote_sweep_absences($db);

    $tz = reobote_timezone();
    $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $today = $now->setTimezone($tz)->format('Y-m-d');
    // Período do gráfico em dias: só 7, 30 ou 90; qualquer outro valor (ou nenhum) vira 7.
    $period = (int) ($_GET['period'] ?? 7);
    if (!in_array($period, [7, 30, 90], true)) {
        $period = 7;
    }
    $from = $now->setTimezone($tz)->modify('-' . ($period - 1) . ' days')->format('Y-m-d');

    $employees = api_active_employees($db);
    $states = reobote_current_states($db, array_column($employees, 'id'), $now);
    $metrics = ['total' => count($employees), 'active' => 0, 'late' => 0, 'absent' => 0, 'onBreak' => 0, 'finished' => 0, 'overtimeMinutes' => 0, 'lateMinutes' => 0];
    $presence = [];
    $team = [];
    for ($cursor = new DateTimeImmutable($from); $cursor->format('Y-m-d') <= $today; $cursor = $cursor->modify('+1 day')) {
        $presence[$cursor->format('Y-m-d')] = ['present' => 0, 'late' => 0];
    }

    foreach ($employees as $row) {
        $id = (string) $row['id'];
        $state = $states[$id];
        $journey = reobote_journey($db, $row, $from, $today, $now);
        $todayDay = null;
        foreach ($journey['days'] as $day) {
            if (isset($presence[$day['date']]) && in_array($day['status'], ['worked', 'in_progress'], true)) {
                $presence[$day['date']]['present']++;
                if ($day['lateMinutes'] > 0) {
                    $presence[$day['date']]['late']++;
                }
            }
            if ($day['date'] === $today) {
                $todayDay = $day;
            }
        }
        if (in_array($state['state'], ['working', 'in_transit', 'on_break'], true)) {
            $metrics['active']++;
        }
        if ($state['state'] === 'on_break') {
            $metrics['onBreak']++;
        }
        if ($state['state'] === 'finished') {
            $metrics['finished']++;
        }
        // Atrasados hoje: chegou depois da tolerância, ou ainda não chegou mas não passou do limite da falta.
        // Faltas hoje: dia marcado como falta (sem registro após o limite, ou chegou tão tarde que contou falta).
        // Quem já está como falta NÃO conta também como atrasado: é só falta.
        if ($todayDay !== null && $todayDay['status'] === 'absent') {
            $metrics['absent']++;
        } elseif ($todayDay !== null && ($todayDay['lateMinutes'] > 0 || ($todayDay['status'] === 'not_arrived' && $state['state'] === 'waiting'))) {
            $metrics['late']++;
        }
        $metrics['overtimeMinutes'] += $journey['totals']['overtimeMinutes'];
        $metrics['lateMinutes'] += $journey['totals']['lateMinutes'];
        $team[] = reobote_employee_public($db, $row, $state) + [
            'todayStatus' => $todayDay['status'] ?? 'off',
            'todayLateMinutes' => $todayDay['lateMinutes'] ?? 0,
            'todayArrivalDelayMinutes' => $todayDay['arrivalDelayMinutes'] ?? 0, // > 0: chegou tão tarde que contou falta
        ];
    }

    // Grafico: presencas por dia (ou por semana no periodo de 90 dias).
    $chart = [];
    if ($period === 90) {
        $chunks = array_chunk($presence, 7, true);
        foreach ($chunks as $chunk) {
            $dates = array_keys($chunk);
            $chart[] = ['label' => (new DateTimeImmutable($dates[0]))->format('d/m'), 'from' => $dates[0], 'to' => end($dates),
                'present' => array_sum(array_column($chunk, 'present')), 'late' => array_sum(array_column($chunk, 'late'))];
        }
    } else {
        foreach ($presence as $date => $values) {
            $chart[] = ['label' => (new DateTimeImmutable($date))->format('d/m'), 'from' => $date, 'to' => $date] + $values;
        }
    }

    $query = $db->query(
        'SELECT a.id, a.employee_id, a.event_type, a.occurred_at, a.received_at, a.unit_id, a.qr_code_id, a.source, a.notes, a.distance_m,
                COALESCE(un.name, a.unit_name) AS unit_name, COALESCE(q.label, a.qr_label) AS qr_label, e.name, e.photo_path, j.name AS job_name,
                un.radius_m AS unit_radius, e.unit_id AS employee_unit_id
         FROM attendance_events a
         JOIN employees e ON e.id = a.employee_id
         LEFT JOIN jobs j ON j.id = e.job_id
         LEFT JOIN units un ON un.id = a.unit_id
         LEFT JOIN qr_codes q ON q.id = a.qr_code_id
         WHERE a.voided_at IS NULL AND e.deleted_at IS NULL -- colaboradores excluídos não aparecem
         ORDER BY a.occurred_at DESC, a.id DESC LIMIT 12'
    );
    $recent = array_map(static fn ($row) => reobote_event_public(reobote_event_from_row($row)) + [
        'employeeId' => (string) $row['employee_id'], 'employeeName' => $row['name'], 'hasPhoto' => (bool) $row['photo_path'],
        'photoVersion' => $row['photo_path'] ? substr(md5((string) $row['photo_path']), 0, 8) : null, 'job' => $row['job_name'],
    ], $query->fetchAll());

    reobote_json(['period' => $period, 'metrics' => $metrics, 'chart' => $chart, 'team' => $team, 'recent' => $recent, 'serverTime' => $now->format('Y-m-d\TH:i:s\Z')]);
});

// Mapa ----------------------------------------------------------------------------------------

route('GET', '/api/map', static function (PDO $db): void {
    $user = reobote_user();
    reobote_require($user, 'dashboard');
    $employees = api_active_employees($db);
    $states = reobote_current_states($db, array_column($employees, 'id'));
    $locations = [];
    $query = $db->query(
        'SELECT l.employee_id, l.latitude, l.longitude, l.accuracy_m, l.recorded_at FROM employee_locations l
         JOIN (SELECT employee_id, MAX(recorded_at) AS recorded_at FROM employee_locations
               WHERE recorded_at >= UTC_TIMESTAMP() - INTERVAL 10 MINUTE GROUP BY employee_id) latest
           ON latest.employee_id = l.employee_id AND latest.recorded_at = l.recorded_at'
    );
    foreach ($query->fetchAll() as $row) {
        $locations[(string) $row['employee_id']] = $row;
    }
    $units = array_map('api_unit_public', $db->query(API_UNIT_SELECT . ' WHERE un.active = 1 AND un.deleted_at IS NULL ORDER BY un.name')->fetchAll());
    $unitsById = array_column($units, null, 'id');

    $team = [];
    foreach ($employees as $row) {
        $id = (string) $row['id'];
        $item = reobote_employee_public($db, $row, $states[$id]);
        // Unidade onde o tecnico esta presente: a do ultimo QR Code de unidade lido no turno em andamento
        // (em atendimento ou almoco). Ler o QR do veiculo depois significa que ele saiu da unidade.
        // Nao ha limite: varios tecnicos podem estar na mesma unidade.
        $attendanceUnitId = null;
        $shift = $states[$id]['shift'];
        if ($shift !== null && $shift['ongoing'] && in_array($item['state'], ['working', 'on_break'], true)) {
            foreach ($shift['events'] as $event) {
                if (in_array($event['type'], ['vehicle_checkin', 'unit_checkout'], true)) { // saiu da unidade
                    $attendanceUnitId = null;
                } elseif ($event['type'] === 'unit_checkin') {
                    $attendanceUnitId = ($event['atUnit'] ?? true) ? $event['unitId'] : null; // só com presença confirmada
                }
            }
        }
        // A localizacao e enviada automaticamente pelo aplicativo durante a jornada.
        $location = in_array($item['state'], ['in_transit', 'working', 'on_break'], true) ? ($locations[$id] ?? null) : null;
        $item['location'] = $location ? [
            'latitude' => (float) $location['latitude'], 'longitude' => (float) $location['longitude'],
            'accuracyM' => $location['accuracy_m'] === null ? null : (float) $location['accuracy_m'],
            'recordedAt' => reobote_iso($location['recorded_at']),
        ] : null;
        // Se o GPS mostrar o tecnico fora do raio da unidade (com margem da precisao do GPS), ele deixa de contar como presente.
        $attendanceUnit = $attendanceUnitId !== null ? ($unitsById[$attendanceUnitId] ?? null) : null;
        if ($attendanceUnit && $location && $attendanceUnit['latitude'] !== null && $attendanceUnit['longitude'] !== null) {
            $distance = reobote_distance_m(
                (float) $location['latitude'], (float) $location['longitude'],
                $attendanceUnit['latitude'], $attendanceUnit['longitude']
            );
            $gpsTolerance = min(100, (float) ($location['accuracy_m'] ?? 0));
            if ($distance > $attendanceUnit['radiusM'] + $gpsTolerance) {
                $attendanceUnitId = null;
            }
        }
        $item['attendanceUnitId'] = $attendanceUnitId;
        // Distancia ate a unidade de presenca, do ultimo registro ou do cadastro.
        $unitId = $attendanceUnitId ?? ($item['lastEvent']['unitId'] ?? $item['unitId']);
        $unit = $unitId !== null ? ($unitsById[$unitId] ?? null) : null;
        $item['referenceUnit'] = $unit ? $unit['name'] : null;
        $item['distanceToUnitM'] = $location && $unit && $unit['latitude'] !== null
            ? reobote_distance_m((float) $location['latitude'], (float) $location['longitude'], $unit['latitude'], $unit['longitude'])
            : null;
        $team[] = $item;
    }
    reobote_json(['employees' => $team, 'units' => $units, 'serverTime' => gmdate('Y-m-d\TH:i:s\Z')]);
});

// Notificacoes --------------------------------------------------------------------------------

function api_unread_count(PDO $db, array $user): int
{
    $query = $db->prepare(
        'SELECT COUNT(*) FROM notifications n
         LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ?
         LEFT JOIN employees e ON e.id = n.employee_id
         WHERE r.user_id IS NULL AND n.created_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY AND e.deleted_at IS NULL'
    );
    $query->execute([$user['id']]);
    return (int) $query->fetchColumn();
}

// Quantidade de notificações não lidas (número vermelho no sino da Central).
route('GET', '/api/notifications/count', static function (PDO $db): void {
    $user = reobote_user();
    reobote_require($user, 'notifications', 'dashboard');
    reobote_sweep_absences($db);
    // latestId: numero da notificacao mais recente; a Central usa para mostrar avisos novos na hora (estilo WhatsApp).
    $latest = (string) ($db->query('SELECT COALESCE(MAX(id), 0) FROM notifications')->fetchColumn());
    reobote_json(['unread' => api_unread_count($db, $user), 'latestId' => $latest]);
});

// Mensagem pronta para o responsável da unidade: { phone, text, name } ou null.
// Só para chegadas à unidade cuja unidade tem WhatsApp do responsável cadastrado.
function api_unit_whatsapp(array $row): ?array
{
    if ($row['type'] !== 'unit_checkin' || empty($row['responsible_phone'])) {
        return null;
    }
    $time = $row['event_at'] ? reobote_local_time(new DateTimeImmutable($row['event_at'], new DateTimeZone('UTC'))) : '';
    $hello = $row['responsible_name'] ? 'Olá, ' . $row['responsible_name'] . '!' : 'Olá!';
    $text = sprintf('%s O técnico %s chegou na unidade %s%s. — Grupo REOBOTE', $hello, $row['employee_name'] ?? 'da equipe', $row['unit_name'] ?? '', $time !== '' ? ' às ' . $time : '');
    return ['phone' => $row['responsible_phone'], 'name' => $row['responsible_name'], 'text' => $text];
}

// Lista as notificações dos últimos 90 dias, com filtros de lidas/não lidas e de tipo.
route('GET', '/api/notifications', static function (PDO $db): void {
    $user = reobote_user();
    reobote_require($user, 'notifications', 'dashboard');
    reobote_sweep_absences($db);
    $filter = (string) ($_GET['filter'] ?? 'all');
    $type = (string) ($_GET['type'] ?? '');
    $limit = max(1, min(200, (int) ($_GET['limit'] ?? 50)));
    // Para chegadas à unidade, traz também o responsável da unidade (botão "Avisar no WhatsApp").
    $sql = 'SELECT n.id, n.type, n.title, n.detail, n.employee_id, n.created_at, n.dedupe_key, n.resolution, r.read_at, e.photo_path, e.name AS employee_name,
                   ev.occurred_at AS event_at, COALESCE(un.name, ev.unit_name) AS unit_name, un.responsible_name, un.responsible_phone
            FROM notifications n
            LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ?
            LEFT JOIN employees e ON e.id = n.employee_id
            LEFT JOIN attendance_events ev ON ev.id = n.event_id
            LEFT JOIN units un ON un.id = ev.unit_id
            WHERE n.created_at >= UTC_TIMESTAMP() - INTERVAL 90 DAY AND e.deleted_at IS NULL';
    $params = [$user['id']];
    if ($filter === 'unread') {
        $sql .= ' AND r.user_id IS NULL';
    } elseif ($filter === 'read') {
        $sql .= ' AND r.user_id IS NOT NULL';
    }
    if ($type !== '' && array_key_exists($type, REOBOTE_NOTIFICATION_ICONS)) {
        $sql .= ' AND n.type = ?';
        $params[] = $type;
    }
    // after: somente notificacoes mais novas que este numero (avisos em tempo real).
    if (($after = api_query_id('after')) !== null) {
        $sql .= ' AND n.id > ?';
        $params[] = $after;
    }
    if (($before = api_query_id('before')) !== null) {
        $sql .= ' AND n.id < ?';
        $params[] = $before;
    }
    $query = $db->prepare($sql . ' ORDER BY n.id DESC LIMIT ' . $limit);
    $query->execute($params);
    $items = array_map(static fn ($row) => [
        'id' => (string) $row['id'],
        'type' => $row['type'],
        'icon' => REOBOTE_NOTIFICATION_ICONS[$row['type']] ?? 'fa-bell',
        'title' => $row['title'],
        'detail' => $row['detail'],
        'employeeId' => $row['employee_id'] === null ? null : (string) $row['employee_id'],
        'hasPhoto' => (bool) $row['photo_path'],
        'createdAt' => reobote_iso($row['created_at']),
        'read' => $row['read_at'] !== null,
        'whatsapp' => api_unit_whatsapp($row),
        'release' => api_notification_release($db, $row),
    ], $query->fetchAll());
    reobote_json(['notifications' => $items, 'unread' => api_unread_count($db, $user), 'hasMore' => count($items) === $limit]);
});

/**
 * Pedido de liberação: notificação de registro recusado por falta ("tentou registrar o ponto, mas o dia está
 * como falta"). Devolve { date, status } — status "pending" (aguardando decisão), "released" (justificada e
 * liberada) ou "denied" (não liberada) — ou null para as demais notificações.
 */
function api_notification_release(PDO $db, array $row): ?array
{
    if (!preg_match('/^absence-blocked:\d+:(\d{4}-\d{2}-\d{2})$/', (string) ($row['dedupe_key'] ?? ''), $match)) {
        return null;
    }
    $date = $match[1];
    $status = $row['resolution'] ?: null;
    if ($status === null && $row['employee_id'] !== null && reobote_load_justifications($db, (string) $row['employee_id'], $date, $date)) {
        $status = 'released'; // justificada pelo perfil do colaborador
    }
    return ['date' => $date, 'status' => $status ?? 'pending'];
}

// Busca o pedido de liberação de uma notificação; responde 404 quando não é um pedido.
function api_release_request(PDO $db, string $id): array
{
    $query = $db->prepare('SELECT n.id, n.employee_id, n.dedupe_key, n.resolution, e.name FROM notifications n
                           JOIN employees e ON e.id = n.employee_id WHERE n.id = ? AND e.deleted_at IS NULL');
    $query->execute([$id]);
    $row = $query->fetch();
    $release = $row ? api_notification_release($db, $row) : null;
    if ($release === null) {
        reobote_fail('Pedido de liberação não encontrado.', 404);
    }
    return $row + ['release' => $release];
}

// Justifica o dia e LIBERA o técnico para registrar o ponto (o aplicativo deixa de recusar na hora).
route('POST', '/api/notifications/(\d+)/release', static function (PDO $db, string $id): void {
    $user = reobote_user();
    reobote_require($user, 'employees');
    $request = api_release_request($db, $id);
    $reason = reobote_str(reobote_body(), 'reason', 300, true, 'Motivo');
    $date = $request['release']['date'];
    $db->beginTransaction();
    try {
        // Ele vai trabalhar no dia: a justificativa é de atraso (se chegou tarde demais, o dia fica como falta justificada).
        $db->prepare('INSERT INTO attendance_justifications (employee_id, day, kind, reason, created_by_user_id) VALUES (?, ?, \'late\', ?, ?)
                      ON DUPLICATE KEY UPDATE reason = VALUES(reason), created_by_user_id = VALUES(created_by_user_id), created_at = CURRENT_TIMESTAMP')
            ->execute([$request['employee_id'], $date, $reason, $user['id']]);
        $db->prepare("UPDATE notifications SET resolution = 'released' WHERE id = ?")->execute([$id]);
        $db->prepare('INSERT IGNORE INTO notification_reads (user_id, notification_id, read_at) VALUES (?, ?, UTC_TIMESTAMP())')->execute([$user['id'], $id]);
        reobote_audit($db, $user, 'absence_justified', 'employee', (string) $request['employee_id'],
            ['date' => $date, 'tipo' => 'atraso', 'reason' => $reason, 'name' => $request['name'], 'liberado' => true]);
        $db->commit();
    } catch (Throwable $error) {
        $db->rollBack();
        throw $error;
    }
    reobote_json(['release' => ['date' => $date, 'status' => 'released']]);
});

// NÃO libera: o dia continua como falta e o aplicativo continua recusando o registro.
route('POST', '/api/notifications/(\d+)/deny', static function (PDO $db, string $id): void {
    $user = reobote_user();
    reobote_require($user, 'employees');
    $request = api_release_request($db, $id);
    if ($request['release']['status'] === 'released') {
        reobote_fail('Este registro já foi liberado. Para voltar atrás, remova a justificativa no perfil do colaborador.');
    }
    $db->prepare("UPDATE notifications SET resolution = 'denied' WHERE id = ?")->execute([$id]);
    $db->prepare('INSERT IGNORE INTO notification_reads (user_id, notification_id, read_at) VALUES (?, ?, UTC_TIMESTAMP())')->execute([$user['id'], $id]);
    reobote_audit($db, $user, 'release_denied', 'employee', (string) $request['employee_id'], ['date' => $request['release']['date'], 'name' => $request['name']]);
    reobote_json(['release' => ['date' => $request['release']['date'], 'status' => 'denied']]);
});

// Marca notificações como lidas (algumas ou todas) para o usuário atual.
route('POST', '/api/notifications/read', static function (PDO $db): void {
    $user = reobote_user();
    reobote_require($user, 'notifications', 'dashboard');
    $body = reobote_body();
    if (reobote_bool($body, 'all')) {
        $db->prepare('INSERT IGNORE INTO notification_reads (user_id, notification_id, read_at)
                      SELECT ?, n.id, UTC_TIMESTAMP() FROM notifications n WHERE n.created_at >= UTC_TIMESTAMP() - INTERVAL 90 DAY')
            ->execute([$user['id']]);
    } else {
        $ids = array_values(array_filter(array_map('strval', (array) ($body['ids'] ?? [])), 'ctype_digit'));
        if (!$ids || count($ids) > 200) {
            reobote_fail('Informe as notificações a marcar como lidas.');
        }
        $insert = $db->prepare('INSERT IGNORE INTO notification_reads (user_id, notification_id, read_at)
                                SELECT ?, id, UTC_TIMESTAMP() FROM notifications WHERE id = ?');
        foreach ($ids as $id) {
            $insert->execute([$user['id'], $id]);
        }
    }
    // latestId: numero da notificacao mais recente; a Central usa para mostrar avisos novos na hora (estilo WhatsApp).
    $latest = (string) ($db->query('SELECT COALESCE(MAX(id), 0) FROM notifications')->fetchColumn());
    reobote_json(['unread' => api_unread_count($db, $user), 'latestId' => $latest]);
});

// Relatorios ----------------------------------------------------------------------------------

// Resumo por colaborador no periodo: frequencia, faltas, atrasos, horas extras, intervalos e horas trabalhadas.
route('GET', '/api/reports', static function (PDO $db): void {
    $user = reobote_user();
    reobote_require($user, 'reports');
    [$from, $to] = reobote_date_range(367, 30);
    $employees = api_active_employees($db, api_query_id('jobId'), api_query_id('unitId'), api_query_id('employeeId'), ($_GET['inactive'] ?? '') === '1');
    $rows = [];
    $overall = ['employees' => 0, 'daysWorked' => 0, 'absences' => 0, 'lateDays' => 0, 'lateMinutes' => 0, 'overtimeMinutes' => 0,
        'workedMinutes' => 0, 'breakMinutes' => 0, 'expectedMinutes' => 0, 'incompleteDays' => 0];
    foreach ($employees as $row) {
        $journey = reobote_journey($db, $row, $from, $to);
        $totals = $journey['totals'];
        $expectedDays = count(array_filter($journey['days'], static fn ($d) => $d['workday'] && in_array($d['status'], ['worked', 'in_progress', 'absent'], true)));
        $attendedScheduled = count(array_filter($journey['days'], static fn ($d) => $d['workday'] && in_array($d['status'], ['worked', 'in_progress'], true)));
        $rows[] = [
            'employee' => reobote_employee_public($db, $row),
            'totals' => $totals,
            'scheduledDays' => $expectedDays,
            'attendanceRate' => $expectedDays > 0 ? round($attendedScheduled * 100 / $expectedDays, 1) : null,
        ];
        $overall['employees']++;
        foreach ($totals as $key => $value) {
            $overall[$key] += $value;
        }
    }
    $scheduled = array_sum(array_column($rows, 'scheduledDays'));
    $overall['attendanceRate'] = $scheduled > 0 ? round(($scheduled - $overall['absences']) * 100 / $scheduled, 1) : null;
    $settings = reobote_settings();
    reobote_json(['from' => $from, 'to' => $to, 'rows' => $rows, 'overall' => $overall,
        'company' => $settings['company_name'], 'generatedAt' => gmdate('Y-m-d\TH:i:s\Z'), 'generatedBy' => $user['name']]);
});

// Configuracoes e auditoria -------------------------------------------------------------------

route('GET', '/api/settings', static function (PDO $db): void {
    reobote_require(reobote_user(), 'settings');
    $settings = reobote_settings(true);
    reobote_json(['settings' => [
        'companyName' => $settings['company_name'],
        'companyEmail' => $settings['company_email'],
        'companyPhone' => $settings['company_phone'],
        'emailDomain' => $settings['email_domain'],
        'requireEmailDomain' => $settings['require_email_domain'] === '1',
        'timezone' => $settings['timezone'],
        'offlineMaxDays' => (int) $settings['offline_max_days'],
        'requestGpsOnCheckin' => $settings['request_gps_on_checkin'] === '1',
        'shiftGapHours' => (int) $settings['shift_gap_hours'],
        'absenceAfterMinutes' => (int) $settings['absence_after_minutes'],
        'lateAbsenceHours' => (int) $settings['late_absence_hours'],
        'apkDownloadUrl' => $settings['apk_download_url'],
    ]]);
});

// Salva as configurações enviadas (somente os campos presentes) e registra na auditoria.
route('PUT', '/api/settings', static function (PDO $db): void {
    $user = reobote_user();
    reobote_require($user, 'settings');
    $body = reobote_body();
    $values = [];
    if (array_key_exists('companyName', $body)) {
        $values['company_name'] = reobote_str($body, 'companyName', 120, true, 'Nome da central');
    }
    if (array_key_exists('companyEmail', $body)) {
        $email = reobote_str($body, 'companyEmail', 190, false, 'E-mail de contato') ?? '';
        if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            reobote_fail('Informe um e-mail de contato válido.');
        }
        $values['company_email'] = $email;
    }
    if (array_key_exists('companyPhone', $body)) {
        $values['company_phone'] = reobote_str($body, 'companyPhone', 32, false, 'Telefone') ?? '';
    }
    if (array_key_exists('emailDomain', $body)) {
        $domain = mb_strtolower(ltrim((string) reobote_str($body, 'emailDomain', 120, false, 'Domínio'), '@'));
        if ($domain !== '' && !preg_match('/^[a-z0-9-]+(\.[a-z0-9-]+)+$/', $domain)) {
            reobote_fail('Informe um domínio válido, por exemplo reobote.com.');
        }
        $values['email_domain'] = $domain;
    }
    if (array_key_exists('requireEmailDomain', $body)) {
        $values['require_email_domain'] = reobote_bool($body, 'requireEmailDomain') ? '1' : '0';
    }
    if (array_key_exists('timezone', $body)) {
        $timezone = (string) $body['timezone'];
        if (!in_array($timezone, DateTimeZone::listIdentifiers(DateTimeZone::AMERICA), true)) {
            reobote_fail('Fuso horário inválido.');
        }
        $values['timezone'] = $timezone;
    }
    if (array_key_exists('offlineMaxDays', $body)) {
        $values['offline_max_days'] = (string) reobote_int($body, 'offlineMaxDays', 1, 30, 7, 'Prazo de sincronização');
    }
    if (array_key_exists('requestGpsOnCheckin', $body)) {
        $values['request_gps_on_checkin'] = reobote_bool($body, 'requestGpsOnCheckin') ? '1' : '0';
    }
    if (array_key_exists('absenceAfterMinutes', $body)) {
        // Minutos sem registro apos o inicio previsto para contar falta (de 16 min a 8 h).
        $values['absence_after_minutes'] = (string) reobote_int($body, 'absenceAfterMinutes', 16, 480, 60, 'Falta após');
    }
    if (array_key_exists('lateAbsenceHours', $body)) {
        // Horas de atraso para o dia contar como falta (de 1 h a 12 h).
        $values['late_absence_hours'] = (string) reobote_int($body, 'lateAbsenceHours', 1, 12, 5, 'Atraso que conta falta');
    }
    if (array_key_exists('shiftGapHours', $body)) {
        $values['shift_gap_hours'] = (string) reobote_int($body, 'shiftGapHours', 4, 24, 16, 'Intervalo entre turnos');
    }
    if (array_key_exists('apkDownloadUrl', $body)) {
        // Aceita apenas um endereço https:// (ex.: Releases do GitHub) ou vazio para usar /downloads/reobote.apk.
        $apkUrl = reobote_str($body, 'apkDownloadUrl', 500, false, 'Link do APK') ?? '';
        if ($apkUrl !== '' && !preg_match('#^https://[^\s]+$#i', $apkUrl)) {
            reobote_fail('O link do APK deve começar com https://.');
        }
        $values['apk_download_url'] = $apkUrl;
    }
    $query = $db->prepare('INSERT INTO settings (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)');
    foreach ($values as $name => $value) {
        $query->execute([$name, $value]);
    }
    reobote_audit($db, $user, 'settings_updated', 'settings', null, $values);
    reobote_json(['saved' => true]);
});

const API_AUDIT_LABELS = [
    'employee_created' => 'Colaborador cadastrado', 'employee_updated' => 'Cadastro alterado', 'employee_deactivated' => 'Cadastro desativado',
    'employee_reactivated' => 'Cadastro reativado', 'password_reset' => 'Senha temporária gerada', 'password_changed' => 'Senha alterada',
    'photo_updated' => 'Foto atualizada', 'photo_removed' => 'Foto removida', 'attendance_added' => 'Registro lançado manualmente',
    'attendance_voided' => 'Registro anulado', 'job_created' => 'Cargo criado', 'job_updated' => 'Cargo alterado', 'job_deleted' => 'Cargo excluído',
    'schedule_created' => 'Jornada criada', 'schedule_updated' => 'Jornada alterada', 'schedule_deleted' => 'Jornada excluída',
    'holiday_saved' => 'Feriado salvo', 'holiday_deleted' => 'Feriado excluído', 'unit_created' => 'Unidade criada', 'unit_updated' => 'Unidade alterada',
    'unit_deleted' => 'Unidade excluída', 'qr_created' => 'QR Code criado', 'qr_updated' => 'QR Code alterado', 'qr_deactivated' => 'QR Code desativado',
    'qr_regenerated' => 'QR Code substituído', 'settings_updated' => 'Configurações alteradas',
    'location_consent_given' => 'Localização autorizada', 'fake_gps_detected' => 'GPS falso detectado', 'app_diagnostic' => 'Diagnóstico do aplicativo', 'absence_justified' => 'Falta/atraso justificado', 'justification_attachment' => 'Atestado anexado', 'employee_deleted' => 'Colaborador excluído', 'qr_deleted' => 'QR Code excluído', 'absence_justification_removed' => 'Justificativa removida', 'location_consent_revoked' => 'Localização revogada', 'release_denied' => 'Registro não liberado (falta mantida)',
];

// Histórico de alterações administrativas (quem fez, o quê e quando).
route('GET', '/api/audit', static function (PDO $db): void {
    reobote_require(reobote_user(), 'settings');
    $limit = max(1, min(300, (int) ($_GET['limit'] ?? 100)));
    $query = $db->query(
        'SELECT a.id, a.action, a.entity, a.entity_id, a.details, a.created_at, COALESCE(e.name, u.email) AS author
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN employees e ON e.id = u.employee_id
         ORDER BY a.id DESC LIMIT ' . $limit
    );
    reobote_json(['entries' => array_map(static fn ($row) => [
        'id' => (string) $row['id'],
        'action' => $row['action'],
        'label' => API_AUDIT_LABELS[$row['action']] ?? $row['action'],
        'entity' => $row['entity'],
        'entityId' => $row['entity_id'],
        'details' => $row['details'] ? json_decode((string) $row['details'], true) : null,
        'author' => $row['author'] ?? 'Sistema',
        'createdAt' => reobote_iso($row['created_at']),
    ], $query->fetchAll())]);
});
