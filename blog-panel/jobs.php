<?php
declare(strict_types=1);
require __DIR__ . '/app/bootstrap.php';

use BlogPanel\App;
use BlogPanel\Auth;

Auth::require();
$db = App::db();
$jobs = $db->all('SELECT j.*, d.domain FROM jobs j JOIN domains d ON d.id = j.domain_id ORDER BY j.id DESC LIMIT 100');
$logs = $db->all('SELECT * FROM logs ORDER BY id DESC LIMIT 150');
$types = ['cron' => 'Zamanlanmış', 'manual' => 'Manuel'];

$pageTitle = 'İşler & Kayıtlar';
$active = 'jobs';
require __DIR__ . '/app/views/layout_top.php';
?>
<div class="page-head"><h1>İşler</h1></div>
<div class="card table-wrap">
<table>
  <thead><tr><th>#</th><th>Domain</th><th>Tür</th><th>Durum</th><th>Oluşturma</th><th>Bitiş</th><th>Hata</th></tr></thead>
  <tbody>
  <?php foreach ($jobs as $j): ?>
    <tr>
      <td><?= (int) $j['id'] ?></td>
      <td><?= e($j['domain']) ?></td>
      <td><?= e($types[$j['trigger_type']] ?? $j['trigger_type']) ?></td>
      <td><?= status_badge($j['status']) ?></td>
      <td class="nowrap"><?= e(fmt_date($j['created_at'])) ?></td>
      <td class="nowrap"><?= e(fmt_date($j['completed_at'])) ?></td>
      <td class="err-text"><?= e($j['error']) ?></td>
    </tr>
  <?php endforeach; ?>
  <?php if (!$jobs): ?><tr><td colspan="7" class="muted">Henüz iş yok.</td></tr><?php endif; ?>
  </tbody>
</table>
</div>

<h2>Sistem kayıtları</h2>
<div class="card table-wrap">
<table class="compact">
  <tbody>
  <?php foreach ($logs as $l): ?>
    <tr class="<?= $l['level'] === 'error' ? 'row-err' : '' ?>">
      <td class="nowrap"><?= e(fmt_date($l['created_at'])) ?></td>
      <td><span class="badge badge-<?= $l['level'] === 'error' ? 'err' : 'muted' ?>"><?= e($l['context']) ?></span></td>
      <td><?= e($l['message']) ?></td>
    </tr>
  <?php endforeach; ?>
  </tbody>
</table>
</div>
<?php require __DIR__ . '/app/views/layout_bottom.php'; ?>
