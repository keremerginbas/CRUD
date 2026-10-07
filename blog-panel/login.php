<?php
declare(strict_types=1);
require __DIR__ . '/app/bootstrap.php';

use BlogPanel\Auth;

Auth::startSession();
$error = null;
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_check();
    if (Auth::attempt(trim((string) ($_POST['username'] ?? '')), (string) ($_POST['password'] ?? ''))) {
        redirect('index.php');
    }
    $error = 'Kullanıcı adı veya şifre hatalı.';
}
?><!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Giriş · Blog Panel</title>
<link rel="stylesheet" href="assets/css/panel.css">
</head>
<body class="auth-page">
<main class="auth-card">
  <div class="brand"><span class="logo">B</span> Blog Panel</div>
  <?php if ($error): ?><div class="alert alert-err"><?= e($error) ?></div><?php endif; ?>
  <form method="post" class="form">
    <?= csrf_field() ?>
    <label>Kullanıcı adı <input name="username" required autofocus autocomplete="username"></label>
    <label>Şifre <input name="password" type="password" required autocomplete="current-password"></label>
    <button class="btn btn-primary btn-block" type="submit">Giriş yap</button>
  </form>
</main>
</body>
</html>
