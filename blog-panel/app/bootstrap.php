<?php
declare(strict_types=1);

define('APP_ROOT', dirname(__DIR__));

spl_autoload_register(static function (string $class): void {
    $prefix = 'BlogPanel\\';
    if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
        return;
    }
    $file = APP_ROOT . '/app/src/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
    if (is_file($file)) {
        require $file;
    }
});

require APP_ROOT . '/app/helpers.php';

$configFile = getenv('BLOG_PANEL_CONFIG') ?: APP_ROOT . '/config.php';
if (!is_file($configFile)) {
    if (PHP_SAPI === 'cli') {
        fwrite(STDERR, "config.php bulunamadı. Önce install.php çalıştırın.\n");
        exit(1);
    }
    header('Location: ' . (str_contains($_SERVER['SCRIPT_NAME'] ?? '', '/api/') ? '../' : '') . 'install.php');
    exit;
}

BlogPanel\App::boot(require $configFile);
BlogPanel\Schema::migrate(BlogPanel\App::db());
