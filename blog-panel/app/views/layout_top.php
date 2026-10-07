<?php
/** @var string $pageTitle @var string $active */
$nav = [
    'index' => ['index.php', 'Gösterge Paneli'],
    'domains' => ['domains.php', 'Domainler'],
    'posts' => ['posts.php', 'Yazılar'],
    'jobs' => ['jobs.php', 'İşler & Kayıtlar'],
    'settings' => ['settings.php', 'Ayarlar'],
];
?><!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="csrf-token" content="<?= e(csrf_token()) ?>">
<title><?= e($pageTitle) ?> · Blog Panel</title>
<link rel="stylesheet" href="assets/css/panel.css">
</head>
<body>
<header class="topbar">
  <a class="brand" href="index.php"><span class="logo">B</span> Blog Panel</a>
  <button class="nav-toggle" aria-label="Menü" data-nav-toggle>☰</button>
  <nav class="nav" data-nav>
    <?php foreach ($nav as $key => [$href, $label]): ?>
      <a href="<?= $href ?>" class="<?= $active === $key ? 'active' : '' ?>"><?= e($label) ?></a>
    <?php endforeach; ?>
    <a href="logout.php" class="muted">Çıkış (<?= e($_SESSION['username'] ?? '') ?>)</a>
  </nav>
</header>
<main class="container">
<?php foreach (flash() as $f): ?>
  <div class="alert alert-<?= e($f['type']) ?>"><?= e($f['msg']) ?></div>
<?php endforeach; ?>
