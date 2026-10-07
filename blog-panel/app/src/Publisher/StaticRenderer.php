<?php
declare(strict_types=1);

namespace BlogPanel\Publisher;

final class StaticRenderer
{
    public static function post(array $domain, array $post, array $publishedPosts): string
    {
        $related = array_slice(array_values(array_filter($publishedPosts, static fn ($p) => $p['slug'] !== $post['slug'])), 0, 5);
        return self::render('static_post.php', compact('domain', 'post', 'related'));
    }

    public static function index(array $domain, array $publishedPosts): string
    {
        return self::render('static_index.php', ['domain' => $domain, 'posts' => $publishedPosts]);
    }

    public static function sitemap(array $domain, array $posts): string
    {
        $base = StaticPublisher::blogUrl($domain);
        $xml = '<?xml version="1.0" encoding="UTF-8"?>' . "\n<!-- " . StaticPublisher::MARKER . " -->\n" . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";
        $xml .= '  <url><loc>' . self::x($base) . '</loc><changefreq>daily</changefreq></url>' . "\n";
        foreach ($posts as $p) {
            $xml .= '  <url><loc>' . self::x($base . $p['slug']) . '</loc><lastmod>' . date('Y-m-d', strtotime($p['published_at'] ?? 'now')) . "</lastmod></url>\n";
        }
        return $xml . "</urlset>\n";
    }

    public static function feed(array $domain, array $posts): string
    {
        $base = StaticPublisher::blogUrl($domain);
        $xml = '<?xml version="1.0" encoding="UTF-8"?>' . "\n<!-- " . StaticPublisher::MARKER . " -->\n<rss version=\"2.0\"><channel>\n";
        $xml .= '<title>' . self::x($domain['domain'] . ' Blog') . '</title><link>' . self::x($base) . '</link><description>' . self::x($domain['niche'] ?? '') . "</description>\n";
        foreach (array_slice($posts, 0, 20) as $p) {
            $url = $base . $p['slug'];
            $xml .= '<item><title>' . self::x($p['title']) . '</title><link>' . self::x($url) . '</link><guid>' . self::x($url) . '</guid>'
                . '<pubDate>' . date(DATE_RSS, strtotime($p['published_at'] ?? 'now')) . '</pubDate><description>' . self::x($p['excerpt'] ?? '') . "</description></item>\n";
        }
        return $xml . "</channel></rss>\n";
    }

    public static function htaccess(): string
    {
        return "# Blog Panel tarafından oluşturuldu (" . StaticPublisher::MARKER . ")\nOptions -Indexes\nDirectoryIndex index.html\n<IfModule mod_rewrite.c>\nRewriteEngine On\n"
            . "RewriteCond %{REQUEST_FILENAME} !-f\nRewriteCond %{REQUEST_FILENAME} !-d\nRewriteCond %{REQUEST_FILENAME}.html -f\nRewriteRule ^(.+?)/?$ $1.html [L]\n</IfModule>\n";
    }

    /** BlogPosting + BreadcrumbList (+ FAQPage) yapılandırılmış verisi. */
    public static function jsonLd(array $domain, array $post, string $url): string
    {
        $siteUrl = 'https://' . $domain['domain'] . '/';
        $published = date('c', strtotime($post['published_at'] ?? 'now'));
        $graph = [
            [
                '@type' => 'BlogPosting',
                'headline' => $post['title'],
                'description' => $post['meta_description'],
                'datePublished' => $published,
                'dateModified' => $published,
                'mainEntityOfPage' => $url,
                'url' => $url,
                'inLanguage' => $domain['language'] ?: 'tr',
                'keywords' => $post['keywords'],
                'author' => ['@type' => 'Organization', 'name' => $domain['domain'], 'url' => $siteUrl],
                'publisher' => ['@type' => 'Organization', 'name' => $domain['domain'], 'url' => $siteUrl],
            ],
            [
                '@type' => 'BreadcrumbList',
                'itemListElement' => [
                    ['@type' => 'ListItem', 'position' => 1, 'name' => 'Ana Sayfa', 'item' => $siteUrl],
                    ['@type' => 'ListItem', 'position' => 2, 'name' => 'Blog', 'item' => StaticPublisher::listUrl($domain)],
                    ['@type' => 'ListItem', 'position' => 3, 'name' => $post['title'], 'item' => $url],
                ],
            ],
        ];
        if (!empty($post['faq'])) {
            $graph[] = [
                '@type' => 'FAQPage',
                'mainEntity' => array_map(static fn ($f) => [
                    '@type' => 'Question', 'name' => $f['question'],
                    'acceptedAnswer' => ['@type' => 'Answer', 'text' => $f['answer']],
                ], $post['faq']),
            ];
        }
        return json_encode(['@context' => 'https://schema.org', '@graph' => $graph], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG);
    }

    /**
     * Sitenin kendi şablonundaki {{yer_tutucu}} alanlarını doldurur.
     * Ham HTML: {{content}}, {{faq}}, {{jsonld}}, {{related}} — diğerleri HTML-escape edilir.
     */
    public static function fillTemplate(string $template, array $domain, array $post, array $publishedPosts, string $url, bool $isPage): string
    {
        $months = [1 => 'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
        $ts = strtotime($post['published_at'] ?? 'now');
        $words = count(preg_split('/\s+/u', trim(strip_tags($post['content_html']))) ?: []);
        $dir = trim((string) ($domain['static_dir'] ?: 'blog'), '/');

        $faq = '';
        if (!empty($post['faq'])) {
            $faq = "<h2>Sıkça Sorulan Sorular</h2>\n<div class=\"faq-list\">\n";
            foreach ($post['faq'] as $f) {
                $faq .= '<details><summary>' . e($f['question']) . '</summary><p>' . e($f['answer']) . "</p></details>\n";
            }
            $faq .= "</div>\n";
        }
        $related = '';
        $others = array_slice(array_values(array_filter($publishedPosts, static fn ($p) => $p['slug'] !== $post['slug'])), 0, 5);
        if ($others) {
            $related = "<ul>\n";
            foreach ($others as $o) {
                $related .= '<li><a href="/' . e($dir . '/' . $o['slug']) . '.html">' . e($o['title']) . "</a></li>\n";
            }
            $related .= "</ul>\n";
        }

        $escaped = [
            'title' => $post['title'],
            'meta_title' => $post['meta_title'] ?: $post['title'],
            'meta_description' => $post['meta_description'],
            'excerpt' => $post['excerpt'] ?? '',
            'url' => $url,
            'relative_url' => $dir . '/' . $post['slug'] . '.html',
            'slug' => $post['slug'],
            'list_url' => StaticPublisher::listUrl($domain),
            'date_iso' => date('c', $ts),
            'date' => date('d.m.Y', $ts),
            'date_long' => date('j', $ts) . ' ' . $months[(int) date('n', $ts)] . ' ' . date('Y', $ts),
            'reading_minutes' => (string) max(1, (int) round($words / 200)),
            'focus_keyword' => $post['focus_keyword'] ?? '',
            'keywords' => $post['keywords'] ?? '',
            'tags' => implode(', ', (array) ($post['tags'] ?? [])),
        ];
        $replace = [];
        foreach ($escaped as $key => $value) {
            $replace['{{' . $key . '}}'] = e((string) $value);
        }
        $replace['{{content}}'] = $post['content_html'];
        $replace['{{faq}}'] = $faq;
        $replace['{{jsonld}}'] = '<script type="application/ld+json">' . self::jsonLd($domain, $post, $url) . '</script>';
        $replace['{{related}}'] = $related;
        $html = strtr($template, $replace);

        if ($isPage) {
            $mark = '<!-- ' . StaticPublisher::MARKER . ' -->';
            $html = preg_match('~<head\b[^>]*>~i', $html, $m, PREG_OFFSET_CAPTURE)
                ? substr_replace($html, $m[0][0] . $mark, $m[0][1], strlen($m[0][0]))
                : $mark . "\n" . $html;
        }
        return $html;
    }

    private static function render(string $template, array $vars): string
    {
        extract($vars, EXTR_SKIP);
        ob_start();
        require APP_ROOT . '/app/templates/' . $template;
        return (string) ob_get_clean();
    }

    private static function x(string $s): string
    {
        return htmlspecialchars($s, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    }
}
