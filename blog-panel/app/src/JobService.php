<?php
declare(strict_types=1);

namespace BlogPanel;

use BlogPanel\Publisher\PublisherFactory;
use DateTimeImmutable;

/**
 * İş akışı:
 *   panel (cron/manuel) -> trigger() -> n8n webhook
 *   n8n (site analizi + AI içerik) -> api/callback.php -> handleCallback() -> yayın
 */
final class JobService
{
    public static function openJob(int $domainId): ?array
    {
        return App::db()->one("SELECT * FROM jobs WHERE domain_id = ? AND status IN ('queued','triggered') ORDER BY id DESC", [$domainId]);
    }

    public static function trigger(array $domain, string $type = 'cron'): array
    {
        $db = App::db();
        if ($open = self::openJob((int) $domain['id'])) {
            throw new \RuntimeException("{$domain['domain']} için zaten devam eden bir iş var (#{$open['id']}).");
        }
        $jobId = $db->insert('jobs', [
            'domain_id' => $domain['id'], 'status' => 'queued', 'trigger_type' => $type,
            'token' => bin2hex(random_bytes(24)), 'created_at' => Database::now(),
        ]);
        $job = $db->one('SELECT * FROM jobs WHERE id = ?', [$jobId]);

        try {
            N8nClient::fromSettings()->send(self::buildPayload($domain, $job));
            $db->update('jobs', ['status' => 'triggered', 'triggered_at' => Database::now()], 'id = :id', ['id' => $jobId]);
            Logger::info('job', "#$jobId {$domain['domain']} için n8n tetiklendi ($type).");
        } catch (\Throwable $e) {
            self::fail($job, 'n8n tetiklenemedi: ' . $e->getMessage());
            throw $e;
        }
        return $db->one('SELECT * FROM jobs WHERE id = ?', [$jobId]);
    }

    public static function buildPayload(array $domain, array $job): array
    {
        $db = App::db();
        $s = App::settings();
        $recent = $db->all('SELECT title FROM posts WHERE domain_id = ? ORDER BY id DESC LIMIT 60', [$domain['id']]);
        $links = $db->all("SELECT title, remote_url AS url FROM posts WHERE domain_id = ? AND status = 'published' AND remote_url IS NOT NULL ORDER BY published_at DESC LIMIT 20", [$domain['id']]);
        $seed = array_values(array_filter(array_map('trim', preg_split('/[,\n]+/', (string) $domain['seed_keywords']))));

        return [
            'job_id'       => (int) $job['id'],
            'token'        => $job['token'],
            'callback_url' => rtrim($s->get('panel_base_url'), '/') . '/api/callback.php',
            'domain'       => [
                'id'                 => (int) $domain['id'],
                'domain'             => $domain['domain'],
                'site_url'           => 'https://' . $domain['domain'] . '/',
                'niche'              => (string) $domain['niche'],
                'target_audience'    => (string) $domain['target_audience'],
                'language'           => $domain['language'] ?: 'tr',
                'tone'               => $domain['tone'] ?: 'bilgilendirici, samimi ve uzman',
                'seed_keywords'      => $seed,
                'extra_instructions' => (string) $domain['extra_instructions'],
                'publish_method'     => $domain['publish_method'],
            ],
            'content_rules' => [
                'min_word_count' => max(300, $s->int('min_word_count')),
                'current_date'   => date('Y-m-d'),
            ],
            'recent_titles'  => array_column($recent, 'title'),
            'internal_links' => $links,
        ];
    }

    /** n8n'den gelen sonucu işler, yazıyı yayınlar. */
    public static function handleCallback(array $data): array
    {
        $db = App::db();
        $job = $db->one('SELECT * FROM jobs WHERE id = ?', [(int) ($data['job_id'] ?? 0)]);
        if (!$job || !hash_equals($job['token'], (string) ($data['token'] ?? ''))) {
            throw new CallbackException('İş bulunamadı veya token geçersiz.', 404);
        }
        if (!in_array($job['status'], ['queued', 'triggered'], true)) {
            throw new CallbackException("İş zaten sonuçlanmış (durum: {$job['status']}).", 409);
        }
        $domain = DomainService::find((int) $job['domain_id']);

        if (($data['status'] ?? '') !== 'success') {
            self::fail($job, 'n8n/AI hatası: ' . mb_substr((string) ($data['error'] ?? 'bilinmeyen hata'), 0, 1000));
            return ['ok' => false, 'job_id' => (int) $job['id'], 'message' => 'Hata kaydedildi.'];
        }

        $postId = null;
        try {
            $article = self::normalizeArticle((array) ($data['article'] ?? []), $domain);
            $seo = SeoAnalyzer::analyze($article, max(300, App::settings()->int('min_word_count')));

            $postId = $db->insert('posts', [
                'domain_id' => $domain['id'], 'job_id' => $job['id'], 'title' => $article['title'], 'slug' => $article['slug'],
                'meta_title' => $article['meta_title'], 'meta_description' => $article['meta_description'],
                'focus_keyword' => $article['focus_keyword'], 'keywords' => $article['keywords'], 'excerpt' => $article['excerpt'],
                'content_html' => $article['content_html'], 'faq_json' => json_encode($article['faq'], JSON_UNESCAPED_UNICODE),
                'tags' => implode(', ', $article['tags']), 'seo_score' => $seo['score'],
                'seo_report' => json_encode($seo, JSON_UNESCAPED_UNICODE), 'status' => 'publishing', 'created_at' => Database::now(),
            ]);

            $minScore = App::settings()->int('min_seo_score');
            if ($seo['score'] < $minScore) {
                throw new \RuntimeException("SEO puanı ({$seo['score']}) minimum değerin ($minScore) altında; yayınlanmadı.");
            }

            $now = Database::now();
            $post = $article + ['id' => $postId, 'published_at' => $now];
            $published = $db->all("SELECT title, slug, excerpt, published_at FROM posts WHERE domain_id = ? AND status = 'published' ORDER BY published_at DESC", [$domain['id']]);
            array_unshift($published, ['title' => $post['title'], 'slug' => $post['slug'], 'excerpt' => $post['excerpt'], 'published_at' => $now]);

            $result = PublisherFactory::for($domain)->publish($domain, $post, $published);

            $db->update('posts', [
                'status' => 'published', 'remote_id' => $result['remote_id'], 'remote_url' => $result['url'], 'published_at' => $now,
            ], 'id = :id', ['id' => $postId]);
            $db->update('jobs', ['status' => 'published', 'completed_at' => $now, 'error' => null], 'id = :id', ['id' => $job['id']]);
            $db->update('domains', [
                'last_post_at' => $now, 'fail_count' => 0,
                'next_post_at' => DomainService::nextAfterPublish($domain, new DateTimeImmutable($now)), 'updated_at' => $now,
            ], 'id = :id', ['id' => $domain['id']]);
            Logger::info('publish', "{$domain['domain']}: \"{$post['title']}\" yayınlandı (SEO {$seo['score']}) {$result['url']}");

            return ['ok' => true, 'job_id' => (int) $job['id'], 'post_id' => $postId, 'url' => $result['url'], 'seo_score' => $seo['score']];
        } catch (\Throwable $e) {
            if ($postId) {
                $db->update('posts', ['status' => 'failed', 'error' => $e->getMessage()], 'id = :id', ['id' => $postId]);
            }
            self::fail($job, 'Yayın hatası: ' . $e->getMessage());
            return ['ok' => false, 'job_id' => (int) $job['id'], 'message' => $e->getMessage()];
        }
    }

    public static function normalizeArticle(array $a, array $domain): array
    {
        $title = trim(strip_tags((string) ($a['title'] ?? '')));
        $html = HtmlSanitizer::clean((string) ($a['content_html'] ?? ''));
        if ($title === '' || $html === '') {
            throw new \RuntimeException('AI çıktısında başlık veya içerik eksik.');
        }
        $focus = trim((string) ($a['focus_keyword'] ?? ''));
        $secondary = array_values(array_filter(array_map(static fn ($k) => trim((string) $k), (array) ($a['secondary_keywords'] ?? []))));
        $faq = [];
        foreach ((array) ($a['faq'] ?? []) as $f) {
            $q = trim(strip_tags((string) ($f['question'] ?? '')));
            $ans = trim(strip_tags((string) ($f['answer'] ?? '')));
            if ($q !== '' && $ans !== '') {
                $faq[] = ['question' => $q, 'answer' => $ans];
            }
        }
        $metaDesc = trim(strip_tags((string) ($a['meta_description'] ?? '')));
        $excerpt = trim(strip_tags((string) ($a['excerpt'] ?? '')));
        if ($excerpt === '') {
            $excerpt = mb_substr(trim(strip_tags($html)), 0, 200);
        }
        if ($metaDesc === '') {
            $metaDesc = $excerpt;
        }

        return [
            'title'            => $title,
            'slug'             => self::uniqueSlug((int) $domain['id'], slugify((string) (($a['slug'] ?? '') ?: $title))),
            'meta_title'       => trim(strip_tags((string) ($a['meta_title'] ?? ''))) ?: $title,
            'meta_description' => self::cut($metaDesc, 160),
            'focus_keyword'    => $focus,
            'keywords'         => implode(', ', array_unique(array_filter(array_merge([$focus], $secondary)))),
            'excerpt'          => self::cut($excerpt, 300),
            'content_html'     => $html,
            'faq'              => $faq,
            'tags'             => array_slice(array_values(array_filter(array_map(static fn ($t) => trim(strip_tags((string) $t)), (array) ($a['tags'] ?? [])))), 0, 8),
        ];
    }

    public static function fail(array $job, string $error): void
    {
        $db = App::db();
        $db->update('jobs', ['status' => 'failed', 'error' => $error, 'completed_at' => Database::now()], 'id = :id', ['id' => $job['id']]);
        $domain = DomainService::find((int) $job['domain_id']);
        Logger::error('job', "#{$job['id']} " . ($domain['domain'] ?? '?') . ": $error");
        if ($domain && $job['trigger_type'] === 'cron' && $domain['is_active']) {
            self::scheduleRetry($domain);
        }
    }

    /** Hata sonrası: kısa süre sonra tekrar dene; üst üste çok hata varsa normal takvime dön. */
    private static function scheduleRetry(array $domain): void
    {
        $s = App::settings();
        $fails = (int) $domain['fail_count'] + 1;
        if ($fails >= max(1, $s->int('max_consecutive_fails'))) {
            $next = DomainService::nextAfterPublish($domain);
            $fails = 0;
            Logger::error('schedule', "{$domain['domain']}: üst üste hata sınırı aşıldı, sonraki deneme $next.");
        } else {
            $next = date('Y-m-d H:i:s', time() + max(10, $s->int('retry_minutes')) * 60);
        }
        App::db()->update('domains', ['fail_count' => $fails, 'next_post_at' => $next, 'updated_at' => Database::now()], 'id = :id', ['id' => $domain['id']]);
    }

    private static function uniqueSlug(int $domainId, string $slug): string
    {
        $candidate = $slug;
        for ($i = 2; App::db()->value("SELECT COUNT(*) FROM posts WHERE domain_id = ? AND slug = ? AND status <> 'failed'", [$domainId, $candidate]) > 0; $i++) {
            $candidate = $slug . '-' . $i;
        }
        return $candidate;
    }

    private static function cut(string $s, int $max): string
    {
        if (mb_strlen($s) <= $max) {
            return $s;
        }
        $cut = mb_substr($s, 0, $max - 1);
        $space = mb_strrpos($cut, ' ');
        return rtrim($space > $max * 0.6 ? mb_substr($cut, 0, $space) : $cut, ' ,.;:') . '…';
    }
}
