<?php
declare(strict_types=1);

// Consultas e gravacoes compartilhadas entre as rotas: cadastro de colaboradores e registros de jornada.

const REOBOTE_EMPLOYEE_SELECT = 'SELECT e.id, e.name, e.email, e.phone, e.photo_path, e.job_id, e.schedule_id, e.unit_id, e.active,
        e.tracking_enabled, e.created_at, j.name AS job_name, j.default_schedule_id AS job_schedule_id,
        un.name AS unit_name, s.name AS schedule_name,
        u.id AS user_id, u.role, u.must_change_password, u.last_login_at
    FROM employees e
    LEFT JOIN jobs j ON j.id = e.job_id
    LEFT JOIN units un ON un.id = e.unit_id
    LEFT JOIN schedules s ON s.id = e.schedule_id
    LEFT JOIN users u ON u.employee_id = e.id';

// Busca um colaborador com cargo, unidade, jornada e dados de acesso; null quando não existe.
function reobote_employee_row(PDO $db, string $id): ?array
{
    $query = $db->prepare(REOBOTE_EMPLOYEE_SELECT . ' WHERE e.id = ? LIMIT 1');
    $query->execute([$id]);
    return $query->fetch() ?: null;
}

// Igual a reobote_employee_row, mas responde 404 quando o colaborador não existe.
function reobote_require_employee(PDO $db, string $id): array
{
    $row = reobote_employee_row($db, $id);
    if ($row === null) {
        reobote_fail('Colaborador não encontrado.', 404);
    }
    return $row;
}

// Formato publico de um colaborador; a situacao atual e opcional.
function reobote_employee_public(PDO $db, array $row, ?array $state = null): array
{
    $schedule = reobote_employee_schedule($db, $row);
    $data = [
        'id' => (string) $row['id'],
        'name' => $row['name'],
        'email' => $row['email'],
        'phone' => $row['phone'],
        'hasPhoto' => (bool) $row['photo_path'],
        'photoVersion' => $row['photo_path'] ? substr(md5((string) $row['photo_path']), 0, 8) : null,
        'jobId' => $row['job_id'] === null ? null : (string) $row['job_id'],
        'job' => $row['job_name'],
        'unitId' => $row['unit_id'] === null ? null : (string) $row['unit_id'],
        'unit' => $row['unit_name'],
        'scheduleId' => $row['schedule_id'] === null ? null : (string) $row['schedule_id'],
        'schedule' => reobote_schedule_public($schedule),
        'active' => (bool) $row['active'],
        'role' => $row['role'] ?? 'employee',
        'roleLabel' => REOBOTE_ROLES[$row['role'] ?? 'employee'] ?? 'Colaborador',
        'mustChangePassword' => (bool) ($row['must_change_password'] ?? false),
        'lastLoginAt' => reobote_iso($row['last_login_at'] ?? null),
        'trackingEnabled' => (bool) $row['tracking_enabled'],
        'createdAt' => reobote_iso($row['created_at']),
    ];
    if ($state !== null) {
        $data['state'] = $state['state'];
        $data['stateLabel'] = $state['stateLabel'];
        $data['lastEvent'] = $state['lastEvent'] ? reobote_event_public($state['lastEvent']) : null;
        $data['shiftStart'] = $state['shift'] ? $state['shift']['start']->format('Y-m-d\TH:i:s\Z') : null;
    }
    return $data;
}

// Converte data/hora vinda do navegador. Sem fuso explicito, considera o fuso configurado da empresa.
function reobote_parse_datetime(string $value, string $label): DateTimeImmutable
{
    $value = trim($value);
    if ($value === '' || strlen($value) > 40 || !preg_match('/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/', $value)) {
        reobote_fail("$label inválido.");
    }
    try {
        $hasZone = (bool) preg_match('/(Z|[+-]\d{2}:?\d{2})$/', $value);
        $date = new DateTimeImmutable($value, $hasZone ? null : reobote_timezone());
    } catch (Throwable) {
        reobote_fail("$label inválido.");
    }
    return $date->setTimezone(new DateTimeZone('UTC'));
}

// Identifica um QR Code lido pelo aplicativo. Formato: REOBOTE:U:<token> (unidade) ou REOBOTE:V:<token> (veiculo).
function reobote_resolve_qr(PDO $db, string $payload): array
{
    if (!preg_match('/^REOBOTE:(U|V):([a-f0-9]{32})$/', trim($payload), $match)) {
        return ['error' => 'Este QR Code não pertence ao REOBOTE.'];
    }
    $query = $db->prepare(
        'SELECT q.id, q.kind, q.label, q.active, q.unit_id, u.name AS unit_name, u.latitude, u.longitude, u.radius_m, u.active AS unit_active
         FROM qr_codes q LEFT JOIN units u ON u.id = q.unit_id WHERE q.token = ? LIMIT 1'
    );
    $query->execute([$match[2]]);
    $qr = $query->fetch();
    $kind = $match[1] === 'U' ? 'unit' : 'vehicle';
    if (!$qr || $qr['kind'] !== $kind) {
        return ['error' => 'QR Code não reconhecido. Ele pode ter sido substituído pela Central.'];
    }
    if (!(int) $qr['active'] || ($qr['unit_id'] !== null && !(int) $qr['unit_active'])) {
        return ['error' => 'Este QR Code está desativado.'];
    }
    return ['qr' => $qr, 'type' => $kind === 'unit' ? 'unit_checkin' : 'vehicle_checkin'];
}

// Grava um registro de jornada aplicando as regras de sequencia, deduplicacao e notificacao.
// Retorna status recorded, duplicate ou rejected.
function reobote_record_event(PDO $db, array $employee, string $type, DateTimeImmutable $at, array $options = []): array
{
    $clientId = $options['clientId'] ?? null;
    $validate = $options['validate'] ?? true;
    $qr = $options['qr'] ?? null;
    $unitId = $qr !== null && $qr['unit_id'] !== null ? (string) $qr['unit_id'] : ($options['unitId'] ?? null);
    $qrCodeId = $qr !== null ? (string) $qr['id'] : null;

    if ($clientId !== null) {
        $query = $db->prepare('SELECT id FROM attendance_events WHERE employee_id = ? AND client_id = ? LIMIT 1');
        $query->execute([$employee['id'], $clientId]);
        if ($existing = $query->fetchColumn()) {
            return ['status' => 'duplicate', 'eventId' => (string) $existing];
        }
    }

    if ($validate) {
        $previous = reobote_load_events($db, (string) $employee['id'], $at->modify('-36 hours')->format('Y-m-d H:i:s'), $at->modify('+1 second')->format('Y-m-d H:i:s'));
        $state = reobote_state_from_events($previous, $at);
        $problem = reobote_check_transition($state, $type, $unitId, $qrCodeId, $at);
        if ($problem === 'duplicate') {
            return ['status' => 'duplicate', 'eventId' => $state['lastEvent']['id']];
        }
        if ($problem !== null) {
            return ['status' => 'rejected', 'error' => $problem];
        }
    }

    // Distancia ate a unidade quando o aparelho enviou a localizacao autorizada.
    $lat = $options['latitude'] ?? null;
    $lng = $options['longitude'] ?? null;
    $distance = null;
    $radius = null;
    if ($lat !== null && $lng !== null && $unitId !== null) {
        $unit = $qr ?? null;
        if ($unit === null || !isset($unit['latitude'])) {
            $query = $db->prepare('SELECT latitude, longitude, radius_m FROM units WHERE id = ?');
            $query->execute([$unitId]);
            $unit = $query->fetch() ?: null;
        }
        if ($unit && $unit['latitude'] !== null && $unit['longitude'] !== null) {
            $distance = reobote_distance_m((float) $lat, (float) $lng, (float) $unit['latitude'], (float) $unit['longitude']);
            $radius = (int) $unit['radius_m'];
        }
    }

    try {
        $insert = $db->prepare(
            'INSERT INTO attendance_events (employee_id, event_type, occurred_at, unit_id, qr_code_id, client_id, received_at,
                latitude, longitude, accuracy_m, distance_m, source, notes, created_by_user_id)
             VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), ?, ?, ?, ?, ?, ?, ?)'
        );
        $insert->execute([
            $employee['id'], $type, $at->format('Y-m-d H:i:s'), $unitId, $qrCodeId, $clientId,
            $lat, $lng, $options['accuracy'] ?? null, $distance,
            $options['source'] ?? 'mobile', $options['notes'] ?? null, $options['userId'] ?? null,
        ]);
    } catch (PDOException $error) {
        if ($clientId !== null && (int) ($error->errorInfo[1] ?? 0) === 1062) {
            return ['status' => 'duplicate'];
        }
        throw $error;
    }
    $eventId = (string) $db->lastInsertId();

    // Localiza o dia de jornada deste registro para avisar atrasos e horas extras.
    $tz = reobote_timezone();
    $localDate = $at->setTimezone($tz)->format('Y-m-d');
    $previousDate = $at->setTimezone($tz)->modify('-1 day')->format('Y-m-d');
    $journey = reobote_journey($db, $employee, $previousDate, $localDate);
    $journeyDay = null;
    foreach ($journey['days'] as $day) {
        foreach ($day['events'] as $item) {
            if ($item['id'] === $eventId) {
                $journeyDay = $day;
                break 2;
            }
        }
    }
    $event = [
        'id' => $eventId,
        'type' => $type,
        'at' => $at,
        'unitName' => $qr['unit_name'] ?? null,
        'qrLabel' => $qr['label'] ?? null,
        'source' => $options['source'] ?? 'mobile',
        'distanceM' => $distance,
        'unitRadius' => $radius,
    ];
    if ($event['unitName'] === null && $unitId !== null) {
        $query = $db->prepare('SELECT name FROM units WHERE id = ?');
        $query->execute([$unitId]);
        $event['unitName'] = $query->fetchColumn() ?: null;
    }
    reobote_notify_event($db, $employee, $event, $journeyDay);

    return ['status' => 'recorded', 'eventId' => $eventId, 'distanceM' => $distance, 'place' => $event['unitName'] ?? $event['qrLabel']];
}

// Fotos de identificacao: armazenadas fora da pasta publica e entregues somente a quem pode ver o colaborador.
function reobote_photo_dir(): string
{
    $dir = __DIR__ . '/../storage/photos';
    if (!is_dir($dir) && !mkdir($dir, 0750, true) && !is_dir($dir)) {
        throw new RuntimeException('Não foi possível criar a pasta de fotos.');
    }
    return realpath($dir);
}

// Valida e grava a foto enviada (JPG, PNG ou WEBP, até 5 MB) com nome aleatório; devolve o nome do arquivo.
function reobote_store_photo(array $file): string
{
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'])) {
        reobote_fail('Envie uma imagem válida.');
    }
    if ($file['size'] > 5 * 1024 * 1024) {
        reobote_fail('A foto deve ter no máximo 5 MB.');
    }
    $info = @getimagesize($file['tmp_name']);
    $types = [IMAGETYPE_JPEG => 'jpg', IMAGETYPE_PNG => 'png', IMAGETYPE_WEBP => 'webp'];
    if ($info === false || !isset($types[$info[2]])) {
        reobote_fail('A foto deve estar em JPG, PNG ou WEBP.');
    }
    $name = bin2hex(random_bytes(12));
    $dir = reobote_photo_dir();

    // Com a extensao GD, a imagem e redimensionada e regravada, descartando metadados (como localizacao da camera).
    if (function_exists('imagecreatefromstring') && function_exists('imagejpeg')) {
        $source = @imagecreatefromstring((string) file_get_contents($file['tmp_name']));
        if ($source !== false) {
            $width = imagesx($source);
            $height = imagesy($source);
            $scale = min(1, 600 / max($width, $height));
            $target = imagecreatetruecolor(max(1, (int) round($width * $scale)), max(1, (int) round($height * $scale)));
            imagefill($target, 0, 0, imagecolorallocate($target, 255, 255, 255));
            imagecopyresampled($target, $source, 0, 0, 0, 0, imagesx($target), imagesy($target), $width, $height);
            imagejpeg($target, "$dir/$name.jpg", 86);
            return "$name.jpg";
        }
    }
    $file_name = $name . '.' . $types[$info[2]];
    if (!move_uploaded_file($file['tmp_name'], "$dir/$file_name")) {
        throw new RuntimeException('Falha ao gravar a foto.');
    }
    return $file_name;
}

// Apaga do disco a foto anterior do colaborador (somente nomes gerados pelo sistema).
function reobote_delete_photo(?string $fileName): void
{
    if ($fileName && preg_match('/^[a-f0-9]{24}\.(jpg|png|webp)$/', $fileName)) {
        $path = reobote_photo_dir() . '/' . $fileName;
        if (is_file($path)) {
            unlink($path);
        }
    }
}
