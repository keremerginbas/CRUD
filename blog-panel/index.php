<?php
declare(strict_types=1);
require __DIR__ . '/app/bootstrap.php';

use BlogPanel\App;
use BlogPanel\Auth;

Auth::require();
$db = App::db();
$monthStart = date('Y-m-01 00:00:00');
$stats = [
    'Aktif domain' => (int) $db->value('SELECT COUNT(*) FROM domains WHERE is_active = 1') . ' / ' . (int) $db->value('SELECT COUNT(*) FROM domains'),
    'Bu ay yayınlanan' => (int) $db->value("SELECT COUNT(*) FROM posts WHERE status = 'published' AND published_at >= ?", [$monthStart]),
    'Devam eden iş' => (int) $db->value("SELECT COUNT(*) FROM jobs WHERE status IN ('queued','triggered')"),
    'Ort. SEO puanı' => (int) round((float) $db->value("SELECT AVG(seo_score) FROM posts WHERE status = 'published'")),
    'Son 7 gün hata' => (int) $db->value("SELECT COUNT(*) FROM jobs WHERE status = 'failed' AND created_at >= ?", [date('Y-m-d H:i:s', strtotime('-7 days'))]),
];
$statIcons = [
    'Aktif domain' => ['globe', 'info'], 'Bu ay yayınlanan' => ['send', 'ok'], 'Devam eden iş' => ['loader', 'warn'],
    'Ort. SEO puanı' => ['trending-up', 'violet'], 'Son 7 gün hata' => ['triangle-alert', 'err'],
];
$upcoming = $db->all('SELECT id, domain, next_post_at, publish_method FROM domains WHERE is_active = 1 ORDER BY next_post_at ASC LIMIT 10');
$recent = $db->all("SELECT p.id, p.title, p.seo_score, p.status, p.remote_url, p.created_at, d.domain FROM posts p JOIN domains d ON d.id = p.domain_id ORDER BY p.id DESC LIMIT 10");
$lastRun = App::settings()->get('scheduler_last_run');
$configured = App::settings()->get('n8n_webhook_url') !== '' && App::settings()->get('panel_base_url') !== '';

$pageTitle = 'Gösterge Paneli';
$active = 'index';
require __DIR__ . '/app/views/layout_top.php';
?>
<div class="page-head" data-head>
  <div>
    <div class="eyebrow">Genel bakış</div>
    <h1>Gösterge Paneli</h1>
    <p>Domainlerinizin yayın takvimi, son yazılar ve sistem durumu.</p>
  </div>
  <div class="actions">
    <button class="btn" data-action="run_scheduler"><?= icon('play') ?>Zamanlayıcıyı şimdi çalıştır</button>
  </div>
</div>

<?php if (!$configured): ?>
  <div class="alert alert-warn"><?= icon('triangle-alert') ?>Kurulumu tamamlamak için <a href="settings.php">Ayarlar</a> sayfasından WHM ve n8n bilgilerini girin.</div>
<?php endif; ?>
<?php if (!$lastRun || strtotime($lastRun) < time() - 3600): ?>
  <div class="alert alert-warn"><?= icon('clock') ?>Zamanlayıcı son 1 saatte çalışmamış<?= $lastRun ? ' (son: ' . e(fmt_date($lastRun)) . ')' : '' ?>. cPanel'de cron görevini kontrol edin: <code>*/15 * * * * php <?= e(__DIR__) ?>/cron/run.php</code></div>
<?php endif; ?>

<section class="stats">
  <?php foreach ($stats as $label => $value): ?>
    <?php [$ico, $tone] = $statIcons[$label] ?? ['activity', 'info']; ?>
    <div class="stat stat-<?= $tone ?>"><span class="stat-icon"><?= icon($ico) ?></span><span class="stat-label"><?= e($label) ?></span><span class="stat-value" data-count><?= e((string) $value) ?></span></div>
  <?php endforeach; ?>
</section>

<div class="grid-2 gap">
  <section class="card">
    <h2><?= icon('calendar-clock') ?>Yaklaşan paylaşımlar</h2>
    <?php if (!$upcoming): ?>
      <p class="muted">Aktif domain yok. <a href="domains.php">Domainler</a> sayfasından etkinleştirin.</p>
    <?php else: ?>
    <div class="table-wrap"><table>
      <thead><tr><th>Domain</th><th>Zaman</th><th></th></tr></thead>
      <tbody>
      <?php foreach ($upcoming as $d): ?>
        <tr>
          <td><a href="domain_edit.php?id=<?= (int) $d['id'] ?>"><?= e($d['domain']) ?></a></td>
          <td><?= e(fmt_date($d['next_post_at'])) ?></td>
          <td class="right"><button class="btn btn-sm" data-action="trigger" data-id="<?= (int) $d['id'] ?>" data-confirm="<?= e($d['domain']) ?> için şimdi yazı üretilsin mi?"><?= icon('send') ?>Şimdi paylaş</button></td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table></div>
    <?php endif; ?>
  </section>

  <section class="card">
    <h2><?= icon('newspaper') ?>Son yazılar</h2>
    <?php if (!$recent): ?>
      <p class="muted">Henüz yazı yok.</p>
    <?php else: ?>
    <div class="table-wrap"><table>
      <thead><tr><th>Başlık</th><th>SEO</th><th>Durum</th></tr></thead>
      <tbody>
      <?php foreach ($recent as $p): ?>
        <tr>
          <td><a href="post_view.php?id=<?= (int) $p['id'] ?>"><?= e($p['title']) ?></a><div class="sub"><?= e($p['domain']) ?> · <?= e(fmt_date($p['created_at'])) ?></div></td>
          <td><?= seo_badge((int) $p['seo_score']) ?></td>
          <td><?= status_badge($p['status']) ?></td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table></div>
    <?php endif; ?>
  </section>
</div>
<?php require __DIR__ . '/app/views/layout_bottom.php'; ?>
