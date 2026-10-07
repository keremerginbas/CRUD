<?php
declare(strict_types=1);
require __DIR__ . '/app/bootstrap.php';

use BlogPanel\App;
use BlogPanel\Auth;

Auth::require();
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['do'] ?? '') === 'delete') {
    csrf_check();
    App::db()->run('DELETE FROM posts WHERE id = ?', [(int) ($_GET['id'] ?? 0)]);
    flash('ok', 'Yazı kaydı panelden silindi. Sitedeki dosyayı File Manager üzerinden ayrıca silin.');
    redirect('posts.php');
}
$post = App::db()->one('SELECT p.*, d.domain FROM posts p JOIN domains d ON d.id = p.domain_id WHERE p.id = ?', [(int) ($_GET['id'] ?? 0)]);
if (!$post) {
    http_response_code(404);
    exit('Yazı bulunamadı.');
}
$seo = json_decode((string) $post['seo_report'], true) ?: ['checks' => [], 'word_count' => 0];
$faq = json_decode((string) $post['faq_json'], true) ?: [];

$pageTitle = $post['title'];
$active = 'posts';
require __DIR__ . '/app/views/layout_top.php';
?>
<div class="page-head">
  <div>
    <h1><?= e($post['title']) ?></h1>
    <p class="muted"><?= e($post['domain']) ?> · <?= status_badge($post['status']) ?> · <?= e(fmt_date($post['published_at'] ?: $post['created_at'])) ?></p>
  </div>
  <div class="actions">
    <?php if ($post['remote_url']): ?><a class="btn" href="<?= e($post['remote_url']) ?>" target="_blank" rel="noopener">Sitede görüntüle ↗</a><?php endif; ?>
    <form method="post" class="inline-form">
      <?= csrf_field() ?>
      <button class="btn btn-danger" type="submit" name="do" value="delete" data-confirm-submit="Yazı kaydı panelden silinsin mi? Sitedeki dosya silinmez.">Kaydı sil</button>
    </form>
  </div>
</div>
<?php if ($post['error']): ?><div class="alert alert-err"><?= e($post['error']) ?></div><?php endif; ?>

<div class="grid-side gap">
  <section class="card">
    <div class="serp">
      <div class="serp-url"><?= e($post['remote_url'] ?: 'https://' . $post['domain'] . '/blog/' . $post['slug']) ?></div>
      <div class="serp-title"><?= e($post['meta_title']) ?></div>
      <div class="serp-desc"><?= e($post['meta_description']) ?></div>
    </div>
    <article class="preview">
      <?php if ($post['excerpt']): ?><p class="lead"><?= e($post['excerpt']) ?></p><?php endif; ?>
      <?= $post['content_html'] /* HtmlSanitizer'dan geçmiş içerik */ ?>
      <?php if ($faq): ?>
        <h2>Sıkça Sorulan Sorular</h2>
        <?php foreach ($faq as $f): ?><h3><?= e($f['question']) ?></h3><p><?= e($f['answer']) ?></p><?php endforeach; ?>
      <?php endif; ?>
    </article>
  </section>
  <aside class="card">
    <h2>SEO puanı <?= seo_badge((int) $post['seo_score']) ?></h2>
    <p class="muted"><?= (int) $seo['word_count'] ?> kelime · Odak: <strong><?= e($post['focus_keyword']) ?></strong></p>
    <ul class="checks">
      <?php foreach ($seo['checks'] as $c): ?>
        <li class="<?= $c['ok'] ? 'ok' : 'fail' ?>"><span><?= $c['ok'] ? '✓' : '✗' ?></span> <?= e($c['label']) ?><?php if ($c['detail'] !== ''): ?><small><?= e($c['detail']) ?></small><?php endif; ?></li>
      <?php endforeach; ?>
    </ul>
    <h3>Anahtar kelimeler</h3>
    <p><?= e($post['keywords']) ?></p>
    <h3>Etiketler</h3>
    <p><?= e($post['tags']) ?: '—' ?></p>
  </aside>
</div>
<?php require __DIR__ . '/app/views/layout_bottom.php'; ?>
