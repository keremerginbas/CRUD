<?php
declare(strict_types=1);

namespace BlogPanel\Publisher;

use BlogPanel\App;
use BlogPanel\Http;

/** WordPress REST API (wp-admin > Profil > Uygulama Şifreleri) ile yazı oluşturur. */
final class WordPressPublisher implements PublisherInterface
{
    public function publish(array $domain, array $post, array $publishedPosts): array
    {
        $content = $post['content_html'] . self::faqHtml($post['faq']);
        $body = [
            'title'   => $post['title'],
            'slug'    => $post['slug'],
            'content' => $content,
            'excerpt' => $post['excerpt'],
            'status'  => in_array($domain['wp_status'], ['publish', 'draft', 'pending'], true) ? $domain['wp_status'] : 'publish',
            // Yoast / Rank Math alanları; wordpress/blog-panel-seo-meta.php eklentisi REST'e açar
            'meta'    => [
                '_yoast_wpseo_title'       => $post['meta_title'],
                '_yoast_wpseo_metadesc'    => $post['meta_description'],
                '_yoast_wpseo_focuskw'     => $post['focus_keyword'],
                'rank_math_title'          => $post['meta_title'],
                'rank_math_description'    => $post['meta_description'],
                'rank_math_focus_keyword'  => $post['focus_keyword'],
            ],
        ];
        if (!empty($domain['wp_category_id'])) {
            $body['categories'] = [(int) $domain['wp_category_id']];
        }
        $tagIds = $this->ensureTags($domain, $post['tags']);
        if ($tagIds) {
            $body['tags'] = $tagIds;
        }

        $r = $this->api($domain, 'POST', 'posts', $body);
        if ($r['status'] === 400 && str_contains($r['body'], 'meta')) {
            unset($body['meta']); // kayıtlı olmayan meta alanı reddedildiyse SEO meta'sız tekrar dene
            $r = $this->api($domain, 'POST', 'posts', $body);
        }
        if ($r['status'] < 200 || $r['status'] >= 300 || empty($r['json']['id'])) {
            throw new \RuntimeException("WordPress yazı oluşturulamadı (HTTP {$r['status']}): " . mb_substr($r['json']['message'] ?? $r['body'], 0, 300));
        }
        return ['remote_id' => (string) $r['json']['id'], 'url' => (string) ($r['json']['link'] ?? '')];
    }

    public function unpublish(array $domain, array $post, array $remainingPosts): string
    {
        if (empty($post['remote_id'])) {
            return 'WordPress yazı kimliği yok; sitede silinecek bir şey bulunamadı.';
        }
        $r = $this->api($domain, 'DELETE', 'posts/' . (int) $post['remote_id']);
        if ($r['status'] === 404 || $r['status'] === 410) {
            return 'Yazı WordPress\'te zaten yok.';
        }
        if ($r['status'] < 200 || $r['status'] >= 300) {
            throw new \RuntimeException("WordPress yazısı silinemedi (HTTP {$r['status']}): " . mb_substr($r['json']['message'] ?? $r['body'], 0, 200));
        }
        return 'Yazı WordPress\'te çöp kutusuna taşındı.';
    }

    public function test(array $domain): string
    {
        $r = $this->api($domain, 'GET', 'users/me?context=edit');
        if ($r['status'] !== 200) {
            throw new \RuntimeException("WordPress kimlik doğrulama başarısız (HTTP {$r['status']}): " . mb_substr($r['json']['message'] ?? $r['body'], 0, 200));
        }
        $caps = $r['json']['capabilities'] ?? [];
        if (empty($caps['publish_posts'])) {
            throw new \RuntimeException('Kullanıcının yazı yayınlama yetkisi yok.');
        }
        return 'WordPress bağlantısı başarılı: ' . ($r['json']['name'] ?? $domain['wp_user']);
    }

    public static function faqHtml(array $faq): string
    {
        if (!$faq) {
            return '';
        }
        $html = "\n<h2>Sıkça Sorulan Sorular</h2>\n";
        foreach ($faq as $item) {
            $html .= '<h3>' . e($item['question']) . "</h3>\n<p>" . e($item['answer']) . "</p>\n";
        }
        return $html;
    }

    /** @return int[] */
    private function ensureTags(array $domain, array $tags): array
    {
        $ids = [];
        foreach (array_slice($tags, 0, 8) as $name) {
            try {
                $found = $this->api($domain, 'GET', 'tags?search=' . rawurlencode($name) . '&per_page=10');
                foreach ((array) $found['json'] as $t) {
                    if (is_array($t) && mb_strtolower($t['name'] ?? '') === mb_strtolower($name)) {
                        $ids[] = (int) $t['id'];
                        continue 2;
                    }
                }
                $created = $this->api($domain, 'POST', 'tags', ['name' => $name]);
                if (!empty($created['json']['id'])) {
                    $ids[] = (int) $created['json']['id'];
                } elseif (!empty($created['json']['data']['term_id'])) {
                    $ids[] = (int) $created['json']['data']['term_id']; // term_exists
                }
            } catch (\Throwable) {
                // Etiket hatası yayını engellemesin
            }
        }
        return array_values(array_unique($ids));
    }

    private function api(array $domain, string $method, string $path, ?array $body = null): array
    {
        $base = rtrim($domain['wp_url'] ?: 'https://' . $domain['domain'], '/');
        $password = App::crypto()->decrypt($domain['wp_app_password']);
        if ($domain['wp_user'] === '' || $password === '') {
            throw new \RuntimeException('WordPress kullanıcı adı / uygulama şifresi tanımlı değil.');
        }
        return Http::request(
            $method,
            $base . '/wp-json/wp/v2/' . $path,
            ['Content-Type' => 'application/json', 'Accept' => 'application/json'],
            $body !== null ? json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null,
            60,
            ['basic_auth' => $domain['wp_user'] . ':' . str_replace(' ', '', $password)]
        );
    }
}
