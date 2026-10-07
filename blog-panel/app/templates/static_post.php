<?php
/** @var array $domain @var array $post @var array $related */
use BlogPanel\Publisher\StaticPublisher;

$url = StaticPublisher::postUrl($domain, $post['slug']);
$blogUrl = StaticPublisher::blogUrl($domain);
$siteUrl = 'https://' . $domain['domain'] . '/';
$lang = $domain['language'] ?: 'tr';
$published = date('c', strtotime($post['published_at'] ?? 'now'));
$jsonLd = BlogPanel\Publisher\StaticRenderer::jsonLd($domain, $post, $url);
?><!doctype html>
<html lang="<?= e($lang) ?>">
<head>
<meta charset="utf-8">
<!-- <?= BlogPanel\Publisher\StaticPublisher::MARKER ?> -->
<meta name="generator" content="Blog Panel">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= e($post['meta_title'] ?: $post['title']) ?></title>
<meta name="description" content="<?= e($post['meta_description']) ?>">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="<?= e($url) ?>">
<link rel="alternate" type="application/rss+xml" title="<?= e($domain['domain']) ?> Blog" href="<?= e($blogUrl) ?>feed.xml">
<meta property="og:type" content="article">
<meta property="og:title" content="<?= e($post['meta_title'] ?: $post['title']) ?>">
<meta property="og:description" content="<?= e($post['meta_description']) ?>">
<meta property="og:url" content="<?= e($url) ?>">
<meta property="og:site_name" content="<?= e($domain['domain']) ?>">
<meta property="og:locale" content="<?= e($lang === 'tr' ? 'tr_TR' : $lang) ?>">
<meta property="article:published_time" content="<?= e($published) ?>">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json"><?= $jsonLd ?></script>
<?php require __DIR__ . '/_static_style.php'; ?>
<?= $domain['static_extra_head'] ?? '' ?>
</head>
<body>
<div class="wrap">
  <nav class="crumbs"><a href="/">Ana Sayfa</a> › <a href="<?= e($blogUrl) ?>">Blog</a></nav>
  <article>
    <h1><?= e($post['title']) ?></h1>
    <p class="meta"><time datetime="<?= e($published) ?>"><?= e(date('d.m.Y', strtotime($published))) ?></time></p>
    <?php if (!empty($post['excerpt'])): ?><p class="lead"><?= e($post['excerpt']) ?></p><?php endif; ?>
    <?= $post['content_html'] ?>
    <?php if (!empty($post['faq'])): ?>
    <section class="faq">
      <h2>Sıkça Sorulan Sorular</h2>
      <?php foreach ($post['faq'] as $f): ?>
      <details><summary><?= e($f['question']) ?></summary><p><?= e($f['answer']) ?></p></details>
      <?php endforeach; ?>
    </section>
    <?php endif; ?>
  </article>
  <?php if ($related): ?>
  <aside class="related">
    <h2>Diğer Yazılar</h2>
    <ul><?php foreach ($related as $r): ?><li><a href="<?= e($blogUrl . $r['slug']) ?>"><?= e($r['title']) ?></a></li><?php endforeach; ?></ul>
  </aside>
  <?php endif; ?>
  <footer>© <?= date('Y') ?> <a href="/"><?= e($domain['domain']) ?></a></footer>
</div>
</body>
</html>
