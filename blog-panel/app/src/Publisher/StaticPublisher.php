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
        $post = $this->uploadImage($domain, $post, $dir);
        if ($postTemplate !== null) {
            return $this->publishWithSiteTemplate($domain, $post, $publishedPosts, $docroot, $dir, $postTemplate);
        }

        $this->assertOwned($dir, [$post['slug'] . '.html', ...self::MANAGED_FILES]);
        $this->writer->write($dir, $post['slug'] . '.html', StaticRenderer::post($domain, $post, $publishedPosts));
        $this->writer->write($dir, 'index.html', StaticRenderer::index($domain, $publishedPosts));
        $this->writer->write($dir, 'sitemap.xml', StaticRenderer::sitemap($domain, $publishedPosts));
        $this->writer->write($dir, 'feed.xml', StaticRenderer::feed($domain, $publishedPosts));
        $this->writer->write($dir, '.htaccess', StaticRenderer::htaccess());

        return ['remote_id' => $post['slug'], 'url' => self::postUrl($domain, $post['slug']), 'image_url' => $post['image_url'] ?? null];
    }

    /** Öne çıkan görseli {klasör}/img/{slug}.webp olarak yükler; başarısızsa yazı görselsiz devam eder. */
    private function uploadImage(array $domain, array $post, string $dir): array
    {
        $image = $post['image'] ?? null;
        if (!$image) {
            return $post;
        }
        try {
            $this->writer->ensureDir($dir, 'img');
            $this->writer->writeBinary($dir . '/img', $image['filename'], $image['bytes'], $image['mime']);
            $post['image_url'] = self::blogUrl($domain) . 'img/' . $image['filename'];
            $post['image_alt'] = $image['alt'];
            $post['image_width'] = $image['width'];
            $post['image_height'] = $image['height'];
        } catch (\Throwable $e) {
            \BlogPanel\Logger::error('image', "{$domain['domain']}: görsel yüklenemedi, yazı görselsiz yayınlanıyor. " . $e->getMessage());
        }
        return $post;
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

        return ['remote_id' => $post['slug'], 'url' => $url, 'image_url' => $post['image_url'] ?? null];
    }

    public function unpublish(array $domain, array $post, array $remainingPosts): string
    {
        $docroot = rtrim((string) $domain['docroot'], '/');
        $url = (string) ($post['remote_url'] ?? '');
        $path = (string) parse_url($url, PHP_URL_PATH);
        if ($docroot === '' || !preg_match('~^/([a-z0-9_-]+)/([a-z0-9_.-]+)$~i', $path, $m)) {
            throw new \RuntimeException('Yazının adresinden dosya yolu çıkarılamadı: ' . $url);
        }
        [$dirName, $name] = [$m[1], $m[2]];
        $siteTemplate = str_ends_with($name, '.html');
        $file = $siteTemplate ? $name : $name . '.html';
        $dir = "$docroot/$dirName";

        $content = $this->writer->read($dir, $file);
        if ($content !== null && !str_contains($content, self::MARKER)) {
            throw new \RuntimeException("$dirName/$file panel tarafından oluşturulmamış; silinmedi.");
        }
        $notes = [];
        if ($content !== null) {
            $this->writer->delete($dir, $file);
            $notes[] = "$dirName/$file silindi";
        } else {
            $notes[] = "$dirName/$file zaten yoktu";
        }

        $imagePath = (string) parse_url((string) ($post['image_url'] ?? ''), PHP_URL_PATH);
        if (preg_match('~^/' . preg_quote($dirName, '~') . '/img/([a-z0-9_.-]+\.(?:webp|png|jpe?g))$~i', $imagePath, $im)) {
            $this->writer->delete("$dir/img", $im[1]);
            $notes[] = "görsel silindi";
        }

        if ($siteTemplate) {
            $listPage = trim((string) ($domain['list_page'] ?? ''), '/');
            if ($listPage !== '') {
                [$listDir, $listFile] = $this->split($docroot, $listPage);
                $list = $this->writer->read($listDir, $listFile);
                $pattern = '~<article\b(?:(?!<article\b).)*?' . preg_quote("$dirName/$file", '~') . '.*?</article>\s*~s';
                if ($list !== null && preg_match($pattern, $list)) {
                    $this->writer->write($listDir, $listFile, (string) preg_replace($pattern, '', $list, 1));
                    $notes[] = "$listPage kartı kaldırıldı";
                }
            }
            $this->removeFromXml($docroot, 'sitemap.xml', '~\s*<url>(?:(?!</url>).)*?<loc>' . preg_quote(htmlspecialchars($url, ENT_XML1), '~') . '</loc>.*?</url>~s', $notes);
            $this->removeFromXml($docroot, 'rss.xml', '~<item>(?:(?!</item>).)*?<link>' . preg_quote(htmlspecialchars($url, ENT_XML1), '~') . '</link>.*?</item>\s*~s', $notes);
        } else {
            // Panel şablonu: aynı klasördeki kalan yazılarla liste, sitemap ve RSS'i yeniden üret
            $folderDomain = ['static_dir' => $dirName] + $domain;
            $prefix = self::blogUrl($folderDomain);
            $left = array_values(array_filter($remainingPosts, static fn ($p) => str_starts_with((string) ($p['remote_url'] ?? ''), $prefix)));
            if ($left) {
                $this->writer->write($dir, 'index.html', StaticRenderer::index($folderDomain, $left));
                $this->writer->write($dir, 'sitemap.xml', StaticRenderer::sitemap($folderDomain, $left));
                $this->writer->write($dir, 'feed.xml', StaticRenderer::feed($folderDomain, $left));
                $notes[] = "$dirName/ listesi güncellendi";
            } else {
                foreach ([...self::MANAGED_FILES, '.blogpanel-test.txt'] as $f) {
                    $c = $this->writer->read($dir, $f);
                    if ($c !== null && ($f === '.blogpanel-test.txt' || str_contains($c, self::MARKER))) {
                        $this->writer->delete($dir, $f);
                    }
                }
                $notes[] = "$dirName/ klasöründe başka yazı kalmadığı için panel dosyaları temizlendi (boş klasörü File Manager'dan silebilirsiniz)";
            }
        }
        return implode('; ', $notes) . '.';
    }

    public function rebuild(array $domain, array $post, array $publishedPosts): string
    {
        $docroot = rtrim((string) $domain['docroot'], '/');
        $path = (string) parse_url((string) ($post['remote_url'] ?? ''), PHP_URL_PATH);
        if ($docroot === '' || !preg_match('~^/([a-z0-9_-]+)/([a-z0-9_.-]+)$~i', $path, $m)) {
            throw new \RuntimeException('Yazının adresinden dosya yolu çıkarılamadı.');
        }
        [$dirName, $name] = [$m[1], $m[2]];
        $dir = "$docroot/$dirName";
        $folderDomain = ['static_dir' => $dirName] + $domain;

        if (!str_ends_with($name, '.html')) {
            $this->assertOwned($dir, [$name . '.html', 'index.html']);
            $this->writer->write($dir, $name . '.html', StaticRenderer::post($folderDomain, $post, $publishedPosts));
            $this->writer->write($dir, 'index.html', StaticRenderer::index($folderDomain, $publishedPosts));
            return "$dirName/$name.html panel şablonuyla yeniden oluşturuldu.";
        }

        $template = $this->writer->read($dir, self::POST_TEMPLATE);
        if ($template === null) {
            throw new \RuntimeException("$dirName/" . self::POST_TEMPLATE . ' bulunamadı.');
        }
        $this->assertOwned($dir, [$name]);
        $url = (string) $post['remote_url'];
        $this->writer->write($dir, $name, StaticRenderer::fillTemplate($template, $folderDomain, $post, $publishedPosts, $url, true));
        $notes = ["$dirName/$name yeniden oluşturuldu"];

        $listPage = trim((string) ($domain['list_page'] ?? ''), '/');
        $card = $this->writer->read($dir, self::CARD_TEMPLATE);
        if ($listPage !== '' && $card !== null) {
            [$listDir, $listFile] = $this->split($docroot, $listPage);
            $list = $this->writer->read($listDir, $listFile);
            if ($list !== null) {
                $cardHtml = StaticRenderer::fillTemplate($card, $folderDomain, $post, $publishedPosts, $url, false);
                $pattern = '~<article\b(?:(?!<article\b).)*?' . preg_quote("$dirName/$name", '~') . '.*?</article>~s';
                if (preg_match($pattern, $list)) {
                    $new = (string) preg_replace_callback($pattern, static fn () => $cardHtml, $list, 1);
                } elseif (str_contains($list, self::LIST_MARKER)) {
                    $new = str_replace(self::LIST_MARKER, self::LIST_MARKER . "\n" . $cardHtml, $list);
                } else {
                    $new = $list;
                }
                if ($new !== $list) {
                    $this->writer->write($listDir, $listFile, $new);
                    $notes[] = "$listPage kartı güncellendi";
                }
            }
        }
        return implode('; ', $notes) . '.';
    }

    private function removeFromXml(string $docroot, string $file, string $pattern, array &$notes): void
    {
        $xml = $this->writer->read($docroot, $file);
        if ($xml !== null && preg_match($pattern, $xml)) {
            $this->writer->write($docroot, $file, (string) preg_replace($pattern, '', $xml, 1));
            $notes[] = "$file güncellendi";
        }
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
