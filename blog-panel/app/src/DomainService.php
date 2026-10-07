<?php
declare(strict_types=1);

namespace BlogPanel;

use DateTimeImmutable;

final class DomainService
{
    /** WHM'deki domainleri panele aktarır; yeni domainler pasif eklenir. */
    public static function syncFromWhm(): array
    {
        $db = App::db();
        $remote = WhmClient::fromSettings()->listDomains();
        $added = 0;
        $updated = 0;
        $now = Database::now();
        $interval = max(1, App::settings()->int('default_interval_days'));
        $hour = App::settings()->int('default_publish_hour');

        $panelHost = self::panelHost();
        $remote = self::withoutPanel($remote, $panelHost, realpath(APP_ROOT) ?: APP_ROOT);
        // Daha önce eklenmiş panel kaydını temizle
        if ($panelHost !== '') {
            $db->run('DELETE FROM domains WHERE domain = ? AND is_active = 0 AND NOT EXISTS (SELECT 1 FROM posts p WHERE p.domain_id = domains.id)', [$panelHost]);
        }

        foreach ($remote as $d) {
            $existing = $db->one('SELECT id FROM domains WHERE domain = ?', [$d['domain']]);
            if ($existing) {
                $db->update('domains', [
                    'cpanel_user' => $d['user'], 'docroot' => $d['docroot'], 'domain_type' => $d['domain_type'], 'updated_at' => $now,
                ], 'id = :id', ['id' => $existing['id']]);
                $updated++;
            } else {
                $db->insert('domains', [
                    'domain' => $d['domain'], 'cpanel_user' => $d['user'], 'docroot' => $d['docroot'], 'domain_type' => $d['domain_type'],
                    'is_active' => 0, 'publish_method' => 'static', 'post_interval_days' => $interval, 'publish_hour' => $hour,
                    'wp_url' => 'https://' . $d['domain'], 'language' => 'tr', 'created_at' => $now, 'updated_at' => $now,
                ]);
                $added++;
            }
        }
        Logger::info('whm', "Senkronizasyon: $added yeni, $updated güncellendi.");
        return ['added' => $added, 'updated' => $updated, 'total' => count($remote)];
    }

    public static function panelHost(): string
    {
        return strtolower((string) parse_url(App::settings()->get('panel_base_url'), PHP_URL_HOST));
    }

    /** Panelin kendi (sub)domainini listeden çıkarır; ona blog yazılmaz. */
    public static function withoutPanel(array $remote, string $panelHost, string $panelRoot): array
    {
        return array_values(array_filter($remote, static fn ($d) => $d['domain'] !== $panelHost
            && (realpath($d['docroot']) ?: $d['docroot']) !== $panelRoot));
    }

    public static function find(int $id): ?array
    {
        return App::db()->one('SELECT * FROM domains WHERE id = ?', [$id]);
    }

    /** Aktifleştirme: domainleri aralık içine yayarak ilk paylaşım zamanını belirler. */
    public static function activate(array $domain): void
    {
        $interval = max(1, (int) $domain['post_interval_days']);
        $offsetDays = (int) $domain['id'] % $interval;
        $next = self::slot($domain, new DateTimeImmutable('now'))->modify("+$offsetDays days");
        App::db()->update('domains', [
            'is_active' => 1, 'fail_count' => 0, 'next_post_at' => $next->format('Y-m-d H:i:s'), 'updated_at' => Database::now(),
        ], 'id = :id', ['id' => $domain['id']]);
    }

    public static function deactivate(array $domain): void
    {
        App::db()->update('domains', ['is_active' => 0, 'updated_at' => Database::now()], 'id = :id', ['id' => $domain['id']]);
    }

    /** Başarılı paylaşımdan sonraki zaman: +N gün, domainin yayın saatinde. */
    public static function nextAfterPublish(array $domain, ?DateTimeImmutable $from = null): string
    {
        $interval = max(1, (int) $domain['post_interval_days']);
        $from ??= new DateTimeImmutable('now');
        return self::slotOn($domain, $from->modify("+$interval days"))->format('Y-m-d H:i:s');
    }

    /** Bugün (geçtiyse yarın) domainin yayın saati. */
    private static function slot(array $domain, DateTimeImmutable $now): DateTimeImmutable
    {
        $slot = self::slotOn($domain, $now);
        return $slot <= $now ? $slot->modify('+1 day') : $slot;
    }

    private static function slotOn(array $domain, DateTimeImmutable $day): DateTimeImmutable
    {
        $hour = min(23, max(0, (int) $domain['publish_hour']));
        $minute = ((int) $domain['id'] * 7) % 60; // aynı saatteki domainleri dakikaya yay
        return $day->setTime($hour, $minute);
    }
}
