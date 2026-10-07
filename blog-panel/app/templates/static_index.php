<?php
/** @var array $domain @var array $posts */
use BlogPanel\Publisher\StaticPublisher;

$blogUrl = StaticPublisher::blogUrl($domain);
$lang = $domain['language'] ?: 'tr';
$title = $domain['domain'] . ' Blog' . ($domain['niche'] ? ' – ' . $domain['niche'] : '');
$desc = $domain['niche'] ? $domain['niche'] . ' hakkında güncel rehberler, ipuçları ve haberler.' : $domain['domain'] . ' blog yazıları.';
?><!doctype html>
<html lang="<?= e($lang) ?>">
<head>
<meta charset="utf-8">
<!-- <?= BlogPanel\Publisher\StaticPublisher::MARKER ?> -->
<meta name="generator" content="Blog Panel">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= e($title) ?></title>
<meta name="description" content="<?= e(mb_substr($desc, 0, 160)) ?>">
<link rel="canonical" href="<?= e($blogUrl) ?>">
<link rel="alternate" type="application/rss+xml" title="<?= e($domain['domain']) ?> Blog" href="<?= e($blogUrl) ?>feed.xml">
<meta property="og:type" content="website">
<meta property="og:title" content="<?= e($title) ?>">
<meta property="og:url" content="<?= e($blogUrl) ?>">
<?php require __DIR__ . '/_static_style.php'; ?>
<?= $domain['static_extra_head'] ?? '' ?>
</head>
<body>
<div class="wrap">
  <nav class="crumbs"><a href="/">Ana Sayfa</a> › Blog</nav>
  <h1>Blog</h1>
  <div class="list">
    <?php foreach ($posts as $p): ?>
    <article>
      <h2><a href="<?= e($blogUrl . $p['slug']) ?>"><?= e($p['title']) ?></a></h2>
      <p class="meta"><?= e(date('d.m.Y', strtotime($p['published_at'] ?? 'now'))) ?></p>
      <p><?= e($p['excerpt'] ?? '') ?></p>
    </article>
    <?php endforeach; ?>
  </div>
  <footer>© <?= date('Y') ?> <a href="/"><?= e($domain['domain']) ?></a></footer>
</div>
</body>
</html>
