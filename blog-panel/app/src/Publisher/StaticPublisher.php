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
 *    Şablonda FOLDER_MARKER varsa yazı /{klasör}/{slug}/index.html olarak yazılır ve
 *    adresi /{klasör}/{slug}/ olur (her yazının kendi klasörü olan siteler için).
 */
final class StaticPublisher implements PublisherInterface
{
    /** Panelin ürettiği her dosyada bulunan işaret; işaretsiz dosyaların üzerine yazılmaz. */
    public const MARKER = 'blog-panel:generated';

    public const POST_TEMPLATE = '_sablon-yazi.html';
    public const CARD_TEMPLATE = '_sablon-kart.html';
    public const LIST_MARKER = '<!-- blog-panel:liste -->';
    public const FOLDER_MARKER = '<!-- blog-panel:klasor -->';
    private const CARD_END = '<!-- /blog-panel:kart -->';

    private const MANAGED_FILES = ['index.html', 'sitemap.xml', 'feed.xml', '.htaccess'];

    public function __construct(private FileWriter $writer)
    {
    }

    public static function postUrl(array $domain, string $slug, bool $siteTemplate = false, bool $folder = false): string
    {
        return self::blogUrl($domain) . $slug . ($folder ? '/' : ($siteTemplate ? '.html' : ''));
    }

    public static function blogUrl(array $domain): string
    {
        return 'https://' . $domain['domain'] . '/' . self::dirName($domain) . '/';
    }

    /** Liste sayfasının adresi (site şablonunda rehber.html gibi), yoksa blog klasörü. */
    public static function listUrl(array $domain): string
    {
        $page = trim((string) ($domain['list_page'] ?? ''), '/');
        // "blog/index.html" → https://site/blog/ (sitenin kanonik adresi)
        if ($page === '') {
            return self::blogUrl($domain);
        }
        return 'https://' . $domain['domain'] . '/' . preg_replace('~(^|/)index\.html?$~i', '$1', $page);
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
            $folder = str_contains((string) $this->writer->read($dir, self::POST_TEMPLATE), self::FOLDER_MARKER);
            $notes = ["Site şablonu bulundu: $dirName/" . self::POST_TEMPLATE . ($folder ? " (yazılar $dirName/{slug}/ klasörlerine yazılır)" : '')];
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
        $folder = str_contains($template, self::FOLDER_MARKER);
        if ($folder && strtolower($post['slug']) === 'img') {
            throw new \RuntimeException('"img" adresi görseller için ayrılmış; yazı yayınlanmadı.');
        }
        [$postDir, $file] = $folder ? [$dir . '/' . $post['slug'], 'index.html'] : [$dir, $post['slug'] . '.html'];
        $this->assertOwned($postDir, [$file]);
        $url = self::postUrl($domain, $post['slug'], true, $folder);
        $rel = ltrim((string) parse_url($url, PHP_URL_PATH), '/');

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
            if (!str_contains($list, '/' . $rel)) {
                $cardHtml = self::wrapCard($rel, StaticRenderer::fillTemplate($card, $domain, $post, $publishedPosts, $url, false));
                $listUpdate = [$listDir, $listFile, str_replace(self::LIST_MARKER, self::LIST_MARKER . "\n" . $cardHtml, $list)];
            }
        }

        if ($folder) {
            $this->writer->ensureDir($dir, $post['slug']);
        }
        $this->writer->write($postDir, $file, StaticRenderer::fillTemplate($template, $domain, $post, $publishedPosts, $url, true));
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
        [$dirName, $dir, $postDir, $file, $rel, $mode] = $this->locate($docroot, $path, $url);
        $siteTemplate = $mode !== 'panel';

        $content = $this->writer->read($postDir, $file);
        if ($content !== null && !str_contains($content, self::MARKER)) {
            throw new \RuntimeException("$rel panel tarafından oluşturulmamış; silinmedi.");
        }
        $notes = [];
        if ($content !== null) {
            $this->writer->delete($postDir, $file);
            $notes[] = $mode === 'folder' ? "{$rel}index.html silindi (boş kalan $rel klasörünü File Manager'dan silebilirsiniz)" : "$rel silindi";
        } else {
            $notes[] = "$rel zaten yoktu";
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
                $new = $list !== null ? self::replaceCard($list, $rel, '') : null;
                if ($new !== null) {
                    $this->writer->write($listDir, $listFile, $new);
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
        $url = (string) ($post['remote_url'] ?? '');
        [$dirName, $dir, $postDir, $file, $rel, $mode] = $this->locate($docroot, (string) parse_url($url, PHP_URL_PATH), $url);
        $folderDomain = ['static_dir' => $dirName] + $domain;

        if ($mode === 'panel') {
            $this->assertOwned($dir, [$file, 'index.html']);
            $this->writer->write($dir, $file, StaticRenderer::post($folderDomain, $post, $publishedPosts));
            $this->writer->write($dir, 'index.html', StaticRenderer::index($folderDomain, $publishedPosts));
            return "$rel panel şablonuyla yeniden oluşturuldu.";
        }

        $template = $this->writer->read($dir, self::POST_TEMPLATE);
        if ($template === null) {
            throw new \RuntimeException("$dirName/" . self::POST_TEMPLATE . ' bulunamadı.');
        }
        $this->assertOwned($postDir, [$file]);
        if ($mode === 'folder') {
            $this->writer->ensureDir($dir, basename($postDir));
        }
        $this->writer->write($postDir, $file, StaticRenderer::fillTemplate($template, $folderDomain, $post, $publishedPosts, $url, true));
        $notes = ["$rel yeniden oluşturuldu"];

        $listPage = trim((string) ($domain['list_page'] ?? ''), '/');
        $card = $this->writer->read($dir, self::CARD_TEMPLATE);
        if ($listPage !== '' && $card !== null) {
            [$listDir, $listFile] = $this->split($docroot, $listPage);
            $list = $this->writer->read($listDir, $listFile);
            if ($list !== null) {
                $cardHtml = self::wrapCard($rel, StaticRenderer::fillTemplate($card, $folderDomain, $post, $publishedPosts, $url, false));
                if (($replaced = self::replaceCard($list, $rel, $cardHtml . "\n")) !== null) {
                    $new = $replaced;
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

    /**
     * Yayınlanmış bir yazının adres yolundan dosya konumunu çözer.
     * /blog/slug → panel şablonu, /blog/slug.html → site şablonu, /blog/slug/ → klasör başına yazı.
     *
     * @return array{0:string,1:string,2:string,3:string,4:string,5:string} klasör adı, blog klasörü, yazı klasörü, dosya, göreli yol, biçim
     */
    private function locate(string $docroot, string $path, string $url): array
    {
        if ($docroot === '' || !preg_match('~^/([a-z0-9_-]+)/([a-z0-9_.-]+)(/?)$~i', $path, $m)) {
            throw new \RuntimeException('Yazının adresinden dosya yolu çıkarılamadı: ' . $url);
        }
        [$dirName, $name] = [$m[1], $m[2]];
        $dir = "$docroot/$dirName";
        if ($m[3] === '/') {
            if (!preg_match('~^[a-z0-9_-]+$~i', $name)) {
                throw new \RuntimeException('Yazının adresinden dosya yolu çıkarılamadı: ' . $url);
            }
            return [$dirName, $dir, "$dir/$name", 'index.html', "$dirName/$name/", 'folder'];
        }
        if (str_ends_with($name, '.html')) {
            return [$dirName, $dir, $dir, $name, "$dirName/$name", 'file'];
        }
        return [$dirName, $dir, $dir, $name . '.html', "$dirName/$name.html", 'panel'];
    }

    /** Kartı, sonradan bulunup güncellenebilmesi/kaldırılabilmesi için işaret yorumlarıyla sarar. */
    private static function wrapCard(string $rel, string $html): string
    {
        return '<!-- blog-panel:kart ' . $rel . ' -->' . trim($html) . self::CARD_END;
    }

    /**
     * Liste sayfasındaki kartı değiştirir ya da ('' ile) kaldırır; kart bulunamazsa null.
     * İşaretli kartı arar; eski (işaretsiz) kartlarda yazı adresini içeren <article> bloğuna bakar.
     */
    private static function replaceCard(string $list, string $rel, string $replacement): ?string
    {
        $patterns = [
            '~<!-- blog-panel:kart ' . preg_quote($rel, '~') . ' -->.*?' . preg_quote(self::CARD_END, '~') . '\s*~s',
            '~<article\b(?:(?!<article\b).)*?' . preg_quote($rel, '~') . '.*?</article>\s*~s',
        ];
        foreach ($patterns as $pattern) {
            if (preg_match($pattern, $list)) {
                return (string) preg_replace_callback($pattern, static fn () => $replacement, $list, 1);
            }
        }
        return null;
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
