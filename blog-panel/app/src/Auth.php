<?php
declare(strict_types=1);

namespace BlogPanel;

final class Auth
{
    public static function startSession(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }
        session_name('blogpanel');
        session_set_cookie_params([
            'httponly' => true,
            'samesite' => 'Lax',
            'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        ]);
        session_start();
    }

    public static function attempt(string $username, string $password): bool
    {
        $user = App::db()->one('SELECT * FROM users WHERE username = ?', [$username]);
        if (!$user || !password_verify($password, $user['password_hash'])) {
            usleep(random_int(400000, 900000)); // kaba kuvvet denemelerini yavaşlat
            return false;
        }
        session_regenerate_id(true);
        $_SESSION['uid'] = (int) $user['id'];
        $_SESSION['username'] = $user['username'];
        App::db()->update('users', ['last_login_at' => Database::now()], 'id = :id', ['id' => $user['id']]);
        return true;
    }

    public static function require(): void
    {
        self::startSession();
        if (empty($_SESSION['uid'])) {
            if (str_contains($_SERVER['SCRIPT_NAME'] ?? '', '/api/')) {
                json_response(['ok' => false, 'error' => 'Oturum gerekli'], 401);
            }
            redirect('login.php');
        }
    }

    public static function logout(): void
    {
        self::startSession();
        $_SESSION = [];
        session_destroy();
    }
}
