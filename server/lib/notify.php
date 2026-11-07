<?php
declare(strict_types=1);

// Notificacoes para a Central e historico de alteracoes administrativas (auditoria).

const REOBOTE_NOTIFICATION_ICONS = [
    'vehicle_checkin' => 'fa-van-shuttle',
    'unit_checkin' => 'fa-hospital',
    'arrival' => 'fa-right-to-bracket',
    'break_start' => 'fa-utensils',
    'break_end' => 'fa-mug-hot',
    'departure' => 'fa-flag-checkered',
    'late' => 'fa-clock',
    'absence' => 'fa-user-xmark',
    'overtime' => 'fa-business-time',
    'access_request' => 'fa-key',
    'out_of_range' => 'fa-location-crosshairs',
    'system' => 'fa-bell',
];

// Cria uma notificacao; a chave de deduplicacao impede avisos repetidos para o mesmo fato.
function reobote_notify(PDO $db, string $type, string $title, ?string $detail = null, ?string $employeeId = null, ?string $eventId = null, ?string $dedupeKey = null): void
{
    $query = $db->prepare(
        'INSERT IGNORE INTO notifications (type, title, detail, employee_id, event_id, dedupe_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())'
    );
    $query->execute([$type, mb_substr($title, 0, 200), $detail === null ? null : mb_substr($detail, 0, 500), $employeeId, $eventId, $dedupeKey]);
}

// Registra alteracoes administrativas com autor, entidade e detalhes.
function reobote_audit(PDO $db, ?array $user, string $action, string $entity, ?string $entityId = null, array $details = []): void
{
    $query = $db->prepare(
        'INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())'
    );
    $query->execute([
        $user['id'] ?? null,
        $action,
        $entity,
        $entityId,
        $details ? json_encode($details, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null,
        reobote_hash_ip(),
    ]);
}

// Horário (HH:MM) no fuso da empresa, usado nos textos das notificações.
function reobote_local_time(DateTimeImmutable $at): string
{
    return $at->setTimezone(reobote_timezone())->format('H:i');
}

// Duração legível: 35 -> "35 min", 125 -> "2h05".
function reobote_duration_text(int $minutes): string
{
    $hours = intdiv($minutes, 60);
    $rest = $minutes % 60;
    return $hours > 0 ? sprintf('%dh%02d', $hours, $rest) : sprintf('%d min', $rest);
}

// Gera as notificacoes de um registro recebido do aplicativo ou lancado pela Central.
function reobote_notify_event(PDO $db, array $employee, array $event, ?array $journeyDay = null): void
{
    $name = (string) $employee['name'];
    $time = reobote_local_time($event['at']);
    $place = $event['unitName'] ?? $event['qrLabel'] ?? null;
    $titles = [
        'vehicle_checkin' => "$name chegou ao veículo" . ($place ? " $place" : ''),
        'unit_checkin' => "$name chegou à unidade" . ($place ? " $place" : ''),
        'arrival' => "$name registrou entrada",
        'break_start' => "$name iniciou o almoço",
        'break_end' => "$name retornou do almoço",
        'departure' => "$name encerrou a jornada",
    ];
    $detail = trim(($employee['job_name'] ?? '') . ' • registro às ' . $time, ' •');
    if ($event['source'] === 'admin') {
        $detail .= ' (lançado pela Central)';
    }
    reobote_notify($db, $event['type'], $titles[$event['type']] ?? "$name fez um registro", $detail, (string) $employee['id'], $event['id'], 'event:' . $event['id']);

    if ($event['distanceM'] !== null && isset($event['unitRadius']) && $event['distanceM'] > $event['unitRadius']) {
        reobote_notify($db, 'out_of_range', "$name registrou fora do raio da unidade",
            sprintf('%s • distância aproximada de %d m', $place ?? 'Unidade', $event['distanceM']), (string) $employee['id'], $event['id'], 'range:' . $event['id']);
    }

    if ($journeyDay === null) {
        return;
    }
    if (in_array($event['type'], REOBOTE_START_TYPES, true) && $journeyDay['lateMinutes'] > 0) {
        reobote_notify($db, 'late', "$name chegou com atraso",
            'Atraso de ' . reobote_duration_text($journeyDay['lateMinutes']) . ' em relação à escala', (string) $employee['id'], $event['id'],
            'late:' . $employee['id'] . ':' . $journeyDay['date']);
    }
    if ($event['type'] === 'departure' && $journeyDay['overtimeMinutes'] > 0) {
        reobote_notify($db, 'overtime', "$name registrou horas extras",
            reobote_duration_text($journeyDay['overtimeMinutes']) . ' além da jornada prevista', (string) $employee['id'], $event['id'],
            'overtime:' . $employee['id'] . ':' . $journeyDay['date']);
    }
}

// Verifica periodicamente quem nao iniciou a jornada apos a tolerancia e gera avisos de ausencia.
function reobote_sweep_absences(PDO $db): void
{
    $row =$db->query("SELECT value FROM settings WHERE name = 'last_absence_sweep'")->fetch();
    $lastSweep = $row ? (int) $row['value'] : 0;
    if (time() - $lastSweep < 120) {
        return;
    }
    $db->prepare("INSERT INTO settings (name, value) VALUES ('last_absence_sweep', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)")
        ->execute([(string) time()]);

    $tz = reobote_timezone();
    $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $today = $now->setTimezone($tz)->format('Y-m-d');
    $employees = $db->query(
        'SELECT e.id, e.name, e.schedule_id, e.created_at, j.default_schedule_id AS job_schedule_id, j.name AS job_name
         FROM employees e LEFT JOIN jobs j ON j.id = e.job_id WHERE e.active = 1'
    )->fetchAll();
    $holidays = reobote_load_holidays($db, $today, $today);
    $states = reobote_current_states($db, array_column($employees, 'id'), $now);
    foreach ($employees as $employee) {
        $schedule = reobote_employee_schedule($db, $employee);
        if ($schedule === null || isset($holidays[$today]) || !reobote_schedule_is_workday($schedule, $today)) {
            continue;
        }
        $expectedStart = new DateTimeImmutable($today . ' ' . substr((string) $schedule['start_time'], 0, 5) . ':00', $tz);
        $limit = $expectedStart->getTimestamp() + (int) $schedule['tolerance_minutes'] * 60;
        $state = $states[(string) $employee['id']] ?? null;
        $startedToday = $state !== null && $state['shift'] !== null
            && $state['shift']['start']->setTimezone($tz)->format('Y-m-d') === $today;
        if ($now->getTimestamp() > $limit && !$startedToday && $state !== null && $state['state'] === 'waiting') {
            reobote_notify($db, 'absence', $employee['name'] . ' ainda não iniciou a jornada',
                'Escala prevista para ' . substr((string) $schedule['start_time'], 0, 5) . ' com tolerância de ' . (int) $schedule['tolerance_minutes'] . ' min',
                (string) $employee['id'], null, 'absence:' . $employee['id'] . ':' . $today);
        }
    }
}
