<?php
declare(strict_types=1);
require __DIR__ . '/app/bootstrap.php';

use BlogPanel\App;
use BlogPanel\Auth;
use BlogPanel\Publisher\PublisherFactory;

Auth::require();
$q = trim((string) ($_GET['q'] ?? ''));
$filter = (string) ($_GET['f'] ?? '');
$where = '1=1';
$params = [];
if ($q !== '') {
    $where .= ' AND (d.domain LIKE ? OR d.niche LIKE ?)';
    $params[] = "%$q%";
    $params[] = "%$q%";
}
if ($filter === 'active') {
    $where .= ' AND d.is_active = 1';
} elseif ($filter === 'passive') {
    $where .= ' AND d.is_active = 0';
}
$domains = App::db()->all(
    "SELECT d.*, (SELECT COUNT(*) FROM posts p WHERE p.domain_id = d.id AND p.status = 'published') AS post_count,
            (SELECT j.status FROM jobs j WHERE j.domain_id = d.id ORDER BY j.id DESC LIMIT 1) AS last_job_status
     FROM domains d WHERE $where ORDER BY d.is_active DESC, d.domain ASC",
    $params
);

$pageTitle = 'Domainler';
$active = 'domains';
require __DIR__ . '/app/views/layout_top.php';
?>
<div class="page-head">
  <h1>Domainler <span class="muted">(<?= count($domains) ?>)</span></h1>
  <div class="actions">
    <a class="btn" href="domain_edit.php">+ Elle ekle</a>
    <button class="btn btn-primary" data-action="sync_whm">WHM'den senkronize et</button>
  </div>
</div>

<form class="filters" method="get">
  <input name="q" value="<?= e($q) ?>" placeholder="Domain veya sektör ara">
  <select name="f">
    <option value="">Tümü</option>
    <option value="active" <?= $filter === 'active' ? 'selected' : '' ?>>Aktif</option>
    <option value="passive" <?= $filter === 'passive' ? 'selected' : '' ?>>Pasif</option>
  </select>
  <button class="btn" type="submit">Filtrele</button>
</form>

<?php if (!$domains): ?>
  <div class="card empty">
    <p>Henüz domain yok. WHM bağlantısını <a href="settings.php">Ayarlar</a>'dan yapıp <strong>WHM'den senkronize et</strong> butonuna basın.</p>
  </div>
<?php else: ?>
<div class="card table-wrap">
<table>
  <thead><tr><th>Domain</th><th>Durum</th><th>Yöntem</th><th>Sıklık</th><th>Sonraki</th><th>Son</th><th>Yazı</th><th></th></tr></thead>
  <tbody>
  <?php foreach ($domains as $d): ?>
    <tr>
      <td>
        <a href="domain_edit.php?id=<?= (int) $d['id'] ?>"><strong><?= e($d['domain']) ?></strong></a>
        <div class="sub"><?= e($d['niche'] ?: 'Sektör tanımlı değil') ?> · <?= e($d['cpanel_user'] ?: '-') ?></div>
      </td>
      <td>
        <label class="switch" title="Otomatik paylaşım">
          <input type="checkbox" data-action="toggle" data-id="<?= (int) $d['id'] ?>" <?= $d['is_active'] ? 'checked' : '' ?>>
          <span></span>
        </label>
        <?= $d['last_job_status'] ? status_badge($d['last_job_status']) : '' ?>
      </td>
      <td><?= e(explode(' (', PublisherFactory::METHODS[$d['publish_method']] ?? $d['publish_method'])[0]) ?></td>
      <td class="nowrap"><?= (int) $d['post_interval_days'] ?> günde 1</td>
      <td><?= $d['is_active'] ? e(fmt_date($d['next_post_at'])) : '<span class="muted">—</span>' ?></td>
      <td><?= e(fmt_date($d['last_post_at'])) ?></td>
      <td><?= (int) $d['post_count'] ?></td>
      <td class="right nowrap">
        <button class="btn btn-sm" data-action="trigger" data-id="<?= (int) $d['id'] ?>" data-confirm="<?= e($d['domain']) ?> için şimdi yazı üretilsin mi?">Şimdi paylaş</button>
        <a class="btn btn-sm btn-ghost" href="domain_edit.php?id=<?= (int) $d['id'] ?>">Düzenle</a>
      </td>
    </tr>
  <?php endforeach; ?>
  </tbody>
</table>
</div>
<?php endif; ?>
<?php require __DIR__ . '/app/views/layout_bottom.php'; ?>
