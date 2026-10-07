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

    /** Bağlantıyı dener, kısa bir açıklama döner; hata varsa exception atar. */
    public function test(array $domain): string;
}
