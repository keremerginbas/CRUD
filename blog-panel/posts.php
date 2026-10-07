<?php
declare(strict_types=1);
require __DIR__ . '/app/bootstrap.php';

use BlogPanel\App;
use BlogPanel\Auth;

Auth::require();
$db = App::db();
$domainId = (int) ($_GET['domain'] ?? 0);
$page = max(1, (int) ($_GET['p'] ?? 1));
$perPage = 30;
$where = $domainId ? 'WHERE p.domain_id = ?' : '';
$params = $domainId ? [$domainId] : [];
$total = (int) $db->value("SELECT COUNT(*) FROM posts p $where", $params);
$posts = $db->all(
    "SELECT p.id, p.title, p.focus_keyword, p.seo_score, p.status, p.remote_url, p.created_at, p.published_at, d.domain
     FROM posts p JOIN domains d ON d.id = p.domain_id $where ORDER BY p.id DESC LIMIT $perPage OFFSET " . (($page - 1) * $perPage),
    $params
);
$domains = $db->all('SELECT id, domain FROM domains ORDER BY domain');

$pageTitle = 'Yazılar';
$active = 'posts';
require __DIR__ . '/app/views/layout_top.php';
?>
<div class="page-head"><h1>Yazılar <span class="muted">(<?= $total ?>)</span></h1></div>
<form class="filters" method="get">
  <select name="domain" onchange="this.form.submit()">
    <option value="0">Tüm domainler</option>
    <?php foreach ($domains as $d): ?><option value="<?= (int) $d['id'] ?>" <?= $domainId === (int) $d['id'] ? 'selected' : '' ?>><?= e($d['domain']) ?></option><?php endforeach; ?>
  </select>
</form>
<div class="card table-wrap">
<table>
  <thead><tr><th>Başlık</th><th>Domain</th><th>Anahtar kelime</th><th>SEO</th><th>Durum</th><th>Tarih</th></tr></thead>
  <tbody>
  <?php foreach ($posts as $p): ?>
    <tr>
      <td><a href="post_view.php?id=<?= (int) $p['id'] ?>"><?= e($p['title']) ?></a>
        <?php if ($p['remote_url']): ?><div class="sub"><a href="<?= e($p['remote_url']) ?>" target="_blank" rel="noopener">Sitede görüntüle ↗</a></div><?php endif; ?></td>
      <td><?= e($p['domain']) ?></td>
      <td><?= e($p['focus_keyword']) ?></td>
      <td><?= seo_badge((int) $p['seo_score']) ?></td>
      <td><?= status_badge($p['status']) ?></td>
      <td class="nowrap"><?= e(fmt_date($p['published_at'] ?: $p['created_at'])) ?></td>
    </tr>
  <?php endforeach; ?>
  <?php if (!$posts): ?><tr><td colspan="6" class="muted">Kayıt yok.</td></tr><?php endif; ?>
  </tbody>
</table>
</div>
<?php if ($total > $perPage): ?>
<nav class="pager">
  <?php for ($i = 1; $i <= (int) ceil($total / $perPage); $i++): ?>
    <a class="<?= $i === $page ? 'active' : '' ?>" href="?domain=<?= $domainId ?>&p=<?= $i ?>"><?= $i ?></a>
  <?php endfor; ?>
</nav>
<?php endif; ?>
<?php require __DIR__ . '/app/views/layout_bottom.php'; ?>
