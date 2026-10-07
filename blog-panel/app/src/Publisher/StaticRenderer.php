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
        $xml = '<?xml version="1.0" encoding="UTF-8"?>' . "\n" . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";
        $xml .= '  <url><loc>' . self::x($base) . '</loc><changefreq>daily</changefreq></url>' . "\n";
        foreach ($posts as $p) {
            $xml .= '  <url><loc>' . self::x($base . $p['slug']) . '</loc><lastmod>' . date('Y-m-d', strtotime($p['published_at'] ?? 'now')) . "</lastmod></url>\n";
        }
        return $xml . "</urlset>\n";
    }

    public static function feed(array $domain, array $posts): string
    {
        $base = StaticPublisher::blogUrl($domain);
        $xml = '<?xml version="1.0" encoding="UTF-8"?>' . "\n<rss version=\"2.0\"><channel>\n";
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
        return "# Blog Panel tarafından oluşturuldu\nOptions -Indexes\nDirectoryIndex index.html\n<IfModule mod_rewrite.c>\nRewriteEngine On\n"
            . "RewriteCond %{REQUEST_FILENAME} !-f\nRewriteCond %{REQUEST_FILENAME} !-d\nRewriteCond %{REQUEST_FILENAME}.html -f\nRewriteRule ^(.+?)/?$ $1.html [L]\n</IfModule>\n";
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
