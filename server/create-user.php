<?php
// REOBOTE | server/create-user.php — Servidor: cria o primeiro administrador pelo terminal
declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/lib/auth.php';

// Cria contas pelo terminal. Use para o primeiro administrador; os demais acessos sao criados pela Central.
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

// Mostra uma pergunta no terminal e devolve a resposta digitada.
function prompt(string $label): string
{
    fwrite(STDOUT, $label);
    return trim((string) fgets(STDIN));
}

try {
    $pdo = reobote_db();
    $name = prompt('Nome completo: ');
    $email = mb_strtolower(prompt('E-mail de acesso: '));
    $phone = prompt('Telefone (opcional): ');
    $role = prompt('Perfil (admin/dispatcher/employee) [admin]: ') ?: 'admin';

    $jobs = $pdo->query('SELECT id, name FROM jobs ORDER BY name')->fetchAll();
    if (!$jobs) {
        throw new RuntimeException('Nenhum cargo cadastrado. Execute php server/setup.php antes.');
    }
    foreach ($jobs as $job) {
        fwrite(STDOUT, "  [{$job['id']}] {$job['name']}\n");
    }
    $jobId = prompt('Numero do cargo: ');
    $password = prompt('Senha (minimo 10 caracteres, com letras e numeros): ');

    if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || !array_key_exists($role, REOBOTE_ROLES)
        || !in_array($jobId, array_map('strval', array_column($jobs, 'id')), true)
        || strlen($password) < 10 || !preg_match('/[A-Za-z]/', $password) || !preg_match('/\d/', $password)) {
        throw new RuntimeException('Dados invalidos. Confira e-mail, perfil, cargo e senha.');
    }

    $pdo->beginTransaction();
    try {
        $pdo->prepare("INSERT INTO employees (name, email, phone, job_id, status) VALUES (?, ?, ?, ?, 'Offline')")
            ->execute([$name, $email, $phone ?: null, $jobId]);
        $employeeId = $pdo->lastInsertId();
        $pdo->prepare('INSERT INTO users (employee_id, email, password_hash, role, must_change_password, password_changed_at) VALUES (?, ?, ?, ?, 0, UTC_TIMESTAMP())')
            ->execute([$employeeId, $email, password_hash($password, PASSWORD_DEFAULT), $role]);
        $pdo->prepare('INSERT INTO job_assignments (employee_id, job_id, title) SELECT ?, id, name FROM jobs WHERE id = ?')
            ->execute([$employeeId, $jobId]);
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
    echo "Conta criada para $email (perfil " . REOBOTE_ROLES[$role] . ").\n";
} catch (Throwable $error) {
    fwrite(STDERR, "Nao foi possivel criar a conta: {$error->getMessage()}\n");
    exit(1);
}
