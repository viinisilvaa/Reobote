<?php
// REOBOTE | server/setup.php — Servidor: cria e atualiza o banco de dados (migrações)
declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/lib/auth.php';

// Instala e atualiza o banco. Cada migracao e idempotente: pode ser executada de novo sem perder dados.
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$database = reobote_env('MYSQL_DATABASE', 'reobote');
$pdo = reobote_db(true);
$pdo->exec("CREATE DATABASE IF NOT EXISTS `$database` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
$pdo = reobote_db();

// Verifica se uma coluna já existe (permite rodar o setup várias vezes sem erro).
function column_exists(PDO $pdo, string $table, string $column): bool
{
    $query = $pdo->prepare('SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?');
    $query->execute([$table, $column]);
    return (int) $query->fetchColumn() > 0;
}

// Verifica se um índice já existe na tabela.
function index_exists(PDO $pdo, string $table, string $index): bool
{
    $query = $pdo->prepare('SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?');
    $query->execute([$table, $index]);
    return (int) $query->fetchColumn() > 0;
}

// Verifica se uma restrição (chave estrangeira) já existe na tabela.
function constraint_exists(PDO $pdo, string $table, string $name): bool
{
    $query = $pdo->prepare('SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?');
    $query->execute([$table, $name]);
    return (int) $query->fetchColumn() > 0;
}

// Acrescenta uma coluna somente se ela ainda não existir.
function add_column(PDO $pdo, string $table, string $column, string $definition): void
{
    if (!column_exists($pdo, $table, $column)) {
        $pdo->exec("ALTER TABLE `$table` ADD COLUMN `$column` $definition");
    }
}

// Acrescenta um índice somente se ele ainda não existir.
function add_index(PDO $pdo, string $table, string $index, string $definition): void
{
    if (!index_exists($pdo, $table, $index)) {
        $pdo->exec("ALTER TABLE `$table` ADD $definition");
    }
}

// Acrescenta uma chave estrangeira somente se ela ainda não existir.
function add_foreign_key(PDO $pdo, string $table, string $name, string $definition): void
{
    if (!constraint_exists($pdo, $table, $name)) {
        $pdo->exec("ALTER TABLE `$table` ADD CONSTRAINT `$name` $definition");
    }
}

$migrations = [];

// 1. Estrutura original: colaboradores, contas, cargos atribuidos, ponto, localizacao e protecao de login.
$migrations[1] = static function (PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS employees (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(160) NOT NULL,
      email VARCHAR(190) NOT NULL,
      phone VARCHAR(32) NULL,
      photo_url VARCHAR(2048) NULL,
      status ENUM('Em atendimento', 'Em pausa', 'Offline') NOT NULL DEFAULT 'Offline',
      tracking_enabled TINYINT(1) NOT NULL DEFAULT 0,
      location_consent_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_employees_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      employee_id BIGINT UNSIGNED NULL,
      email VARCHAR(190) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('admin', 'dispatcher', 'employee') NOT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_users_email (email),
      UNIQUE KEY uq_users_employee (employee_id),
      CONSTRAINT fk_users_employee FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS job_assignments (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      employee_id BIGINT UNSIGNED NOT NULL,
      title VARCHAR(160) NOT NULL,
      schedule_start TIME NULL,
      schedule_end TIME NULL,
      tolerance_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME NULL,
      notes VARCHAR(500) NULL,
      PRIMARY KEY (id),
      KEY ix_job_assignments_employee_dates (employee_id, assigned_at, ended_at),
      CONSTRAINT fk_job_assignments_employee FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS attendance_events (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      employee_id BIGINT UNSIGNED NOT NULL,
      event_type ENUM('arrival', 'departure', 'break_start', 'break_end') NOT NULL,
      occurred_at DATETIME NOT NULL,
      source ENUM('mobile', 'admin', 'import') NOT NULL DEFAULT 'mobile',
      notes VARCHAR(500) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY ix_attendance_employee_time (employee_id, occurred_at),
      CONSTRAINT fk_attendance_employee FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS employee_locations (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      employee_id BIGINT UNSIGNED NOT NULL,
      latitude DECIMAL(10, 7) NOT NULL,
      longitude DECIMAL(10, 7) NOT NULL,
      accuracy_m DECIMAL(8, 2) NULL,
      recorded_at DATETIME NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY ix_locations_employee_time (employee_id, recorded_at),
      CONSTRAINT fk_locations_employee FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE,
      CONSTRAINT ck_location_latitude CHECK (latitude BETWEEN -90 AND 90),
      CONSTRAINT ck_location_longitude CHECK (longitude BETWEEN -180 AND 180)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS login_attempts (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      ip_hash CHAR(64) NOT NULL,
      email_hash CHAR(64) NOT NULL,
      attempted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY ix_login_attempts_lookup (ip_hash, email_hash, attempted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
};

// 2. Plataforma integrada: unidades, QR Codes, cargos com permissoes, escalas, notificacoes, auditoria e configuracoes.
$migrations[2] = static function (PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS settings (
      name VARCHAR(60) NOT NULL,
      value TEXT NULL,
      PRIMARY KEY (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS schedules (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(120) NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      break_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 60,
      tolerance_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 15,
      mode ENUM('weekly', 'cycle') NOT NULL DEFAULT 'weekly',
      work_days VARCHAR(7) NOT NULL DEFAULT '12345',
      cycle_work_days TINYINT UNSIGNED NOT NULL DEFAULT 1,
      cycle_off_days TINYINT UNSIGNED NOT NULL DEFAULT 1,
      cycle_anchor DATE NULL,
      off_day_overtime TINYINT(1) NOT NULL DEFAULT 1,
      notes VARCHAR(500) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_schedules_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS jobs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(120) NOT NULL,
      description VARCHAR(500) NULL,
      permissions TEXT NULL,
      default_schedule_id BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_jobs_name (name),
      CONSTRAINT fk_jobs_schedule FOREIGN KEY (default_schedule_id) REFERENCES schedules (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS units (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(160) NOT NULL,
      kind VARCHAR(40) NOT NULL DEFAULT 'Unidade hospitalar',
      address VARCHAR(300) NULL,
      latitude DECIMAL(10, 7) NULL,
      longitude DECIMAL(10, 7) NULL,
      radius_m SMALLINT UNSIGNED NOT NULL DEFAULT 300,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_units_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS qr_codes (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      kind ENUM('vehicle', 'unit') NOT NULL,
      label VARCHAR(160) NOT NULL,
      unit_id BIGINT UNSIGNED NULL,
      token CHAR(32) NOT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_qr_codes_token (token),
      KEY ix_qr_codes_unit (unit_id),
      CONSTRAINT fk_qr_codes_unit FOREIGN KEY (unit_id) REFERENCES units (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS holidays (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      holiday_date DATE NOT NULL,
      name VARCHAR(120) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_holidays_date (holiday_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS notifications (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      type VARCHAR(40) NOT NULL,
      title VARCHAR(200) NOT NULL,
      detail VARCHAR(500) NULL,
      employee_id BIGINT UNSIGNED NULL,
      event_id BIGINT UNSIGNED NULL,
      dedupe_key VARCHAR(120) NULL,
      created_at DATETIME NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_notifications_dedupe (dedupe_key),
      KEY ix_notifications_created (created_at),
      CONSTRAINT fk_notifications_employee FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS notification_reads (
      user_id BIGINT UNSIGNED NOT NULL,
      notification_id BIGINT UNSIGNED NOT NULL,
      read_at DATETIME NOT NULL,
      PRIMARY KEY (user_id, notification_id),
      KEY ix_notification_reads_notification (notification_id),
      CONSTRAINT fk_notification_reads_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT fk_notification_reads_notification FOREIGN KEY (notification_id) REFERENCES notifications (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS audit_log (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NULL,
      action VARCHAR(60) NOT NULL,
      entity VARCHAR(40) NOT NULL,
      entity_id VARCHAR(40) NULL,
      details TEXT NULL,
      ip_hash CHAR(64) NULL,
      created_at DATETIME NOT NULL,
      PRIMARY KEY (id),
      KEY ix_audit_created (created_at),
      KEY ix_audit_entity (entity, entity_id),
      CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    // Colaboradores: cargo, escala individual, unidade, foto armazenada no servidor e situacao do cadastro.
    add_column($pdo, 'employees', 'job_id', 'BIGINT UNSIGNED NULL AFTER phone');
    add_column($pdo, 'employees', 'schedule_id', 'BIGINT UNSIGNED NULL AFTER job_id');
    add_column($pdo, 'employees', 'unit_id', 'BIGINT UNSIGNED NULL AFTER schedule_id');
    add_column($pdo, 'employees', 'photo_path', 'VARCHAR(120) NULL AFTER photo_url');
    add_column($pdo, 'employees', 'active', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER tracking_enabled');
    add_foreign_key($pdo, 'employees', 'fk_employees_job', 'FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE SET NULL');
    add_foreign_key($pdo, 'employees', 'fk_employees_schedule', 'FOREIGN KEY (schedule_id) REFERENCES schedules (id) ON DELETE SET NULL');
    add_foreign_key($pdo, 'employees', 'fk_employees_unit', 'FOREIGN KEY (unit_id) REFERENCES units (id) ON DELETE SET NULL');

    // Contas: senha temporaria no primeiro acesso e registro do ultimo login.
    add_column($pdo, 'users', 'must_change_password', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER active');
    add_column($pdo, 'users', 'password_changed_at', 'DATETIME NULL AFTER must_change_password');
    add_column($pdo, 'users', 'last_login_at', 'DATETIME NULL AFTER password_changed_at');

    // Historico de cargos: referencia o cargo e a escala vigentes em cada periodo.
    add_column($pdo, 'job_assignments', 'job_id', 'BIGINT UNSIGNED NULL AFTER employee_id');
    add_column($pdo, 'job_assignments', 'schedule_id', 'BIGINT UNSIGNED NULL AFTER job_id');
    add_column($pdo, 'job_assignments', 'changed_by_user_id', 'BIGINT UNSIGNED NULL');

    // Registros: tipos de leitura por QR Code, local, horario original do aparelho e anulacao auditada.
    $pdo->exec("ALTER TABLE attendance_events MODIFY event_type
      ENUM('arrival', 'departure', 'break_start', 'break_end', 'vehicle_checkin', 'unit_checkin') NOT NULL");
    add_column($pdo, 'attendance_events', 'unit_id', 'BIGINT UNSIGNED NULL AFTER occurred_at');
    add_column($pdo, 'attendance_events', 'qr_code_id', 'BIGINT UNSIGNED NULL AFTER unit_id');
    add_column($pdo, 'attendance_events', 'client_id', 'VARCHAR(64) NULL AFTER qr_code_id');
    add_column($pdo, 'attendance_events', 'received_at', 'DATETIME NULL AFTER client_id');
    add_column($pdo, 'attendance_events', 'latitude', 'DECIMAL(10, 7) NULL');
    add_column($pdo, 'attendance_events', 'longitude', 'DECIMAL(10, 7) NULL');
    add_column($pdo, 'attendance_events', 'accuracy_m', 'DECIMAL(8, 2) NULL');
    add_column($pdo, 'attendance_events', 'distance_m', 'INT UNSIGNED NULL');
    add_column($pdo, 'attendance_events', 'created_by_user_id', 'BIGINT UNSIGNED NULL');
    add_column($pdo, 'attendance_events', 'voided_at', 'DATETIME NULL');
    add_column($pdo, 'attendance_events', 'voided_by_user_id', 'BIGINT UNSIGNED NULL');
    add_column($pdo, 'attendance_events', 'void_reason', 'VARCHAR(500) NULL');
    add_index($pdo, 'attendance_events', 'uq_attendance_client', 'UNIQUE KEY uq_attendance_client (employee_id, client_id)');
    add_index($pdo, 'attendance_events', 'ix_attendance_time', 'KEY ix_attendance_time (occurred_at)');
    add_foreign_key($pdo, 'attendance_events', 'fk_attendance_unit', 'FOREIGN KEY (unit_id) REFERENCES units (id) ON DELETE SET NULL');
    add_foreign_key($pdo, 'attendance_events', 'fk_attendance_qr', 'FOREIGN KEY (qr_code_id) REFERENCES qr_codes (id) ON DELETE SET NULL');
};

// 3. Dados iniciais do projeto: escalas de exemplo, os cargos definidos e as configuracoes padrao.
$migrations[3] = static function (PDO $pdo): void {
    if ((int) $pdo->query('SELECT COUNT(*) FROM schedules')->fetchColumn() === 0) {
        $insert = $pdo->prepare('INSERT INTO schedules (name, start_time, end_time, break_minutes, tolerance_minutes, mode, work_days, cycle_work_days, cycle_off_days, cycle_anchor, off_day_overtime)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)');
        $anchor = gmdate('Y-m-d');
        $insert->execute(['Comercial 08h às 18h', '08:00', '18:00', 60, 15, 'weekly', '12345', 1, 1, null]);
        $insert->execute(['Comercial 09h às 19h', '09:00', '19:00', 60, 15, 'weekly', '12345', 1, 1, null]);
        $insert->execute(['Plantão diurno 12x36', '07:00', '19:00', 60, 15, 'cycle', '1234567', 1, 1, $anchor]);
        $insert->execute(['Plantão noturno 12x36', '19:00', '07:00', 60, 15, 'cycle', '1234567', 1, 1, $anchor]);
    }
    $defaultSchedule = $pdo->query("SELECT id FROM schedules ORDER BY id LIMIT 1")->fetchColumn() ?: null;

    if ((int) $pdo->query('SELECT COUNT(*) FROM jobs')->fetchColumn() === 0) {
        $insert = $pdo->prepare('INSERT INTO jobs (name, description, permissions, default_schedule_id) VALUES (?, ?, ?, ?)');
        $jobs = [
            ['Ajudante Geral', 'Atividades de apoio operacional.', ['app']],
            ['Técnico Júnior', 'Atividades técnicas de acordo com o nível de experiência e autorização.', ['app']],
            ['Técnico Pleno', 'Maior experiência e autonomia para executar atividades técnicas.', ['app']],
            ['Supervisor', 'Acompanhamento das equipes e das atividades operacionais.', ['app', 'dashboard', 'notifications', 'reports']],
        ];
        foreach ($jobs as [$name, $description, $permissions]) {
            $insert->execute([$name, $description, json_encode($permissions), $defaultSchedule]);
        }
    }

    // Vincula colaboradores antigos ao cargo correspondente ao titulo atual, criando o cargo quando necessario.
    $titles = $pdo->query(
        'SELECT ja.employee_id, ja.title FROM job_assignments ja
         JOIN employees e ON e.id = ja.employee_id AND e.job_id IS NULL
         WHERE ja.ended_at IS NULL ORDER BY ja.assigned_at DESC, ja.id DESC'
    )->fetchAll();
    $seen = [];
    foreach ($titles as $row) {
        if (isset($seen[$row['employee_id']])) {
            continue;
        }
        $seen[$row['employee_id']] = true;
        $find = $pdo->prepare('SELECT id FROM jobs WHERE name = ?');
        $find->execute([$row['title']]);
        $jobId = $find->fetchColumn();
        if (!$jobId) {
            $pdo->prepare('INSERT INTO jobs (name, permissions, default_schedule_id) VALUES (?, ?, ?)')
                ->execute([$row['title'], json_encode(['app']), $defaultSchedule]);
            $jobId = $pdo->lastInsertId();
        }
        $pdo->prepare('UPDATE employees SET job_id = ? WHERE id = ?')->execute([$jobId, $row['employee_id']]);
        $pdo->prepare('UPDATE job_assignments SET job_id = ? WHERE employee_id = ? AND ended_at IS NULL')->execute([$jobId, $row['employee_id']]);
    }

    $insert = $pdo->prepare('INSERT IGNORE INTO settings (name, value) VALUES (?, ?)');
    foreach (REOBOTE_SETTING_DEFAULTS as $name => $value) {
        $insert->execute([$name, $value]);
    }
};

// 4. Feriados nacionais fixos do ano atual e do proximo, como ponto de partida editavel.
$migrations[4] = static function (PDO $pdo): void {
    $insert = $pdo->prepare('INSERT IGNORE INTO holidays (holiday_date, name) VALUES (?, ?)');
    $year = (int) gmdate('Y');
    foreach ([$year, $year + 1] as $y) {
        foreach ([
            '01-01' => 'Confraternização Universal', '04-21' => 'Tiradentes', '05-01' => 'Dia do Trabalho',
            '09-07' => 'Independência do Brasil', '10-12' => 'Nossa Senhora Aparecida', '11-02' => 'Finados',
            '11-15' => 'Proclamação da República', '11-20' => 'Dia Nacional de Zumbi e da Consciência Negra', '12-25' => 'Natal',
        ] as $day => $name) {
            $insert->execute(["$y-$day", $name]);
        }
    }
};

// 5) Matricula do colaborador: numero ja usado pela empresa (funcionarios antigos), opcional e unico.
$migrations[5] = static function (PDO $pdo): void {
    add_column($pdo, 'employees', 'registration', 'VARCHAR(30) NULL AFTER `name`');
    add_index($pdo, 'employees', 'uq_employees_registration', 'UNIQUE INDEX `uq_employees_registration` (`registration`)');
};

$pdo->exec('CREATE TABLE IF NOT EXISTS schema_migrations (
  version INT UNSIGNED NOT NULL,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (version)
) ENGINE=InnoDB');
$applied = array_map('intval', $pdo->query('SELECT version FROM schema_migrations')->fetchAll(PDO::FETCH_COLUMN));

try {
    foreach ($migrations as $version => $migration) {
        if (in_array($version, $applied, true)) {
            continue;
        }
        echo "Aplicando migracao $version...\n";
        $migration($pdo);
        $pdo->prepare('INSERT INTO schema_migrations (version) VALUES (?)')->execute([$version]);
    }
} catch (Throwable $error) {
    fwrite(STDERR, "Falha na migracao: {$error->getMessage()}\nCorrija o problema e execute novamente; as etapas ja concluidas serao mantidas.\n");
    exit(1);
}

$storage = __DIR__ . '/storage/photos';
if (!is_dir($storage) && !mkdir($storage, 0750, true) && !is_dir($storage)) {
    fwrite(STDERR, "Nao foi possivel criar $storage. Crie a pasta manualmente com permissao de escrita para o PHP.\n");
    exit(1);
}

echo "Banco de dados atualizado com sucesso.\n";
echo "Proximo passo: crie a primeira conta de administrador com 'php server/create-user.php'.\n";
