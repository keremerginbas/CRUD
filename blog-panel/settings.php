<?php
declare(strict_types=1);
require __DIR__ . '/app/bootstrap.php';

use BlogPanel\App;
use BlogPanel\Auth;
use BlogPanel\Settings;

Auth::require();
$s = App::settings();

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_check();
    if (($_POST['do'] ?? '') === 'password') {
        $user = App::db()->one('SELECT * FROM users WHERE id = ?', [$_SESSION['uid']]);
        $new = (string) ($_POST['new_password'] ?? '');
        if (!password_verify((string) ($_POST['current_password'] ?? ''), $user['password_hash'])) {
            flash('err', 'Mevcut şifre hatalı.');
        } elseif (strlen($new) < 10) {
            flash('err', 'Yeni şifre en az 10 karakter olmalı.');
        } else {
            App::db()->update('users', ['password_hash' => password_hash($new, PASSWORD_DEFAULT)], 'id = :id', ['id' => $user['id']]);
            flash('ok', 'Şifre güncellendi.');
        }
        redirect('settings.php');
    }

    foreach (array_keys(Settings::DEFAULTS) as $key) {
        if (!array_key_exists($key, $_POST)) {
            continue;
        }
        $value = trim((string) $_POST[$key]);
        if (in_array($key, Settings::SECRET_KEYS, true) && $value === '') {
            continue; // boş bırakılan gizli alan mevcut değeri korur
        }
        if (in_array($key, ['panel_base_url', 'whm_host', 'n8n_webhook_url'], true)) {
            $value = rtrim($value, '/');
        }
        $s->set($key, $value);
    }
    $s->set('whm_verify_ssl', empty($_POST['whm_verify_ssl']) ? '0' : '1');
    flash('ok', 'Ayarlar kaydedildi.');
    redirect('settings.php');
}

$secretSet = fn (string $k) => $s->get($k) !== '';
$pageTitle = 'Ayarlar';
$active = 'settings';
require __DIR__ . '/app/views/layout_top.php';
?>
<div class="page-head" data-head>
  <div>
    <div class="eyebrow">Yapılandırma</div>
    <h1>Ayarlar</h1>
    <p>WHM ve n8n bağlantıları, zamanlama ve içerik kalitesi kuralları.</p>
  </div>
</div>
<form method="post" class="form" autocomplete="off">
  <?= csrf_field() ?>
  <div class="grid-2 gap">
    <section class="card">
      <h2><?= icon('server') ?>WHM bağlantısı</h2>
      <label>WHM adresi <input name="whm_host" value="<?= e($s->get('whm_host')) ?>" placeholder="https://sunucu.alanadiniz.com:2087"></label>
      <div class="grid-2">
        <label>Kullanıcı <input name="whm_user" value="<?= e($s->get('whm_user')) ?>"></label>
        <label>API token <input name="whm_token" type="password" placeholder="<?= $secretSet('whm_token') ? '•••••• (kayıtlı)' : 'WHM > Manage API Tokens' ?>" autocomplete="new-password"></label>
      </div>
      <label class="check"><input type="checkbox" name="whm_verify_ssl" value="1" <?= $s->get('whm_verify_ssl') === '1' ? 'checked' : '' ?>> SSL sertifikasını doğrula</label>
      <button class="btn" type="button" data-action="test_whm"><?= icon('plug-zap') ?>WHM bağlantısını test et</button>

      <h2><?= icon('workflow') ?>n8n</h2>
      <label>Webhook adresi (Production URL) <input name="n8n_webhook_url" value="<?= e($s->get('n8n_webhook_url')) ?>" placeholder="https://n8n.alanadiniz.com/webhook/blog-panel-generate"></label>
      <label>Gizli anahtar (X-Blog-Panel-Secret)
        <div class="input-group">
          <input name="n8n_secret" type="password" data-secret placeholder="<?= $secretSet('n8n_secret') ? '•••••• (kayıtlı)' : '' ?>" autocomplete="new-password">
          <button class="btn" type="button" data-generate-secret><?= icon('key-round') ?>Üret</button>
          <button class="btn" type="button" data-action="reveal_secret"><?= icon('eye') ?>Göster</button>
        </div>
        <small>n8n'de "Header Auth" credential'ına aynı değeri girin.</small>
      </label>
      <label>Panel adresi (callback için) <input name="panel_base_url" value="<?= e($s->get('panel_base_url')) ?>" placeholder="https://panel.alanadiniz.com"></label>
      <small>n8n sonuçları <code><?= e(rtrim($s->get('panel_base_url'), '/') ?: 'https://panel...') ?>/api/callback.php</code> adresine gönderir.</small>
      <p><button class="btn" type="button" data-action="test_n8n"><?= icon('plug-zap') ?>n8n bağlantısını test et</button></p>
    </section>

    <section class="card">
      <h2><?= icon('calendar-clock') ?>Zamanlama</h2>
      <div class="grid-2">
        <label>Varsayılan sıklık (gün) <input type="number" min="1" name="default_interval_days" value="<?= e($s->get('default_interval_days')) ?>"></label>
        <label>Varsayılan yayın saati <input type="number" min="0" max="23" name="default_publish_hour" value="<?= e($s->get('default_publish_hour')) ?>"></label>
        <label>Cron başına en fazla iş <input type="number" min="1" name="max_jobs_per_run" value="<?= e($s->get('max_jobs_per_run')) ?>"></label>
        <label>İş zaman aşımı (dk) <input type="number" min="5" name="job_timeout_minutes" value="<?= e($s->get('job_timeout_minutes')) ?>"></label>
        <label>Hatada tekrar deneme (dk) <input type="number" min="10" name="retry_minutes" value="<?= e($s->get('retry_minutes')) ?>"></label>
        <label>Üst üste hata sınırı <input type="number" min="1" name="max_consecutive_fails" value="<?= e($s->get('max_consecutive_fails')) ?>"></label>
      </div>

      <h2><?= icon('badge-check') ?>İçerik kalitesi</h2>
      <div class="grid-2">
        <label>Minimum kelime sayısı <input type="number" min="300" name="min_word_count" value="<?= e($s->get('min_word_count')) ?>"></label>
        <label>Yayın için min. SEO puanı <input type="number" min="0" max="100" name="min_seo_score" value="<?= e($s->get('min_seo_score')) ?>"></label>
      </div>

      <h2><?= icon('timer') ?>Cron</h2>
      <p>cPanel &gt; Cron Jobs bölümüne ekleyin (15 dakikada bir):</p>
      <pre class="code">*/15 * * * * /usr/local/bin/php <?= e(__DIR__) ?>/cron/run.php &gt;/dev/null 2&gt;&amp;1</pre>
      <p class="muted">Son çalışma: <?= e(fmt_date($s->get('scheduler_last_run') ?: null)) ?></p>
    </section>
  </div>
  <div class="form-actions"><button class="btn btn-primary" type="submit"><?= icon('save') ?>Ayarları kaydet</button></div>
</form>

<form method="post" class="form card narrow">
  <?= csrf_field() ?>
  <input type="hidden" name="do" value="password">
  <h2><?= icon('shield') ?>Yönetici şifresi</h2>
  <label>Mevcut şifre <input type="password" name="current_password" required autocomplete="current-password"></label>
  <label>Yeni şifre <input type="password" name="new_password" required minlength="10" autocomplete="new-password"></label>
  <button class="btn" type="submit"><?= icon('lock-keyhole') ?>Şifreyi değiştir</button>
</form>
<?php require __DIR__ . '/app/views/layout_bottom.php'; ?>
