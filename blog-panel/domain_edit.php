<?php
declare(strict_types=1);
require __DIR__ . '/app/bootstrap.php';

use BlogPanel\App;
use BlogPanel\Auth;
use BlogPanel\Database;
use BlogPanel\DomainService;
use BlogPanel\Publisher\PublisherFactory;

Auth::require();
$db = App::db();
$id = (int) ($_GET['id'] ?? 0);
$domain = $id ? DomainService::find($id) : null;
if ($id && !$domain) {
    http_response_code(404);
    exit('Domain bulunamadı.');
}
$errors = [];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_check();
    if (($_POST['do'] ?? '') === 'delete' && $domain) {
        $db->run('DELETE FROM domains WHERE id = ?', [$domain['id']]);
        flash('ok', "{$domain['domain']} panelden silindi (sitedeki yazılar silinmez).");
        redirect('domains.php');
    }

    $in = fn (string $k, string $d = '') => trim((string) ($_POST[$k] ?? $d));
    $data = [
        'domain'             => strtolower($in('domain')),
        'cpanel_user'        => $in('cpanel_user'),
        'docroot'            => rtrim($in('docroot'), '/'),
        'publish_method'     => $in('publish_method', 'static'),
        'wp_url'             => rtrim($in('wp_url'), '/'),
        'wp_user'            => $in('wp_user'),
        'wp_category_id'     => $in('wp_category_id') !== '' ? (int) $in('wp_category_id') : null,
        'wp_status'          => $in('wp_status', 'publish'),
        'static_dir'         => $in('static_dir', 'blog') ?: 'blog',
        'static_extra_head'  => (string) ($_POST['static_extra_head'] ?? ''),
        'niche'              => $in('niche'),
        'target_audience'    => $in('target_audience'),
        'language'           => $in('language', 'tr') ?: 'tr',
        'tone'               => $in('tone'),
        'seed_keywords'      => $in('seed_keywords'),
        'extra_instructions' => $in('extra_instructions'),
        'post_interval_days' => max(1, min(60, (int) $in('post_interval_days', '3'))),
        'publish_hour'       => max(0, min(23, (int) $in('publish_hour', '10'))),
        'updated_at'         => Database::now(),
    ];
    if (!preg_match('/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/', $data['domain'])) {
        $errors[] = 'Geçerli bir domain girin (ör. ornek.com).';
    }
    if (!isset(PublisherFactory::METHODS[$data['publish_method']])) {
        $errors[] = 'Geçersiz yayın yöntemi.';
    }
    if (!preg_match('~^[a-z0-9_-]+$~i', $data['static_dir'])) {
        $errors[] = 'Blog klasörü yalnızca harf, rakam, - ve _ içerebilir.';
    }
    if ($data['publish_method'] === 'wordpress' && ($data['wp_url'] === '' || $data['wp_user'] === '')) {
        $errors[] = 'WordPress için site adresi ve kullanıcı adı gerekli.';
    }
    if (str_starts_with($data['publish_method'], 'static') && $data['docroot'] === '') {
        $errors[] = 'Statik yayın için docroot (ör. /home/kullanici/public_html) gerekli.';
    }
    $dup = $db->value('SELECT id FROM domains WHERE domain = ? AND id <> ?', [$data['domain'], $id]);
    if ($dup) {
        $errors[] = 'Bu domain zaten kayıtlı.';
    }
    if (trim((string) ($_POST['wp_app_password'] ?? '')) !== '') {
        $data['wp_app_password'] = App::crypto()->encrypt(trim((string) $_POST['wp_app_password']));
    }
    $nextInput = $in('next_post_at');
    if ($nextInput !== '' && ($ts = strtotime($nextInput)) !== false) {
        $data['next_post_at'] = date('Y-m-d H:i:s', $ts);
    }

    if (!$errors) {
        $wantActive = !empty($_POST['is_active']);
        if ($domain) {
            $db->update('domains', $data, 'id = :id', ['id' => $id]);
        } else {
            $id = $db->insert('domains', $data + ['is_active' => 0, 'created_at' => Database::now()]);
        }
        $fresh = DomainService::find($id);
        if ($wantActive && (!$fresh['is_active'] || !$fresh['next_post_at'])) {
            DomainService::activate($fresh);
        } elseif (!$wantActive && $fresh['is_active']) {
            DomainService::deactivate($fresh);
        }
        flash('ok', 'Domain ayarları kaydedildi.');
        redirect('domain_edit.php?id=' . $id);
    }
    $domain = array_merge($domain ?? [], $data, ['id' => $id, 'is_active' => !empty($_POST['is_active']) ? 1 : 0]);
}

$d = $domain ?? [
    'id' => 0, 'domain' => '', 'cpanel_user' => '', 'docroot' => '', 'publish_method' => 'static', 'wp_url' => '', 'wp_user' => '',
    'wp_app_password' => '', 'wp_category_id' => '', 'wp_status' => 'publish', 'static_dir' => 'blog', 'static_extra_head' => '',
    'niche' => '', 'target_audience' => '', 'language' => 'tr', 'tone' => '', 'seed_keywords' => '', 'extra_instructions' => '',
    'post_interval_days' => App::settings()->int('default_interval_days'), 'publish_hour' => App::settings()->int('default_publish_hour'),
    'is_active' => 0, 'next_post_at' => null, 'last_post_at' => null,
];
$posts = $id ? $db->all('SELECT id, title, status, seo_score, remote_url, created_at FROM posts WHERE domain_id = ? ORDER BY id DESC LIMIT 10', [$id]) : [];

$pageTitle = $id ? $d['domain'] : 'Yeni domain';
$active = 'domains';
require __DIR__ . '/app/views/layout_top.php';
?>
<div class="page-head">
  <h1><?= e($pageTitle) ?></h1>
  <?php if ($id): ?>
  <div class="actions">
    <button class="btn" data-action="test_publisher" data-id="<?= $id ?>">Yayın bağlantısını test et</button>
    <button class="btn btn-primary" data-action="trigger" data-id="<?= $id ?>" data-confirm="Şimdi yazı üretilsin mi?">Şimdi paylaş</button>
  </div>
  <?php endif; ?>
</div>

<?php foreach ($errors as $err): ?><div class="alert alert-err"><?= e($err) ?></div><?php endforeach; ?>

<form method="post" class="form" autocomplete="off">
  <?= csrf_field() ?>
  <div class="grid-2 gap">
    <section class="card">
      <h2>Genel</h2>
      <label>Domain <input name="domain" value="<?= e($d['domain']) ?>" required placeholder="ornek.com"></label>
      <label class="check"><input type="checkbox" name="is_active" value="1" <?= $d['is_active'] ? 'checked' : '' ?>> Otomatik paylaşım aktif</label>
      <div class="grid-2">
        <label>Kaç günde bir <input type="number" name="post_interval_days" min="1" max="60" value="<?= (int) $d['post_interval_days'] ?>"></label>
        <label>Yayın saati (0-23) <input type="number" name="publish_hour" min="0" max="23" value="<?= (int) $d['publish_hour'] ?>"></label>
      </div>
      <label>Sonraki paylaşım
        <input type="datetime-local" name="next_post_at" value="<?= $d['next_post_at'] ? e(date('Y-m-d\TH:i', strtotime($d['next_post_at']))) : '' ?>">
        <small>Boş bırakılırsa aktifleştirmede otomatik hesaplanır. Son paylaşım: <?= e(fmt_date($d['last_post_at'])) ?></small>
      </label>

      <h2>İçerik stratejisi (AI'ya gönderilir)</h2>
      <label>Sektör / konu <input name="niche" value="<?= e($d['niche']) ?>" placeholder="ör. İstanbul'da ev tekstili toptan satış"></label>
      <label>Hedef kitle <input name="target_audience" value="<?= e($d['target_audience']) ?>" placeholder="ör. butik sahipleri, KOBİ'ler"></label>
      <div class="grid-2">
        <label>Dil
          <select name="language">
            <?php foreach (['tr' => 'Türkçe', 'en' => 'English', 'de' => 'Deutsch', 'ar' => 'العربية', 'ru' => 'Русский'] as $code => $label): ?>
              <option value="<?= $code ?>" <?= $d['language'] === $code ? 'selected' : '' ?>><?= e($label) ?></option>
            <?php endforeach; ?>
          </select>
        </label>
        <label>Ton <input name="tone" value="<?= e($d['tone']) ?>" placeholder="uzman, samimi, bilgilendirici"></label>
      </div>
      <label>Hedef anahtar kelimeler (virgül veya satır ile)
        <textarea name="seed_keywords" rows="3" placeholder="toptan nevresim, otel tekstili, ..."><?= e($d['seed_keywords']) ?></textarea>
      </label>
      <label>Ek talimatlar
        <textarea name="extra_instructions" rows="3" placeholder="ör. Rakip firma isimleri geçmesin, yazının sonunda iletişim sayfasına yönlendir (/iletisim)."><?= e($d['extra_instructions']) ?></textarea>
      </label>
    </section>

    <section class="card">
      <h2>Yayın yöntemi</h2>
      <label>Yöntem
        <select name="publish_method" data-method-select>
          <?php foreach (PublisherFactory::METHODS as $key => $label): ?>
            <option value="<?= $key ?>" <?= $d['publish_method'] === $key ? 'selected' : '' ?>><?= e($label) ?></option>
          <?php endforeach; ?>
        </select>
      </label>

      <div data-method="static static_local">
        <div class="grid-2">
          <label>cPanel kullanıcısı <input name="cpanel_user" value="<?= e($d['cpanel_user']) ?>"></label>
          <label>Blog klasörü <input name="static_dir" value="<?= e($d['static_dir']) ?>"></label>
        </div>
        <label>Docroot <input name="docroot" value="<?= e($d['docroot']) ?>" placeholder="/home/kullanici/public_html"></label>
        <small>Yazılar <code>https://<?= e($d['domain'] ?: 'domain.com') ?>/<?= e($d['static_dir'] ?: 'blog') ?>/yazi-basligi</code> adresinde yayınlanır; index, sitemap.xml ve feed.xml otomatik güncellenir.</small>
        <label>Ek &lt;head&gt; kodu (site CSS'i, Analytics vb.)
          <textarea name="static_extra_head" rows="4" class="mono" placeholder='<link rel="stylesheet" href="/css/site.css">'><?= e($d['static_extra_head']) ?></textarea>
        </label>
      </div>

      <div data-method="wordpress">
        <label>WordPress adresi <input name="wp_url" value="<?= e($d['wp_url']) ?>" placeholder="https://ornek.com"></label>
        <div class="grid-2">
          <label>Kullanıcı adı <input name="wp_user" value="<?= e($d['wp_user']) ?>"></label>
          <label>Uygulama şifresi <input name="wp_app_password" type="password" placeholder="<?= $d['wp_app_password'] ? '•••••• (kayıtlı)' : 'xxxx xxxx xxxx xxxx' ?>" autocomplete="new-password"></label>
        </div>
        <div class="grid-2">
          <label>Kategori ID <input name="wp_category_id" type="number" value="<?= e((string) $d['wp_category_id']) ?>"></label>
          <label>Durum
            <select name="wp_status">
              <?php foreach (['publish' => 'Yayınla', 'draft' => 'Taslak', 'pending' => 'İnceleme bekliyor'] as $k => $l): ?>
                <option value="<?= $k ?>" <?= $d['wp_status'] === $k ? 'selected' : '' ?>><?= $l ?></option>
              <?php endforeach; ?>
            </select>
          </label>
        </div>
        <small>WordPress &gt; Kullanıcılar &gt; Profil &gt; Uygulama Şifreleri bölümünden oluşturun.</small>
      </div>

      <?php if ($posts): ?>
      <h2>Son yazılar</h2>
      <ul class="plain">
        <?php foreach ($posts as $p): ?>
          <li><?= status_badge($p['status']) ?> <?= seo_badge((int) $p['seo_score']) ?> <a href="post_view.php?id=<?= (int) $p['id'] ?>"><?= e($p['title']) ?></a></li>
        <?php endforeach; ?>
      </ul>
      <?php endif; ?>
    </section>
  </div>

  <div class="form-actions">
    <button class="btn btn-primary" type="submit">Kaydet</button>
    <?php if ($id): ?>
      <button class="btn btn-danger" type="submit" name="do" value="delete" data-confirm-submit="Domain panelden silinsin mi? Sitedeki yazılar silinmez.">Panelden sil</button>
    <?php endif; ?>
  </div>
</form>
<?php require __DIR__ . '/app/views/layout_bottom.php'; ?>
