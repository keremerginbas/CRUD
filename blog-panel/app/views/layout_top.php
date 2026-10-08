<?php
/** @var string $pageTitle @var string $active */
$nav = [
    'index' => ['index.php', 'Gösterge Paneli', 'dashboard'],
    'domains' => ['domains.php', 'Domainler', 'globe'],
    'posts' => ['posts.php', 'Yazılar', 'file'],
    'jobs' => ['jobs.php', 'İşler & Kayıtlar', 'activity'],
    'settings' => ['settings.php', 'Ayarlar', 'settings'],
];
$user = (string) ($_SESSION['username'] ?? '');
?><!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="csrf-token" content="<?= e(csrf_token()) ?>">
<title><?= e($pageTitle) ?> · Blog Panel</title>
<link rel="stylesheet" href="assets/css/panel.css?v=2">
</head>
<body class="app">
<aside class="sidebar" data-nav>
  <a class="brand" href="index.php"><span class="logo"><?= icon('spark') ?></span><span>Blog Panel<small>Otomatik SEO yayın</small></span></a>
  <nav class="side-nav">
    <span class="side-label">Menü</span>
    <?php foreach ($nav as $key => [$href, $label, $ico]): ?>
      <a href="<?= $href ?>" class="<?= $active === $key ? 'active' : '' ?>"><?= icon($ico) ?><span><?= e($label) ?></span></a>
    <?php endforeach; ?>
  </nav>
  <div class="side-foot">
    <span class="avatar"><?= e(mb_strtoupper(mb_substr($user, 0, 1)) ?: '?') ?></span>
    <span class="who"><b><?= e($user) ?></b><small>Yönetici</small></span>
    <a href="logout.php" class="logout" title="Çıkış yap" aria-label="Çıkış yap"><?= icon('logout') ?></a>
  </div>
</aside>
<div class="nav-backdrop" data-nav-toggle></div>
<div class="app-main">
<header class="mobilebar">
  <button class="nav-toggle" aria-label="Menü" data-nav-toggle><?= icon('menu') ?></button>
  <a class="brand" href="index.php"><span class="logo"><?= icon('spark') ?></span><span>Blog Panel</span></a>
</header>
<main class="container">
<?php foreach (flash() as $f): ?>
  <div class="alert alert-<?= e($f['type']) ?>"><?= e($f['msg']) ?></div>
<?php endforeach; ?>
