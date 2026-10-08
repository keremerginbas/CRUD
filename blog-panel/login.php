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
<meta name="theme-color" content="#09090b">
<link rel="stylesheet" href="assets/css/app.css?v=3">
<script>if(!matchMedia('(prefers-reduced-motion: reduce)').matches){document.documentElement.classList.add('js-motion');setTimeout(function(){document.documentElement.classList.remove('js-motion')},2500)}</script>
</head>
<body class="auth-page">
<div class="backdrop" aria-hidden="true">
  <div class="bg-grid" data-parallax="0.12"></div>
  <div class="blob blob-1" data-mouse="-40"></div>
  <div class="blob blob-2" data-mouse="30"></div>
  <div class="blob blob-3" data-mouse="-20"></div>
  <div class="noise"></div>
</div>
<main class="auth-card" data-tilt>
  <div class="brand"><span class="logo"><?= icon('sparkles') ?></span><span>Blog Panel<small>Otomatik SEO yayın</small></span></div>
  <h1>Tekrar hoş geldiniz</h1>
  <p class="auth-sub">Devam etmek için panel hesabınızla giriş yapın.</p>
  <?php if ($error): ?><div class="alert alert-err"><?= icon('circle-x') ?><?= e($error) ?></div><?php endif; ?>
  <form method="post" class="form">
    <?= csrf_field() ?>
    <label>Kullanıcı adı <input name="username" required autofocus autocomplete="username"></label>
    <label>Şifre <input name="password" type="password" required autocomplete="current-password"></label>
    <button class="btn btn-primary btn-block" type="submit">Giriş yap<?= icon('arrow-right') ?></button>
  </form>
</main>
<?php require __DIR__ . '/app/views/scripts.php'; ?>
</body>
</html>
