<?php
declare(strict_types=1);

namespace BlogPanel\Publisher;

interface PublisherInterface
{
    /**
     * @param array $domain domains satırı
     * @param array $post   posts satırı (+ 'faq' ve 'tags' dizileri)
     * @param list<array> $publishedPosts bu domainin yayınlanmış yazıları (yenisi dahil, yeniden eskiye)
     * @return array{remote_id:string, url:string}
     */
    public function publish(array $domain, array $post, array $publishedPosts): array;

    /**
     * Yayınlanmış yazıyı siteden kaldırır, kısa bir açıklama döner.
     * @param list<array> $remainingPosts bu domainin kalan yayınlanmış yazıları
     */
    public function unpublish(array $domain, array $post, array $remainingPosts): string;

    /** Yayınlanmış yazının sayfasını güncel şablonla yeniden yazar (yapay zekâ çağrılmaz). */
    public function rebuild(array $domain, array $post, array $publishedPosts): string;

    /** Bağlantıyı dener, kısa bir açıklama döner; hata varsa exception atar. */
    public function test(array $domain): string;
}
