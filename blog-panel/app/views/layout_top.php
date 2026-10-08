<?php
/** @var string $pageTitle @var string $active */
$nav = [
    'index' => ['index.php', 'Gösterge Paneli', 'layout-dashboard'],
    'domains' => ['domains.php', 'Domainler', 'globe'],
    'posts' => ['posts.php', 'Yazılar', 'file-text'],
    'jobs' => ['jobs.php', 'İşler & Kayıtlar', 'activity'],
    'settings' => ['settings.php', 'Ayarlar', 'settings'],
];
$user = (string) ($_SESSION['username'] ?? '');
$lastRun = \BlogPanel\App::settings()->get('scheduler_last_run');
$cronOk = $lastRun && strtotime($lastRun) >= time() - 3600;
$nextUp = \BlogPanel\App::db()->one('SELECT domain, next_post_at FROM domains WHERE is_active = 1 AND next_post_at IS NOT NULL ORDER BY next_post_at ASC LIMIT 1');
?><!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="csrf-token" content="<?= e(csrf_token()) ?>">
<meta name="theme-color" content="#09090b">
<title><?= e($pageTitle) ?> · Blog Panel</title>
<link rel="preload" href="assets/vendor/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="assets/css/app.css?v=3">
<script>if(!matchMedia('(prefers-reduced-motion: reduce)').matches){document.documentElement.classList.add('js-motion');setTimeout(function(){document.documentElement.classList.remove('js-motion')},2500)}</script>
</head>
<body class="app">
<div class="backdrop" aria-hidden="true">
  <div class="bg-grid" data-parallax="0.12"></div>
  <div class="blob blob-1" data-parallax="-0.35"></div>
  <div class="blob blob-2" data-parallax="0.25"></div>
  <div class="blob blob-3" data-parallax="-0.2"></div>
  <div class="noise"></div>
</div>
<aside class="sidebar" data-nav>
  <a class="brand" href="index.php"><span class="logo"><?= icon('sparkles') ?></span><span>Blog Panel<small>Otomatik SEO yayın</small></span></a>
  <nav class="side-nav" data-glide>
    <span class="side-label">Menü</span>
    <span class="nav-glider" data-glider></span>
    <?php foreach ($nav as $key => [$href, $label, $ico]): ?>
      <a href="<?= $href ?>" class="<?= $active === $key ? 'active' : '' ?>"><?= icon($ico) ?><span><?= e($label) ?></span></a>
    <?php endforeach; ?>
  </nav>
  <?php if ($nextUp): ?>
  <div class="side-card">
    <b>Sıradaki yayın</b>
    <span><?= e($nextUp['domain']) ?><br><?= e(fmt_date($nextUp['next_post_at'])) ?></span>
  </div>
  <?php endif; ?>
  <div class="side-foot">
    <span class="avatar"><?= e(mb_strtoupper(mb_substr($user, 0, 1)) ?: '?') ?></span>
    <span class="who"><b><?= e($user) ?></b><small>Yönetici</small></span>
    <a href="logout.php" class="logout" title="Çıkış yap" aria-label="Çıkış yap"><?= icon('log-out') ?></a>
  </div>
</aside>
<div class="nav-backdrop" data-nav-toggle></div>
<div class="app-main">
<header class="topbar">
  <button class="nav-toggle" type="button" aria-label="Menü" data-nav-toggle><?= icon('menu') ?></button>
  <a class="brand" href="index.php"><span class="logo"><?= icon('sparkles') ?></span><span>Blog Panel</span></a>
  <nav class="crumbs" aria-label="Konum"><span>Blog Panel</span><?= icon('chevron-right') ?><b><?= e($pageTitle) ?></b></nav>
  <div class="topbar-right">
    <span class="status-pill<?= $cronOk ? '' : ' warn' ?>" title="Zamanlayıcının son çalışması: <?= e(fmt_date($lastRun)) ?>"><i></i><?= $cronOk ? 'Zamanlayıcı çalışıyor' : 'Zamanlayıcı beklemede' ?></span>
  </div>
</header>
<main class="container">
<?php foreach (flash() as $f): ?>
  <div class="alert alert-<?= e($f['type']) ?>" data-flash="<?= e($f['type']) ?>"><?= icon($f['type'] === 'ok' ? 'circle-check' : ($f['type'] === 'err' ? 'circle-x' : 'triangle-alert')) ?><span><?= e($f['msg']) ?></span></div>
<?php endforeach; ?>
