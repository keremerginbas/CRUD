<?php
declare(strict_types=1);

namespace BlogPanel\Publisher;

/**
 * WordPress olmayan siteler için: /blog/{slug}.html, /blog/index.html,
 * /blog/sitemap.xml ve /blog/feed.xml dosyalarını üretip yazar.
 */
final class StaticPublisher implements PublisherInterface
{
    public function __construct(private FileWriter $writer)
    {
    }

    public static function postUrl(array $domain, string $slug): string
    {
        return self::blogUrl($domain) . $slug;
    }

    public static function blogUrl(array $domain): string
    {
        return 'https://' . $domain['domain'] . '/' . trim($domain['static_dir'] ?: 'blog', '/') . '/';
    }

    public function publish(array $domain, array $post, array $publishedPosts): array
    {
        $docroot = rtrim((string) $domain['docroot'], '/');
        if ($docroot === '') {
            throw new \RuntimeException('Domain için docroot tanımlı değil.');
        }
        $dirName = trim($domain['static_dir'] ?: 'blog', '/');
        if (!preg_match('~^[a-z0-9_-]+$~i', $dirName)) {
            throw new \RuntimeException('Blog klasör adı yalnızca harf, rakam, - ve _ içerebilir.');
        }
        $dir = $docroot . '/' . $dirName;

        $this->writer->ensureDir($docroot, $dirName);
        $this->writer->write($dir, $post['slug'] . '.html', StaticRenderer::post($domain, $post, $publishedPosts));
        $this->writer->write($dir, 'index.html', StaticRenderer::index($domain, $publishedPosts));
        $this->writer->write($dir, 'sitemap.xml', StaticRenderer::sitemap($domain, $publishedPosts));
        $this->writer->write($dir, 'feed.xml', StaticRenderer::feed($domain, $publishedPosts));
        $this->writer->write($dir, '.htaccess', StaticRenderer::htaccess());

        return ['remote_id' => $post['slug'], 'url' => self::postUrl($domain, $post['slug'])];
    }

    public function test(array $domain): string
    {
        $docroot = rtrim((string) $domain['docroot'], '/');
        $dirName = trim($domain['static_dir'] ?: 'blog', '/');
        $this->writer->ensureDir($docroot, $dirName);
        $this->writer->write($docroot . '/' . $dirName, '.blogpanel-test.txt', 'ok ' . date('c'));
        return "Yazma testi başarılı: $docroot/$dirName";
    }
}
