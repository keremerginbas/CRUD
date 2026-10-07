<?php
declare(strict_types=1);
require __DIR__ . '/app/bootstrap.php';

use BlogPanel\App;
use BlogPanel\Auth;

Auth::require();
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['do'] ?? '') === 'unpublish') {
    csrf_check();
    $row = App::db()->one('SELECT * FROM posts WHERE id = ?', [(int) ($_GET['id'] ?? 0)]);
    $domainRow = $row ? App::db()->one('SELECT * FROM domains WHERE id = ?', [$row['domain_id']]) : null;
    if ($row && $domainRow) {
        try {
            $remaining = App::db()->all("SELECT title, slug, excerpt, published_at, remote_url FROM posts WHERE domain_id = ? AND status = 'published' AND id <> ? ORDER BY published_at DESC", [$row['domain_id'], $row['id']]);
            $message = BlogPanel\Publisher\PublisherFactory::for($domainRow)->unpublish($domainRow, $row, $remaining);
            App::db()->run('DELETE FROM posts WHERE id = ?', [$row['id']]);
            BlogPanel\Logger::info('publish', "{$domainRow['domain']}: \"{$row['title']}\" siteden kaldırıldı. $message");
            flash('ok', "Yazı siteden kaldırıldı ve kaydı silindi. $message");
            redirect('posts.php');
        } catch (Throwable $e) {
            flash('err', 'Siteden kaldırılamadı: ' . $e->getMessage());
            redirect('post_view.php?id=' . (int) $row['id']);
        }
    }
}
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
      <?php if ($post['status'] === 'published'): ?>
        <button class="btn btn-danger" type="submit" name="do" value="unpublish" data-confirm-submit="Yazı siteden kaldırılsın mı? Dosyası silinir, liste/sitemap/RSS kayıtları temizlenir ve panel kaydı silinir.">Siteden kaldır</button>
      <?php endif; ?>
      <button class="btn" type="submit" name="do" value="delete" data-confirm-submit="Yalnızca panel kaydı silinsin mi? Sitedeki dosya olduğu gibi kalır.">Yalnızca kaydı sil</button>
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
