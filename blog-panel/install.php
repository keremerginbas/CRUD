<?php
declare(strict_types=1);

/**
 * Kurulum: config.php oluşturur, tabloları kurar, yönetici hesabı açar.
 * Web:  https://panel.alanadiniz.com/install.php
 * CLI:  php install.php --driver=sqlite --admin=admin --password=GizliSifre
 *       php install.php --driver=mysql --host=localhost --name=db --user=u --pass=p --admin=admin --password=...
 */

define('APP_ROOT', __DIR__);
spl_autoload_register(static function (string $class): void {
    if (str_starts_with($class, 'BlogPanel\\')) {
        $file = __DIR__ . '/app/src/' . str_replace('\\', '/', substr($class, 10)) . '.php';
        if (is_file($file)) {
            require $file;
        }
    }
});
require __DIR__ . '/app/helpers.php';

$configFile = getenv('BLOG_PANEL_CONFIG') ?: __DIR__ . '/config.php';
$isCli = PHP_SAPI === 'cli';

/** @return string[] eksik gereksinimler */
function missing_requirements(string $driver = ''): array
{
    $missing = [];
    if (PHP_VERSION_ID < 80100) {
        $missing[] = 'PHP 8.1 veya üstü (şu an ' . PHP_VERSION . ')';
    }
    foreach (['pdo' => 'pdo', 'curl' => 'curl', 'mbstring' => 'mbstring', 'dom' => 'dom', 'json' => 'json'] as $ext => $label) {
        if (!extension_loaded($ext)) {
            $missing[] = "$label eklentisi";
        }
    }
    if (!extension_loaded('sodium') && !extension_loaded('openssl')) {
        $missing[] = 'sodium veya openssl eklentisi';
    }
    if ($driver === 'sqlite' && !extension_loaded('pdo_sqlite')) {
        $missing[] = 'pdo_sqlite eklentisi (SQLite için)';
    }
    if ($driver === 'mysql' && !extension_loaded('pdo_mysql')) {
        $missing[] = 'pdo_mysql eklentisi (MySQL için)';
    }
    if (!extension_loaded('pdo_sqlite') && !extension_loaded('pdo_mysql')) {
        $missing[] = 'pdo_mysql veya pdo_sqlite eklentisi';
    }
    return $missing;
}

function do_install(array $in, string $configFile): void
{
    $missing = missing_requirements(($in['driver'] ?? 'mysql') === 'sqlite' ? 'sqlite' : 'mysql');
    if ($missing) {
        throw new RuntimeException('Sunucuda eksik: ' . implode(', ', $missing) . '. cPanel > Select PHP Version > Extensions bölümünden açın.');
    }
    if (strlen($in['password'] ?? '') < 10) {
        throw new RuntimeException('Yönetici şifresi en az 10 karakter olmalı.');
    }
    if (!preg_match('/^[a-zA-Z0-9_.-]{3,64}$/', $in['admin'] ?? '')) {
        throw new RuntimeException('Kullanıcı adı 3-64 karakter (harf, rakam, _ . -) olmalı.');
    }
    $driver = ($in['driver'] ?? 'mysql') === 'sqlite' ? 'sqlite' : 'mysql';
    $config = [
        'db' => [
            'driver' => $driver,
            'host' => $in['host'] ?? 'localhost',
            'port' => (int) ($in['port'] ?? 3306),
            'name' => $in['name'] ?? '',
            'user' => $in['user'] ?? '',
            'pass' => $in['pass'] ?? '',
            'path' => $in['path'] ?? (__DIR__ . '/storage/panel.sqlite'),
        ],
        'app_key' => base64_encode(random_bytes(32)),
        'timezone' => $in['timezone'] ?? 'Europe/Istanbul',
    ];
    BlogPanel\App::boot($config);
    $db = BlogPanel\App::db(); // bağlantıyı dener
    BlogPanel\Schema::install($db);
    $db->run('DELETE FROM users WHERE username = ?', [$in['admin']]);
    $db->insert('users', [
        'username' => $in['admin'],
        'password_hash' => password_hash($in['password'], PASSWORD_DEFAULT),
        'created_at' => BlogPanel\Database::now(),
    ]);
    if (!empty($in['base_url'])) {
        BlogPanel\App::settings()->set('panel_base_url', rtrim($in['base_url'], '/'));
    }
    BlogPanel\App::settings()->set('n8n_secret', bin2hex(random_bytes(24)));

    $php = "<?php\n// install.php tarafından oluşturuldu: " . date('c') . "\nreturn " . var_export($config, true) . ";\n";
    if (file_put_contents($configFile, $php) === false) {
        throw new RuntimeException("config.php yazılamadı: $configFile");
    }
    @chmod($configFile, 0600);
}

if ($isCli) {
    $opts = getopt('', ['driver:', 'host:', 'port:', 'name:', 'user:', 'pass:', 'path:', 'admin:', 'password:', 'base_url:', 'timezone:']);
    if (is_file($configFile)) {
        fwrite(STDERR, "config.php zaten var, kurulum yapılmadı.\n");
        exit(1);
    }
    try {
        do_install($opts, $configFile);
        echo "Kurulum tamamlandı.\n";
        exit(0);
    } catch (Throwable $e) {
        fwrite(STDERR, 'Hata: ' . $e->getMessage() . "\n");
        exit(1);
    }
}

$error = null;
$done = false;
if (is_file($configFile)) {
    $done = true;
} elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
    try {
        $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        $base = $scheme . '://' . $_SERVER['HTTP_HOST'] . rtrim(dirname($_SERVER['SCRIPT_NAME']), '/');
        do_install($_POST + ['base_url' => $base], $configFile);
        $done = true;
    } catch (Throwable $e) {
        $error = $e->getMessage();
    }
}
?><!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Blog Panel Kurulum</title>
<link rel="stylesheet" href="assets/css/panel.css">
</head>
<body class="auth-page">
<main class="auth-card wide">
  <h1>Blog Panel Kurulumu</h1>
  <?php if ($done): ?>
    <div class="alert alert-ok">Kurulum tamamlandı. Güvenlik için <code>install.php</code> dosyasını silin.</div>
    <p><a class="btn btn-primary" href="login.php">Giriş yap</a></p>
  <?php else: ?>
    <?php if ($error): ?><div class="alert alert-err"><?= e($error) ?></div><?php endif; ?>
    <?php if ($missing = missing_requirements()): ?>
      <div class="alert alert-warn">Sunucuda eksik: <?= e(implode(', ', $missing)) ?>. cPanel &gt; Select PHP Version &gt; Extensions bölümünden açın.</div>
    <?php endif; ?>
    <?php $driverSel = ($_POST['driver'] ?? 'mysql') === 'sqlite' ? 'sqlite' : 'mysql'; ?>
    <form method="post" class="form">
      <fieldset>
        <legend>Veritabanı</legend>
        <label>Sürücü
          <select name="driver" data-toggle-driver>
            <option value="mysql" <?= $driverSel === 'mysql' ? 'selected' : '' ?>>MySQL / MariaDB</option>
            <option value="sqlite" <?= $driverSel === 'sqlite' ? 'selected' : '' ?>>SQLite (tek dosya, ek veritabanı gerektirmez)</option>
          </select>
        </label>
        <div data-mysql <?= $driverSel === 'sqlite' ? 'hidden' : '' ?>>
          <div class="grid-2">
            <label>Sunucu <input name="host" value="localhost"></label>
            <label>Port <input name="port" value="3306" inputmode="numeric"></label>
          </div>
          <label>Veritabanı adı <input name="name" placeholder="cpuser_blogpanel" value="<?= e($_POST['name'] ?? '') ?>"></label>
          <div class="grid-2">
            <label>Kullanıcı <input name="user" autocomplete="off" value="<?= e($_POST['user'] ?? '') ?>"></label>
            <label>Şifre <input name="pass" type="password" autocomplete="new-password"></label>
          </div>
        </div>
      </fieldset>
      <fieldset>
        <legend>Yönetici hesabı</legend>
        <label>Kullanıcı adı <input name="admin" required value="admin"></label>
        <label>Şifre (en az 10 karakter) <input name="password" type="password" required minlength="10" autocomplete="new-password"></label>
      </fieldset>
      <button class="btn btn-primary" type="submit">Kur</button>
    </form>
  <?php endif; ?>
</main>
<script>
document.querySelector('[data-toggle-driver]')?.addEventListener('change', e => {
  document.querySelector('[data-mysql]').hidden = e.target.value === 'sqlite';
});
</script>
</body>
</html>
