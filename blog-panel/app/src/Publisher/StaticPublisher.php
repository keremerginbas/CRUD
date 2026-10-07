<?php
declare(strict_types=1);

namespace BlogPanel\Publisher;

/**
 * WordPress olmayan siteler için iki çalışma biçimi:
 *
 * 1) Panel şablonu (varsayılan): /{klasör}/{slug}.html, index.html, sitemap.xml,
 *    feed.xml ve .htaccess dosyalarını panel kendi tasarımıyla üretir.
 *
 * 2) Site şablonu: klasörde "_sablon-yazi.html" varsa yazı sitenin kendi
 *    tasarımıyla /{klasör}/{slug}.html olarak yazılır. "Liste sayfası" tanımlıysa
 *    (ör. rehber.html) yeni yazının kartı "_sablon-kart.html" ile üretilip
 *    LIST_MARKER yorumunun hemen altına eklenir; kök dizindeki sitemap.xml ve
 *    rss.xml varsa yeni adres eklenir. Sitenin başka hiçbir dosyasına dokunulmaz.
 */
final class StaticPublisher implements PublisherInterface
{
    /** Panelin ürettiği her dosyada bulunan işaret; işaretsiz dosyaların üzerine yazılmaz. */
    public const MARKER = 'blog-panel:generated';

    public const POST_TEMPLATE = '_sablon-yazi.html';
    public const CARD_TEMPLATE = '_sablon-kart.html';
    public const LIST_MARKER = '<!-- blog-panel:liste -->';

    private const MANAGED_FILES = ['index.html', 'sitemap.xml', 'feed.xml', '.htaccess'];

    public function __construct(private FileWriter $writer)
    {
    }

    public static function postUrl(array $domain, string $slug, bool $siteTemplate = false): string
    {
        return self::blogUrl($domain) . $slug . ($siteTemplate ? '.html' : '');
    }

    public static function blogUrl(array $domain): string
    {
        return 'https://' . $domain['domain'] . '/' . self::dirName($domain) . '/';
    }

    /** Liste sayfasının adresi (site şablonunda rehber.html gibi), yoksa blog klasörü. */
    public static function listUrl(array $domain): string
    {
        $page = trim((string) ($domain['list_page'] ?? ''), '/');
        return $page !== '' ? 'https://' . $domain['domain'] . '/' . $page : self::blogUrl($domain);
    }

    public function publish(array $domain, array $post, array $publishedPosts): array
    {
        [$docroot, $dirName, $dir] = $this->paths($domain);
        $this->writer->ensureDir($docroot, $dirName);

        $postTemplate = $this->writer->read($dir, self::POST_TEMPLATE);
        if ($postTemplate !== null) {
            return $this->publishWithSiteTemplate($domain, $post, $publishedPosts, $docroot, $dir, $postTemplate);
        }

        $this->assertOwned($dir, [$post['slug'] . '.html', ...self::MANAGED_FILES]);
        $this->writer->write($dir, $post['slug'] . '.html', StaticRenderer::post($domain, $post, $publishedPosts));
        $this->writer->write($dir, 'index.html', StaticRenderer::index($domain, $publishedPosts));
        $this->writer->write($dir, 'sitemap.xml', StaticRenderer::sitemap($domain, $publishedPosts));
        $this->writer->write($dir, 'feed.xml', StaticRenderer::feed($domain, $publishedPosts));
        $this->writer->write($dir, '.htaccess', StaticRenderer::htaccess());

        return ['remote_id' => $post['slug'], 'url' => self::postUrl($domain, $post['slug'])];
    }

    public function test(array $domain): string
    {
        [$docroot, $dirName, $dir] = $this->paths($domain);
        $this->writer->ensureDir($docroot, $dirName);

        if ($this->writer->read($dir, self::POST_TEMPLATE) !== null) {
            $notes = ["Site şablonu bulundu: $dirName/" . self::POST_TEMPLATE];
            $listPage = trim((string) ($domain['list_page'] ?? ''), '/');
            if ($listPage !== '') {
                [$listDir, $listFile] = $this->split($docroot, $listPage);
                $list = $this->writer->read($listDir, $listFile);
                if ($list === null) {
                    throw new \RuntimeException("Liste sayfası bulunamadı: $listPage");
                }
                if (!str_contains($list, self::LIST_MARKER)) {
                    throw new \RuntimeException("$listPage içinde " . self::LIST_MARKER . ' işareti yok; yeni yazı kartlarının ekleneceği yere bu satırı ekleyin.');
                }
                if ($this->writer->read($dir, self::CARD_TEMPLATE) === null) {
                    throw new \RuntimeException("Kart şablonu bulunamadı: $dirName/" . self::CARD_TEMPLATE);
                }
                $notes[] = "liste sayfası hazır: $listPage";
            }
            $this->writer->write($dir, '.blogpanel-test.txt', 'ok ' . date('c'));
            return 'Yazma testi başarılı. ' . implode('; ', $notes) . '.';
        }

        $this->assertOwned($dir, self::MANAGED_FILES);
        $this->writer->write($dir, '.blogpanel-test.txt', 'ok ' . date('c'));
        return "Yazma testi başarılı: $dir";
    }

    private function publishWithSiteTemplate(array $domain, array $post, array $publishedPosts, string $docroot, string $dir, string $template): array
    {
        $file = $post['slug'] . '.html';
        $this->assertOwned($dir, [$file]);
        $url = self::postUrl($domain, $post['slug'], true);

        // Önce liste sayfasını hazırla: işaret/şablon eksikse hiçbir şey yazmadan dur
        $listPage = trim((string) ($domain['list_page'] ?? ''), '/');
        $listUpdate = null;
        if ($listPage !== '') {
            [$listDir, $listFile] = $this->split($docroot, $listPage);
            $list = $this->writer->read($listDir, $listFile);
            $card = $this->writer->read($dir, self::CARD_TEMPLATE);
            if ($list === null || $card === null || !str_contains($list, self::LIST_MARKER)) {
                throw new \RuntimeException("Liste sayfası ($listPage), " . self::LIST_MARKER . ' işareti veya ' . self::CARD_TEMPLATE . ' eksik; yazı yayınlanmadı. "Yayın bağlantısını test et" ile kontrol edin.');
            }
            if (!str_contains($list, self::dirName($domain) . '/' . $file)) {
                $cardHtml = StaticRenderer::fillTemplate($card, $domain, $post, $publishedPosts, $url, false);
                $listUpdate = [$listDir, $listFile, str_replace(self::LIST_MARKER, self::LIST_MARKER . "\n" . $cardHtml, $list)];
            }
        }

        $this->writer->write($dir, $file, StaticRenderer::fillTemplate($template, $domain, $post, $publishedPosts, $url, true));
        if ($listUpdate) {
            $this->writer->write(...$listUpdate);
        }
        $this->appendToSitemap($docroot, $url, $post);
        $this->appendToRss($docroot, $url, $post);

        return ['remote_id' => $post['slug'], 'url' => $url];
    }

    private function appendToSitemap(string $docroot, string $url, array $post): void
    {
        $xml = $this->writer->read($docroot, 'sitemap.xml');
        if ($xml === null || str_contains($xml, '<loc>' . $url . '</loc>') || !str_contains($xml, '</urlset>')) {
            return;
        }
        $entry = '  <url><loc>' . htmlspecialchars($url, ENT_XML1) . '</loc><lastmod>' . date('Y-m-d', strtotime($post['published_at'] ?? 'now')) . "</lastmod></url>\n";
        $this->writer->write($docroot, 'sitemap.xml', substr_replace($xml, $entry, (int) strrpos($xml, '</urlset>'), 0));
    }

    private function appendToRss(string $docroot, string $url, array $post): void
    {
        $xml = $this->writer->read($docroot, 'rss.xml');
        if ($xml === null || str_contains($xml, '<link>' . $url . '</link>') || !str_contains($xml, '</channel>')) {
            return;
        }
        $x = static fn (string $s) => htmlspecialchars($s, ENT_XML1 | ENT_QUOTES, 'UTF-8');
        $item = '<item><title>' . $x($post['title']) . '</title><link>' . $x($url) . '</link><guid>' . $x($url) . '</guid>'
            . '<pubDate>' . date(DATE_RSS, strtotime($post['published_at'] ?? 'now')) . '</pubDate><description>' . $x($post['excerpt'] ?? '') . "</description></item>\n";
        $pos = strpos($xml, '<item');
        $xml = $pos !== false ? substr_replace($xml, $item, $pos, 0) : substr_replace($xml, $item, (int) strrpos($xml, '</channel>'), 0);
        $this->writer->write($docroot, 'rss.xml', $xml);
    }

    /** @return array{0:string,1:string,2:string} docroot, klasör adı, tam klasör yolu */
    private function paths(array $domain): array
    {
        $docroot = rtrim((string) $domain['docroot'], '/');
        if ($docroot === '') {
            throw new \RuntimeException('Domain için docroot tanımlı değil.');
        }
        $dirName = self::dirName($domain);
        if (!preg_match('~^[a-z0-9_-]+$~i', $dirName)) {
            throw new \RuntimeException('Blog klasör adı yalnızca harf, rakam, - ve _ içerebilir.');
        }
        return [$docroot, $dirName, $docroot . '/' . $dirName];
    }

    private static function dirName(array $domain): string
    {
        return trim((string) ($domain['static_dir'] ?: 'blog'), '/');
    }

    /** "rehber.html" veya "blog/index.html" → [klasör, dosya]; docroot dışına çıkılamaz. */
    private function split(string $docroot, string $relative): array
    {
        if (!preg_match('~^[a-z0-9_./-]+$~i', $relative) || str_contains($relative, '..')) {
            throw new \RuntimeException('Liste sayfası yolu geçersiz: ' . $relative);
        }
        $dir = dirname($relative);
        return [$docroot . ($dir === '.' ? '' : '/' . $dir), basename($relative)];
    }

    /** Klasörde panel dışında oluşturulmuş bir dosya varsa hiçbir şey yazmadan durur. */
    private function assertOwned(string $dir, array $files): void
    {
        $foreign = [];
        foreach ($files as $file) {
            $content = $this->writer->read($dir, $file);
            if ($content !== null && !str_contains($content, self::MARKER)) {
                $foreign[] = $file;
            }
        }
        if ($foreign) {
            throw new \RuntimeException(sprintf(
                '%s klasöründe panel dışında oluşturulmuş dosya var (%s); mevcut içeriği bozmamak için hiçbir şey yazılmadı. Domain ayarlarından farklı bir "Blog klasörü" seçin.',
                $dir,
                implode(', ', $foreign)
            ));
        }
    }
}
