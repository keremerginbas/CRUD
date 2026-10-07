<?php
declare(strict_types=1);

namespace BlogPanel;

final class Logger
{
    public static function info(string $context, string $message): void
    {
        self::write('info', $context, $message);
    }

    public static function error(string $context, string $message): void
    {
        self::write('error', $context, $message);
    }

    private static function write(string $level, string $context, string $message): void
    {
        try {
            App::db()->insert('logs', [
                'level' => $level,
                'context' => $context,
                'message' => mb_substr($message, 0, 4000),
                'created_at' => Database::now(),
            ]);
        } catch (\Throwable $e) {
            error_log("[blog-panel][$level][$context] $message");
        }
    }
}
