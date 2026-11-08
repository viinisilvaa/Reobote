<?php
// REOBOTE | server/routes/me.php — API do aplicativo: dia atual, registros, histórico e localização
declare(strict_types=1);

// Rotas do aplicativo do colaborador: situacao do dia, envio de registros (inclusive offline) e historico proprio.

function api_me_employee(PDO $db, array $user): array
{
    if (empty($user['employeeId'])) {
        reobote_fail('Esta conta não está vinculada a um colaborador.', 403, 'no_employee');
    }
    reobote_require($user, 'app');
    return reobote_require_employee($db, (string) $user['employeeId']);
}

// Acoes que o colaborador pode realizar agora, de acordo com a sequencia da jornada.
function api_allowed_actions(array $state): array
{
    $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $actions = [];
    foreach (['break_start', 'break_end', 'departure'] as $type) {
        $problem = reobote_check_transition($state, $type, null, null, $now->modify('+10 minutes'));
        $actions[$type] = $problem === null;
    }
    $actions['scan'] = $state['state'] !== 'on_break';
    return $actions;
}

// Monta a tela inicial do aplicativo: colaborador, situação, registros do turno, resumo do dia e ações permitidas.
function api_me_today_payload(PDO $db, array $employee): array
{
    $tz = reobote_timezone();
    $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $states = reobote_current_states($db, [(string) $employee['id']], $now);
    $state = $states[(string) $employee['id']];
    $today = $now->setTimezone($tz)->format('Y-m-d');
    $yesterday = $now->setTimezone($tz)->modify('-1 day')->format('Y-m-d');
    $journey = reobote_journey($db, $employee, $yesterday, $today, $now);

    // Em turnos noturnos o dia de referencia e o do inicio do turno em andamento.
    $referenceDate = $state['shift'] !== null ? $state['shift']['start']->setTimezone($tz)->format('Y-m-d') : $today;
    $day = null;
    foreach ($journey['days'] as $item) {
        if ($item['date'] === $referenceDate) {
            $day = $item;
        }
    }

    return [
        'employee' => reobote_employee_public($db, $employee, $state),
        'state' => $state['state'],
        'stateLabel' => $state['stateLabel'],
        'lastEvent' => $state['lastEvent'] ? reobote_event_public($state['lastEvent']) : null,
        'shiftEvents' => $state['shift'] ? array_map('reobote_event_public', $state['shift']['events']) : [],
        'day' => $day,
        'actions' => api_allowed_actions($state),
        'serverTime' => $now->format('Y-m-d\TH:i:s\Z'),
    ];
}

// Situação do dia para o aplicativo.
route('GET', '/api/me/today', static function (PDO $db): void {
    $user = reobote_user();
    reobote_json(api_me_today_payload($db, api_me_employee($db, $user)));
});

// Recebe um ou varios registros. O aplicativo envia o horario original de cada registro, inclusive dos feitos sem internet.
route('POST', '/api/me/attendance', static function (PDO $db): void {
    $user = reobote_user();
    $employee = api_me_employee($db, $user);
    $body = reobote_body();
    $items = $body['events'] ?? null;
    if (!is_array($items) || !$items || count($items) > 100) {
        reobote_fail('Envie de 1 a 100 registros.');
    }

    $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $maxAge = max(1, (int) reobote_settings()['offline_max_days']);
    $prepared = [];
    $results = [];
    foreach ($items as $index => $item) {
        $clientId = is_array($item) ? (string) ($item['clientId'] ?? '') : '';
        $result = ['clientId' => $clientId];
        try {
            if (!preg_match('/^[A-Za-z0-9-]{8,64}$/', $clientId)) {
                throw new InvalidArgumentException('Identificador do registro inválido.');
            }
            $type = (string) ($item['type'] ?? '');
            if (!in_array($type, ['scan', 'break_start', 'break_end', 'departure'], true)) {
                throw new InvalidArgumentException('Tipo de registro inválido.');
            }
            $occurred = (string) ($item['occurredAt'] ?? '');
            if (!preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/', $occurred)) {
                throw new InvalidArgumentException('Horário do registro inválido.');
            }
            $at = (new DateTimeImmutable($occurred))->setTimezone(new DateTimeZone('UTC'));
            $at = $at->setTime((int) $at->format('H'), (int) $at->format('i'), (int) $at->format('s'));
            if ($at > $now->modify('+5 minutes')) {
                throw new InvalidArgumentException('O horário do aparelho está adiantado. Ajuste a data e a hora do celular.');
            }
            if ($at < $now->modify("-$maxAge days")) {
                throw new InvalidArgumentException("Registros com mais de $maxAge dias não podem ser sincronizados. Procure a administração.");
            }
            $qr = null;
            if ($type === 'scan') {
                $resolved = reobote_resolve_qr($db, (string) ($item['qr'] ?? ''));
                if (isset($resolved['error'])) {
                    throw new InvalidArgumentException($resolved['error']);
                }
                $qr = $resolved['qr'];
                $type = $resolved['type'];
            }
            // O encerramento da jornada pelo aplicativo so vale com a leitura de um QR Code (veiculo ou unidade).
            if ($type === 'departure') {
                if ((string) ($item['qr'] ?? '') === '') {
                    throw new InvalidArgumentException('Escaneie o QR Code do veículo ou da unidade para encerrar a jornada.');
                }
                $resolved = reobote_resolve_qr($db, (string) $item['qr']);
                if (isset($resolved['error'])) {
                    throw new InvalidArgumentException($resolved['error']);
                }
                $qr = $resolved['qr'];
            }
            $lat = filter_var($item['latitude'] ?? null, FILTER_VALIDATE_FLOAT, FILTER_NULL_ON_FAILURE);
            $lng = filter_var($item['longitude'] ?? null, FILTER_VALIDATE_FLOAT, FILTER_NULL_ON_FAILURE);
            $accuracy = filter_var($item['accuracy'] ?? null, FILTER_VALIDATE_FLOAT, FILTER_NULL_ON_FAILURE);
            if ($lat === null || $lng === null || $lat < -90 || $lat > 90 || $lng < -180 || $lng > 180) {
                $lat = $lng = $accuracy = null;
            }
            $prepared[] = ['index' => $index, 'at' => $at, 'type' => $type, 'qr' => $qr, 'clientId' => $clientId,
                'lat' => $lat, 'lng' => $lng, 'accuracy' => $accuracy !== null ? min(100000, max(0, $accuracy)) : null,
                'notes' => isset($item['notes']) ? (mb_substr(trim((string) $item['notes']), 0, 300) ?: null) : null];
        } catch (InvalidArgumentException $error) {
            $results[$index] = $result + ['status' => 'rejected', 'error' => $error->getMessage()];
        }
    }

    // Processa na ordem cronologica original para validar a sequencia corretamente.
    usort($prepared, static fn ($a, $b) => $a['at'] <=> $b['at']);
    foreach ($prepared as $item) {
        $outcome = reobote_record_event($db, $employee, $item['type'], $item['at'], [
            'clientId' => $item['clientId'], 'qr' => $item['qr'], 'latitude' => $item['lat'], 'longitude' => $item['lng'],
            'accuracy' => $item['accuracy'], 'source' => 'mobile', 'notes' => $item['notes'], 'userId' => $user['id'],
        ]);
        $results[$item['index']] = ['clientId' => $item['clientId'], 'eventType' => $item['type']] + $outcome;
    }
    ksort($results);
    reobote_json(['results' => array_values($results), 'today' => api_me_today_payload($db, $employee)]);
});

// Histórico de jornada do próprio colaborador (até 93 dias).
route('GET', '/api/me/history', static function (PDO $db): void {
    $user = reobote_user();
    $employee = api_me_employee($db, $user);
    [$from, $to] = reobote_date_range(93, 30);
    reobote_json(reobote_journey($db, $employee, $from, $to) + ['from' => $from, 'to' => $to]);
});

// Consentimento de localizacao (LGPD): somente o proprio colaborador autoriza ou revoga.
route('PUT', '/api/me/location-sharing', static function (PDO $db): void {
    $user = reobote_user();
    $employee = api_me_employee($db, $user);
    $body = reobote_body();
    if (!is_bool($body['consent'] ?? null)) {
        reobote_fail('Informe sua autorização de localização.');
    }
    $db->prepare('UPDATE employees SET tracking_enabled = ?, location_consent_at = ' . ($body['consent'] ? 'UTC_TIMESTAMP()' : 'NULL') . ' WHERE id = ?')
        ->execute([$body['consent'] ? 1 : 0, $employee['id']]);
    reobote_audit($db, $user, $body['consent'] ? 'location_consent_given' : 'location_consent_revoked', 'employee', (string) $employee['id']);
    reobote_json(['trackingEnabled' => $body['consent']]);
});

// Recebe a localização do colaborador durante a jornada (guardada por 30 dias).
route('POST', '/api/me/locations', static function (PDO $db): void {
    $user = reobote_user();
    $employee = api_me_employee($db, $user);
    $body = reobote_body();
    $latitude = filter_var($body['latitude'] ?? null, FILTER_VALIDATE_FLOAT);
    $longitude = filter_var($body['longitude'] ?? null, FILTER_VALIDATE_FLOAT);
    $accuracy = filter_var($body['accuracyM'] ?? null, FILTER_VALIDATE_FLOAT);
    if ($latitude === false || $latitude < -90 || $latitude > 90 || $longitude === false || $longitude < -180 || $longitude > 180
        || $accuracy === false || $accuracy < 0 || $accuracy > 100000) {
        reobote_fail('Coordenadas ou precisão inválidas.');
    }
    // A localizacao e enviada automaticamente, mas SOMENTE durante a jornada (do primeiro registro ao encerramento).
    $state = reobote_current_states($db, [(string) $employee['id']], new DateTimeImmutable('now', new DateTimeZone('UTC')))[(string) $employee['id']];
    if (!in_array($state['state'], ['in_transit', 'working', 'on_break'], true)) {
        reobote_fail('Fora da jornada a localização não é registrada.', 409, 'outside_shift');
    }
    $db->prepare('INSERT INTO employee_locations (employee_id, latitude, longitude, accuracy_m, recorded_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP())')
        ->execute([$employee['id'], $latitude, $longitude, $accuracy]);
    // Mantem somente 30 dias de localizacoes (minimizacao de dados pessoais).
    $db->prepare('DELETE FROM employee_locations WHERE employee_id = ? AND recorded_at < UTC_TIMESTAMP() - INTERVAL 30 DAY')->execute([$employee['id']]);
    reobote_json(['recorded' => true], 201);
});

// Foto do proprio colaborador como texto (data URL). No APK, imagens comuns (<img src>) de outro endereco
// nao levam o cookie de sessao; por isso o aplicativo busca a foto por esta rota, junto com os demais dados.
route('GET', '/api/me/photo', static function (PDO $db): void {
    $user = reobote_user();
    $employee = api_me_employee($db, $user);
    $fileName = (string) ($employee['photo_path'] ?? '');
    $path = $fileName !== '' && preg_match('/^[a-f0-9]{24}\.(jpg|png|webp)$/', $fileName, $match) ? reobote_photo_dir() . '/' . $fileName : null;
    if ($path === null || !is_file($path)) {
        reobote_json(['photo' => null]);
    }
    $types = ['jpg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp'];
    reobote_json(['photo' => 'data:' . $types[$match[1]] . ';base64,' . base64_encode((string) file_get_contents($path))]);
});
