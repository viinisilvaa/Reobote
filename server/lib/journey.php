<?php
// REOBOTE | server/lib/journey.php — Servidor: motor de jornada (turnos, atrasos, extras e faltas)
declare(strict_types=1);

// Motor de jornada: agrupa registros em turnos, compara com a escala e calcula atrasos, faltas e horas extras.
// Todos os calculos ficam no servidor para que o aplicativo, o painel e os relatorios mostrem os mesmos numeros.

const REOBOTE_EVENT_TYPES = [
    'vehicle_checkin' => 'Chegada ao veículo',
    'unit_checkin' => 'Chegada à unidade',
    'arrival' => 'Entrada',
    'break_start' => 'Início do almoço',
    'break_end' => 'Retorno do almoço',
    'departure' => 'Encerramento da jornada',
];

const REOBOTE_START_TYPES = ['arrival', 'vehicle_checkin', 'unit_checkin'];

const REOBOTE_STATES = [
    'waiting' => 'Aguardando início',
    'in_transit' => 'Em deslocamento',
    'working' => 'Em atendimento',
    'on_break' => 'Em almoço',
    'finished' => 'Jornada finalizada',
];

// Minutos inteiros entre dois horários (nunca negativo).
function reobote_minutes(DateTimeImmutable $start, DateTimeImmutable $end): int
{
    return max(0, intdiv($end->getTimestamp() - $start->getTimestamp(), 60));
}

// Tempo sem registros após o qual um turno sem encerramento é fechado (Configurações; entre 4 e 24 horas).
function reobote_gap_seconds(): int
{
    return max(4, min(24, (int) reobote_settings()['shift_gap_hours'])) * 3600;
}

// Converte uma linha de attendance_events no formato usado pelo motor.
function reobote_event_from_row(array $row): array
{
    return [
        'id' => (string) $row['id'],
        'type' => (string) $row['event_type'],
        'at' => new DateTimeImmutable((string) $row['occurred_at'], new DateTimeZone('UTC')),
        'unitId' => isset($row['unit_id']) && $row['unit_id'] !== null ? (string) $row['unit_id'] : null,
        'unitName' => $row['unit_name'] ?? null,
        'qrCodeId' => isset($row['qr_code_id']) && $row['qr_code_id'] !== null ? (string) $row['qr_code_id'] : null,
        'qrLabel' => $row['qr_label'] ?? null,
        'source' => $row['source'] ?? 'mobile',
        'notes' => $row['notes'] ?? null,
        'distanceM' => isset($row['distance_m']) && $row['distance_m'] !== null ? (int) $row['distance_m'] : null,
        'receivedAt' => $row['received_at'] ?? null,
    ];
}

// Formato publico de um registro para a API.
function reobote_event_public(array $event): array
{
    $delayed = false;
    if (!empty($event['receivedAt'])) {
        $received = new DateTimeImmutable((string) $event['receivedAt'], new DateTimeZone('UTC'));
        $delayed = $received->getTimestamp() - $event['at']->getTimestamp() > 600;
    }
    return [
        'id' => $event['id'],
        'eventType' => $event['type'],
        'label' => REOBOTE_EVENT_TYPES[$event['type']] ?? 'Registro',
        'occurredAt' => $event['at']->format('Y-m-d\TH:i:s\Z'),
        'unitId' => $event['unitId'],
        'place' => $event['unitName'] ?? $event['qrLabel'],
        'source' => $event['source'],
        'notes' => $event['notes'],
        'distanceM' => $event['distanceM'],
        'syncedLater' => $delayed,
    ];
}

// Carrega registros validos (nao anulados) de um colaborador, com nomes de unidade e QR Code.
function reobote_load_events(PDO $db, string $employeeId, ?string $fromUtc = null, ?string $toUtc = null, int $limit = 5000): array
{
    $sql = 'SELECT a.id, a.event_type, a.occurred_at, a.received_at, a.unit_id, a.qr_code_id, a.source, a.notes, a.distance_m,
                   u.name AS unit_name, q.label AS qr_label
            FROM attendance_events a
            LEFT JOIN units u ON u.id = a.unit_id
            LEFT JOIN qr_codes q ON q.id = a.qr_code_id
            WHERE a.employee_id = ? AND a.voided_at IS NULL';
    $params = [$employeeId];
    if ($fromUtc !== null) {
        $sql .= ' AND a.occurred_at >= ?';
        $params[] = $fromUtc;
    }
    if ($toUtc !== null) {
        $sql .= ' AND a.occurred_at < ?';
        $params[] = $toUtc;
    }
    $sql .= ' ORDER BY a.occurred_at, a.id LIMIT ' . max(1, $limit);
    $query = $db->prepare($sql);
    $query->execute($params);
    return array_map('reobote_event_from_row', $query->fetchAll());
}

// Agrupa registros em turnos. Um turno comeca em uma leitura de inicio e termina no encerramento.
function reobote_build_shifts(array $events, DateTimeImmutable $now): array
{
    $gap = reobote_gap_seconds();
    $shifts = [];
    $open = null;
    $close = static function (?array &$shift, bool $complete) use (&$shifts): void {
        if ($shift === null) {
            return;
        }
        $shift['closed'] = true;
        if (!$complete) {
            $shift['flags'][] = 'missing_departure';
        }
        $shifts[] = $shift;
        $shift = null;
    };

    foreach ($events as $event) {
        if ($open !== null) {
            $last = end($open['events']);
            if ($event['at']->getTimestamp() - $last['at']->getTimestamp() > $gap) {
                $close($open, false);
            }
        }
        if ($open === null) {
            $open = ['events' => [], 'flags' => [], 'closed' => false];
            if (!in_array($event['type'], REOBOTE_START_TYPES, true)) {
                $open['flags'][] = 'missing_start';
            }
        }
        $open['events'][] = $event;
        if ($event['type'] === 'departure') {
            $close($open, true);
        }
    }
    if ($open !== null) {
        $last = end($open['events']);
        if ($now->getTimestamp() - $last['at']->getTimestamp() > $gap) {
            $close($open, false);
        } else {
            $shifts[] = $open;
        }
    }

    return array_map(static fn (array $shift) => reobote_shift_metrics($shift, $now), $shifts);
}

// Calcula os números de um turno: início, fim, minutos de almoço e minutos trabalhados (descontando o almoço).
function reobote_shift_metrics(array $shift, DateTimeImmutable $now): array
{
    $events = $shift['events'];
    $start = $events[0]['at'];
    $last = end($events);
    $ongoing = !$shift['closed'];
    $end = $last['type'] === 'departure' ? $last['at'] : ($ongoing ? $now : $last['at']);

    $breakMinutes = 0;
    $breakOpen = null;
    foreach ($events as $event) {
        if ($event['type'] === 'break_start' && $breakOpen === null) {
            $breakOpen = $event['at'];
        } elseif ($event['type'] === 'break_end' && $breakOpen !== null) {
            $breakMinutes += reobote_minutes($breakOpen, $event['at']);
            $breakOpen = null;
        }
    }
    if ($breakOpen !== null) {
        $breakMinutes += reobote_minutes($breakOpen, $end);
        if (!$ongoing) {
            $shift['flags'][] = 'open_break';
        }
    }

    $unitArrival = null;
    foreach ($events as $event) {
        if ($event['type'] === 'unit_checkin' || $event['type'] === 'arrival') {
            $unitArrival = $event;
            break;
        }
    }

    return [
        'start' => $start,
        'end' => $last['type'] === 'departure' ? $last['at'] : null,
        'ongoing' => $ongoing,
        'events' => $events,
        'flags' => array_values(array_unique($shift['flags'])),
        'breakMinutes' => $breakMinutes,
        'workedMinutes' => max(0, reobote_minutes($start, $end) - $breakMinutes),
        'unitArrival' => $unitArrival,
        'lastEvent' => $last,
    ];
}

// Escalas e feriados ---------------------------------------------------------------------------

function reobote_load_schedules(PDO $db): array
{
    static $schedules;
    if ($schedules === null) {
        $schedules = [];
        foreach ($db->query('SELECT * FROM schedules') as $row) {
            $schedules[(string) $row['id']] = $row;
        }
    }
    return $schedules;
}

// Feriados cadastrados no intervalo, no formato [data => nome].
function reobote_load_holidays(PDO $db, string $from, string $to): array
{
    $query = $db->prepare('SELECT holiday_date, name FROM holidays WHERE holiday_date BETWEEN ? AND ?');
    $query->execute([$from, $to]);
    $holidays = [];
    foreach ($query->fetchAll() as $row) {
        $holidays[(string) $row['holiday_date']] = $row['name'];
    }
    return $holidays;
}

// Escala efetiva do colaborador: a escala individual tem prioridade sobre a escala padrao do cargo.
function reobote_employee_schedule(PDO $db, array $employee): ?array
{
    $schedules = reobote_load_schedules($db);
    $id = ($employee['schedule_id'] ?? null) ?: ($employee['job_schedule_id'] ?? null);
    return $id !== null && isset($schedules[(string) $id]) ? $schedules[(string) $id] : null;
}

// Minutos previstos por dia na jornada: saída - entrada (turnos noturnos atravessam a meia-noite) - almoço.
function reobote_schedule_expected_minutes(array $schedule): int
{
    [$sh, $sm] = array_map('intval', explode(':', substr((string) $schedule['start_time'], 0, 5)));
    [$eh, $em] = array_map('intval', explode(':', substr((string) $schedule['end_time'], 0, 5)));
    $duration = ($eh * 60 + $em) - ($sh * 60 + $sm);
    if ($duration <= 0) {
        $duration += 1440; // Turno que atravessa a meia-noite.
    }
    return max(0, $duration - (int) $schedule['break_minutes']);
}

// Indica se a data é dia de trabalho na jornada: dias da semana marcados, ou posição no ciclo (ex.: 12x36 alterna trabalho e folga).
function reobote_schedule_is_workday(array $schedule, string $date): bool
{
    $day = new DateTimeImmutable($date);
    if ($schedule['mode'] === 'cycle') {
        $anchor = new DateTimeImmutable((string) ($schedule['cycle_anchor'] ?: $date));
        $work = max(1, (int) $schedule['cycle_work_days']);
        $off = max(0, (int) $schedule['cycle_off_days']);
        $diff = (int) $anchor->diff($day)->format('%r%a');
        $position = (($diff % ($work + $off)) + ($work + $off)) % ($work + $off);
        return $position < $work;
    }
    return str_contains((string) $schedule['work_days'], $day->format('N'));
}

// Formato da jornada enviado ao navegador e ao aplicativo.
function reobote_schedule_public(?array $schedule): ?array
{
    if ($schedule === null) {
        return null;
    }
    return [
        'id' => (string) $schedule['id'],
        'name' => $schedule['name'],
        'start' => substr((string) $schedule['start_time'], 0, 5),
        'end' => substr((string) $schedule['end_time'], 0, 5),
        'breakMinutes' => (int) $schedule['break_minutes'],
        'toleranceMinutes' => (int) $schedule['tolerance_minutes'],
        'mode' => $schedule['mode'],
        'workDays' => (string) $schedule['work_days'],
        'cycleWorkDays' => (int) $schedule['cycle_work_days'],
        'cycleOffDays' => (int) $schedule['cycle_off_days'],
        'cycleAnchor' => $schedule['cycle_anchor'],
        'offDayOvertime' => (bool) $schedule['off_day_overtime'],
        'expectedMinutes' => reobote_schedule_expected_minutes($schedule),
        'description' => reobote_schedule_description($schedule),
    ];
}

// Descrição curta da jornada, por exemplo "08:00 às 18:00, Seg, Ter, Qua, Qui, Sex".
function reobote_schedule_description(array $schedule): string
{
    $hours = substr((string) $schedule['start_time'], 0, 5) . ' às ' . substr((string) $schedule['end_time'], 0, 5);
    if ($schedule['mode'] === 'cycle') {
        return sprintf('%s, escala %d por %d dia(s)', $hours, (int) $schedule['cycle_work_days'], (int) $schedule['cycle_off_days']);
    }
    $names = ['1' => 'Seg', '2' => 'Ter', '3' => 'Qua', '4' => 'Qui', '5' => 'Sex', '6' => 'Sáb', '7' => 'Dom'];
    $days = array_map(static fn ($d) => $names[$d] ?? '', str_split((string) $schedule['work_days']));
    return $hours . ', ' . implode(', ', array_filter($days));
}

// Calculo diario ------------------------------------------------------------------------------

// Calcula cada dia do intervalo para um colaborador, incluindo faltas e dias sem registro.
function reobote_journey(PDO $db, array $employee, string $from, string $to, ?DateTimeImmutable $now = null): array
{
    $tz = reobote_timezone();
    $now ??= new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $today = $now->setTimezone($tz)->format('Y-m-d');
    $schedule = reobote_employee_schedule($db, $employee);
    $holidays = reobote_load_holidays($db, $from, $to);

    // Busca com folga de um dia para incluir turnos noturnos que atravessam o limite do intervalo.
    $fromUtc = (new DateTimeImmutable("$from 00:00:00", $tz))->modify('-1 day')->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
    $toUtc = (new DateTimeImmutable("$to 00:00:00", $tz))->modify('+2 days')->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
    $events = reobote_load_events($db, (string) $employee['id'], $fromUtc, $toUtc);
    $shifts = reobote_build_shifts($events, $now);
    // Justificativas lancadas pela Central e limite (em minutos) para o dia sem registro virar falta.
    $justifications = reobote_load_justifications($db, (string) $employee['id'], $from, $to);
    $absenceAfter = max(16, (int) (reobote_settings()['absence_after_minutes'] ?? 60));

    $byDate = [];
    foreach ($shifts as $shift) {
        $byDate[$shift['start']->setTimezone($tz)->format('Y-m-d')][] = $shift;
    }

    $hiredOn = isset($employee['created_at'])
        ? (new DateTimeImmutable((string) $employee['created_at'], new DateTimeZone('UTC')))->setTimezone($tz)->format('Y-m-d')
        : $from;

    $days = [];
    $totals = [
        'daysWorked' => 0, 'absences' => 0, 'lateDays' => 0, 'lateMinutes' => 0, 'overtimeMinutes' => 0,
        'workedMinutes' => 0, 'breakMinutes' => 0, 'expectedMinutes' => 0, 'incompleteDays' => 0,
    ];

    for ($cursor = new DateTimeImmutable($from); $cursor->format('Y-m-d') <= $to; $cursor = $cursor->modify('+1 day')) {
        $date = $cursor->format('Y-m-d');
        $dayShifts = $byDate[$date] ?? [];
        if ($date < $hiredOn && !$dayShifts) {
            continue;
        }
        $holiday = $holidays[$date] ?? null;
        $workday = $schedule !== null && $holiday === null && reobote_schedule_is_workday($schedule, $date);
        $expected = $workday ? reobote_schedule_expected_minutes($schedule) : 0;
        $tolerance = $schedule !== null ? (int) $schedule['tolerance_minutes'] : 0;
        $expectedStart = $schedule !== null ? new DateTimeImmutable($date . ' ' . substr((string) $schedule['start_time'], 0, 5) . ':00', $tz) : null;

        $worked = array_sum(array_column($dayShifts, 'workedMinutes'));
        $breaks = array_sum(array_column($dayShifts, 'breakMinutes'));
        $late = 0;
        $overtime = 0;
        $status = 'off';
        $flags = [];
        foreach ($dayShifts as $shift) {
            $flags = array_merge($flags, $shift['flags']);
        }

        if ($dayShifts) {
            $ongoing = (bool) array_filter($dayShifts, static fn ($s) => $s['ongoing']);
            $status = $ongoing ? 'in_progress' : 'worked';
            if ($workday && $expectedStart !== null) {
                $delay = reobote_minutes($expectedStart, $dayShifts[0]['start']);
                $late = $delay > $tolerance ? $delay : 0;
                $extra = $worked - $expected;
                $overtime = !$ongoing && $extra > $tolerance ? $extra : 0;
            } elseif ($schedule === null || (int) $schedule['off_day_overtime'] === 1) {
                $overtime = $ongoing ? 0 : $worked;
            }
        } elseif ($holiday !== null) {
            $status = 'holiday';
        } elseif ($workday) {
            $minutesLate = $expectedStart !== null ? ($now->getTimestamp() - $expectedStart->getTimestamp()) / 60 : 0;
            if (isset($justifications[$date]) && ($date < $today || $minutesLate > $tolerance)) {
                $status = 'justified'; // falta justificada pela Central: nao conta como falta
            } elseif ($date < $today) {
                $status = 'absent';
            } elseif ($date === $today && $expectedStart !== null && $minutesLate > $absenceAfter) {
                $status = 'absent'; // passou do limite (1 h por padrao) sem registro: falta ja no proprio dia
            } elseif ($date === $today && $expectedStart !== null && $minutesLate > $tolerance) {
                $status = 'not_arrived';
            } else {
                $status = 'scheduled';
            }
        }

        if ($date <= $today && $workday) {
            $totals['expectedMinutes'] += $expected;
        }
        if ($dayShifts) {
            $totals['daysWorked']++;
        }
        if ($status === 'absent') {
            $totals['absences']++;
        }
        if ($late > 0) {
            $totals['lateDays']++;
        }
        if (in_array('missing_departure', $flags, true) || in_array('missing_start', $flags, true)) {
            $totals['incompleteDays']++;
        }
        $totals['lateMinutes'] += $late;
        $totals['overtimeMinutes'] += $overtime;
        $totals['workedMinutes'] += $worked;
        $totals['breakMinutes'] += $breaks;

        $days[] = [
            'date' => $date,
            'status' => $status,
            'workday' => $workday,
            'holiday' => $holiday,
            'expectedMinutes' => $expected,
            'workedMinutes' => $worked,
            'breakMinutes' => $breaks,
            'lateMinutes' => $late,
            'overtimeMinutes' => $overtime,
            'flags' => array_values(array_unique($flags)),
            'justification' => $justifications[$date] ?? null, // { reason, author, createdAt } quando a Central justificou
            'firstRecord' => $dayShifts ? $dayShifts[0]['start']->format('Y-m-d\TH:i:s\Z') : null,
            'lastRecord' => $dayShifts ? end($dayShifts)['lastEvent']['at']->format('Y-m-d\TH:i:s\Z') : null,
            'events' => array_map('reobote_event_public', array_merge(...array_map(static fn ($s) => $s['events'], $dayShifts ?: [['events' => []]]))),
        ];
    }

    return ['schedule' => reobote_schedule_public($schedule), 'days' => array_reverse($days), 'totals' => $totals];
}

// Justificativas de falta/atraso lancadas pela Central, por dia (AAAA-MM-DD).
function reobote_load_justifications(PDO $db, string $employeeId, string $from, string $to): array
{
    $query = $db->prepare(
        'SELECT j.day, j.reason, j.created_at, e.name AS author FROM attendance_justifications j
         LEFT JOIN users u ON u.id = j.created_by_user_id LEFT JOIN employees e ON e.id = u.employee_id
         WHERE j.employee_id = ? AND j.day BETWEEN ? AND ?'
    );
    $query->execute([$employeeId, $from, $to]);
    $list = [];
    foreach ($query->fetchAll() as $row) {
        $list[$row['day']] = ['reason' => $row['reason'], 'author' => $row['author'], 'createdAt' => reobote_iso($row['created_at'])];
    }
    return $list;
}

// Bloqueio por falta: o primeiro registro do dia feito pelo aplicativo depois do limite (1 h por padrao)
// apos o inicio previsto e recusado, a menos que a Central tenha justificado o dia. Retorna a mensagem
// para o tecnico, ou null quando o registro e permitido.
function reobote_absence_block(PDO $db, array $employee, DateTimeImmutable $at): ?string
{
    $tz = reobote_timezone();
    $local = $at->setTimezone($tz);
    $date = $local->format('Y-m-d');
    $schedule = reobote_employee_schedule($db, $employee);
    if ($schedule === null || !reobote_schedule_is_workday($schedule, $date) || isset(reobote_load_holidays($db, $date, $date)[$date])) {
        return null;
    }
    $start = new DateTimeImmutable($date . ' ' . substr((string) $schedule['start_time'], 0, 5) . ':00', $tz);
    $limit = max(16, (int) (reobote_settings()['absence_after_minutes'] ?? 60));
    if ($at->getTimestamp() <= $start->getTimestamp() + $limit * 60) {
        return null;
    }
    // Ja registrou algo hoje (jornada em andamento ou retomada): nao bloqueia.
    $dayStart = (new DateTimeImmutable($date . ' 00:00:00', $tz))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
    $query = $db->prepare('SELECT COUNT(*) FROM attendance_events WHERE employee_id = ? AND voided_at IS NULL AND occurred_at >= ? AND occurred_at < ?');
    $query->execute([$employee['id'], $dayStart, $at->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s')]);
    if ((int) $query->fetchColumn() > 0 || reobote_load_justifications($db, (string) $employee['id'], $date, $date)) {
        return null;
    }
    $hours = intdiv($limit, 60) > 0 ? (intdiv($limit, 60) . ' h' . ($limit % 60 ? ' ' . ($limit % 60) . ' min' : '')) : $limit . ' min';
    return "Mais de $hours de atraso (início previsto às " . $start->format('H:i') . "): o dia foi registrado como falta. Avise a Central pelo WhatsApp para justificar e liberar o registro.";
}

// Situacao atual --------------------------------------------------------------------------------

// Determina a situacao do colaborador a partir dos registros recentes.
function reobote_state_from_events(array $events, DateTimeImmutable $now): array
{
    $tz = reobote_timezone();
    $shifts = reobote_build_shifts($events, $now);
    $last = $shifts ? end($shifts) : null;
    $state = 'waiting';
    if ($last !== null && $last['ongoing']) {
        $type = $last['lastEvent']['type'];
        $state = $type === 'break_start' ? 'on_break' : ($type === 'vehicle_checkin' ? 'in_transit' : 'working');
    } elseif ($last !== null && $last['end'] !== null
        && $last['start']->setTimezone($tz)->format('Y-m-d') === $now->setTimezone($tz)->format('Y-m-d')) {
        $state = 'finished';
    }
    $lastEvent = $events ? end($events) : null;
    return [
        'state' => $state,
        'stateLabel' => REOBOTE_STATES[$state],
        'shift' => $last !== null && ($last['ongoing'] || $state === 'finished') ? $last : null,
        'lastEvent' => $lastEvent,
    ];
}

// Situacao atual de varios colaboradores em uma unica consulta.
function reobote_current_states(PDO $db, array $employeeIds, ?DateTimeImmutable $now = null): array
{
    $now ??= new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $result = [];
    if (!$employeeIds) {
        return $result;
    }
    $placeholders = implode(',', array_fill(0, count($employeeIds), '?'));
    $since = $now->modify('-36 hours')->format('Y-m-d H:i:s');
    $query = $db->prepare(
        "SELECT a.id, a.employee_id, a.event_type, a.occurred_at, a.received_at, a.unit_id, a.qr_code_id, a.source, a.notes, a.distance_m,
                u.name AS unit_name, q.label AS qr_label
         FROM attendance_events a
         LEFT JOIN units u ON u.id = a.unit_id
         LEFT JOIN qr_codes q ON q.id = a.qr_code_id
         WHERE a.employee_id IN ($placeholders) AND a.voided_at IS NULL AND a.occurred_at >= ? AND a.occurred_at <= ?
         ORDER BY a.occurred_at, a.id"
    );
    $query->execute([...array_map('strval', $employeeIds), $since, $now->modify('+5 minutes')->format('Y-m-d H:i:s')]);
    $grouped = [];
    foreach ($query->fetchAll() as $row) {
        $grouped[(string) $row['employee_id']][] = reobote_event_from_row($row);
    }
    foreach ($employeeIds as $id) {
        $result[(string) $id] = reobote_state_from_events($grouped[(string) $id] ?? [], $now);
    }
    return $result;
}

// Regras de sequencia: impedem registros duplicados ou fora da ordem esperada.
// Retorna null quando o registro e permitido, 'duplicate' para repeticoes ou a mensagem de erro.
function reobote_check_transition(array $stateInfo, string $type, ?string $unitId, ?string $qrCodeId, DateTimeImmutable $at): ?string
{
    $state = $stateInfo['state'];
    $last = $stateInfo['lastEvent'];
    if ($last !== null && $last['type'] === $type && abs($at->getTimestamp() - $last['at']->getTimestamp()) < 120
        && $last['unitId'] === $unitId && $last['qrCodeId'] === $qrCodeId) {
        return 'duplicate';
    }
    $lastCheckin = null;
    foreach (array_reverse($stateInfo['shift']['events'] ?? []) as $event) {
        if (in_array($event['type'], REOBOTE_START_TYPES, true)) {
            $lastCheckin = $event;
            break;
        }
    }

    switch ($type) {
        case 'vehicle_checkin':
            if ($state === 'on_break') {
                return 'Registre o retorno do almoço antes de uma nova leitura.';
            }
            if ($state === 'in_transit' && $lastCheckin !== null && $lastCheckin['qrCodeId'] === $qrCodeId) {
                return 'A chegada a este veículo já foi registrada.';
            }
            return null;
        case 'unit_checkin':
        case 'arrival':
            if ($state === 'on_break') {
                return 'Registre o retorno do almoço antes de uma nova leitura.';
            }
            if ($state === 'working' && $lastCheckin !== null && $lastCheckin['type'] === $type && $lastCheckin['unitId'] === $unitId) {
                return 'A chegada a esta unidade já foi registrada.';
            }
            return null;
        case 'break_start':
            if ($state === 'on_break') {
                return 'O almoço já foi iniciado.';
            }
            return in_array($state, ['working', 'in_transit'], true) ? null : 'Inicie a jornada antes de registrar o almoço.';
        case 'break_end':
            return $state === 'on_break' ? null : 'Não há almoço em andamento para registrar o retorno.';
        case 'departure':
            if ($state === 'on_break') {
                return 'Registre o retorno do almoço antes de encerrar a jornada.';
            }
            if ($state === 'finished') {
                return 'A jornada de hoje já foi encerrada.';
            }
            return in_array($state, ['working', 'in_transit'], true) ? null : 'Não há jornada em andamento para encerrar.';
    }
    return 'Tipo de registro inválido.';
}

// Distancia em metros entre duas coordenadas (formula de Haversine).
function reobote_distance_m(float $lat1, float $lng1, float $lat2, float $lng2): int
{
    $earth = 6371000;
    $dLat = deg2rad($lat2 - $lat1);
    $dLng = deg2rad($lng2 - $lng1);
    $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;
    return (int) round($earth * 2 * atan2(sqrt($a), sqrt(1 - $a)));
}
