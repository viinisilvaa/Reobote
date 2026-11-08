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
        // GPS falso: registro com posicao impossivel em relacao a anterior ("teletransporte") e recusado.
        if ($item['lat'] !== null && $item['lng'] !== null) {
            $jump = reobote_location_jump($db, (string) $employee['id'], (float) $item['lat'], (float) $item['lng'], $item['at']);
            if ($jump !== null) {
                reobote_notify($db, 'fake_gps', $employee['name'] . ' está usando GPS falso', 'Registro de ponto recusado: ' . $jump, (string) $employee['id'], null,
                    'fake_gps:' . $employee['id'] . ':' . intdiv(time(), 600));
                $results[$item['index']] = ['clientId' => $item['clientId'], 'eventType' => $item['type'], 'status' => 'rejected',
                    'error' => 'GPS falso detectado (' . $jump . '). Desative o app de localização falsa.'];
                continue;
            }
        }
        $outcome = reobote_record_event($db, $employee, $item['type'], $item['at'], [
            'clientId' => $item['clientId'], 'qr' => $item['qr'], 'latitude' => $item['lat'], 'longitude' => $item['lng'],
            'accuracy' => $item['accuracy'], 'source' => 'mobile', 'notes' => $item['notes'], 'userId' => $user['id'],
        ]);
        $results[$item['index']] = ['clientId' => $item['clientId'], 'eventType' => $item['type']] + $outcome;
    }
    ksort($results);
    reobote_json(['results' => array_values($results), 'today' => api_me_today_payload($db, $employee)]);
});

// Histórico de jornada do próprio colaborador (até 1 ano por consulta; os registros nunca são apagados).
route('GET', '/api/me/history', static function (PDO $db): void {
    $user = reobote_user();
    $employee = api_me_employee($db, $user);
    [$from, $to] = reobote_date_range(367, 30);
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
    // GPS falso: posicao impossivel em relacao a anterior ("teletransporte") e recusada e a Central e avisada.
    $jump = reobote_location_jump($db, (string) $employee['id'], (float) $latitude, (float) $longitude, new DateTimeImmutable('now', new DateTimeZone('UTC')));
    if ($jump !== null) {
        reobote_notify($db, 'fake_gps', $employee['name'] . ' está usando GPS falso', 'Localização impossível recusada: ' . $jump, (string) $employee['id'], null,
            'fake_gps:' . $employee['id'] . ':' . intdiv(time(), 600));
        reobote_fail('Localização recusada (' . $jump . '). Desative o GPS falso.', 422, 'fake_gps');
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

// O aplicativo detectou localizacao FALSA no celular (app de "GPS falso" / localizacao simulada do Android).
// O registro ja foi bloqueado no aparelho; aqui a Central e avisada na hora e o fato fica no historico de alteracoes.
// Avisa no maximo uma vez a cada 10 minutos por colaborador.
route('POST', '/api/me/mock-location', static function (PDO $db): void {
    $user = reobote_user();
    $employee = api_me_employee($db, $user);
    $body = reobote_body();
    $context = (string) ($body['context'] ?? '') === 'checkin' ? 'checkin' : 'tracking';
    $latitude = filter_var($body['latitude'] ?? null, FILTER_VALIDATE_FLOAT, FILTER_NULL_ON_FAILURE);
    $longitude = filter_var($body['longitude'] ?? null, FILTER_VALIDATE_FLOAT, FILTER_NULL_ON_FAILURE);
    $where = ($latitude !== null && $longitude !== null) ? sprintf(' • posição falsa informada: %.5f, %.5f', $latitude, $longitude) : '';
    // Nomes dos apps de GPS falso ativados no celular (informados pelo detector nativo do APK).
    $apps = array_slice(array_values(array_filter(array_map(static fn ($app) => mb_substr(trim((string) $app), 0, 60), (array) ($body['apps'] ?? [])))), 0, 5);
    $detail = ($context === 'checkin' ? 'Registro de ponto bloqueado no aplicativo' : 'Localização da jornada bloqueada no aplicativo')
        . ($apps ? ' • app de GPS falso: ' . implode(', ', $apps) : '') . $where;
    reobote_notify($db, 'fake_gps', $employee['name'] . ' está usando GPS falso', $detail, (string) $employee['id'], null,
        'fake_gps:' . $employee['id'] . ':' . intdiv(time(), 600));
    reobote_audit($db, $user, 'fake_gps_detected', 'employee', (string) $employee['id'], ['context' => $context]);
    reobote_json(['reported' => true]);
});

// Diagnóstico do aplicativo (enviado uma vez ao abrir o APK): resultado do detector de GPS falso, se os
// plugins nativos carregaram e eventuais erros. Fica no histórico de alterações (Configurações), para a
// administração conferir se a proteção está funcionando em cada celular.
route('POST', '/api/me/diagnostic', static function (PDO $db): void {
    $user = reobote_user();
    $employee = api_me_employee($db, $user);
    $body = reobote_body();
    $details = [
        'detector' => (bool) ($body['detector'] ?? false),
        'backgroundPlugin' => (bool) ($body['backgroundPlugin'] ?? false),
        'result' => is_array($body['result'] ?? null) ? $body['result'] : null,
        'error' => isset($body['error']) ? mb_substr((string) $body['error'], 0, 300) : null,
        'version' => isset($body['version']) ? mb_substr((string) $body['version'], 0, 20) : null,
        'userAgent' => mb_substr((string) ($body['userAgent'] ?? ''), 0, 200),
    ];
    // Limita o tamanho do que é guardado.
    $json = json_encode($details, JSON_UNESCAPED_UNICODE);
    if ($json === false || strlen($json) > 4000) {
        $details['result'] = ['truncated' => true];
    }
    reobote_audit($db, $user, 'app_diagnostic', 'employee', (string) $employee['id'], $details);
    reobote_json(['saved' => true]);
});
