<?php
declare(strict_types=1);

namespace BlogPanel;

final class App
{
    private static array $config = [];
    private static ?Database $db = null;
    private static ?Settings $settings = null;

    public static function boot(array $config): void
    {
        self::$config = $config;
        date_default_timezone_set($config['timezone'] ?? 'Europe/Istanbul');
        self::$db = null;
        self::$settings = null;
    }

    public static function config(string $key, mixed $default = null): mixed
    {
        return self::$config[$key] ?? $default;
    }

    public static function db(): Database
    {
        return self::$db ??= new Database(self::$config['db']);
    }

    public static function settings(): Settings
    {
        return self::$settings ??= new Settings(self::db(), new Crypto((string) self::$config['app_key']));
    }

    public static function crypto(): Crypto
    {
        return new Crypto((string) self::$config['app_key']);
    }
}
