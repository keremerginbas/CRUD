<?php
declare(strict_types=1);

namespace BlogPanel;

/** Yayın öncesi basit on-page SEO kontrolü (0-100 puan). */
final class SeoAnalyzer
{
    /**
     * @param array{title:string,meta_title:string,meta_description:string,focus_keyword:string,slug:string,content_html:string,faq:array} $a
     * @return array{score:int, checks:list<array{label:string,ok:bool,weight:int,detail:string}>, word_count:int}
     */
    public static function analyze(array $a, int $minWords = 900): array
    {
        $kw = self::lower(trim($a['focus_keyword']));
        $text = trim((string) preg_replace('/\s+/u', ' ', html_entity_decode(strip_tags(str_replace('<', ' <', $a['content_html'])), ENT_QUOTES, 'UTF-8')));
        $words = $text === '' ? 0 : count(preg_split('/\s+/u', $text));
        $lowerText = self::lower($text);
        $metaTitleLen = mb_strlen($a['meta_title']);
        $metaDescLen = mb_strlen($a['meta_description']);
        preg_match_all('~<h2\b~i', $a['content_html'], $h2);
        preg_match_all('~<h3\b~i', $a['content_html'], $h3);
        preg_match_all('~<a\s[^>]*href=~i', $a['content_html'], $links);
        $firstPara = preg_match('~<p\b[^>]*>(.*?)</p>~is', $a['content_html'], $m) ? self::lower(strip_tags($m[1])) : '';
        $kwCount = $kw !== '' ? mb_substr_count($lowerText, $kw) : 0;
        $kwWords = max(1, count(preg_split('/\s+/u', $kw)));
        $density = $words > 0 ? round($kwCount * $kwWords / $words * 100, 2) : 0.0;
        $kwSlug = $kw !== '' ? slugify($kw) : '';

        $checks = [
            ['Odak anahtar kelime belirlendi', $kw !== '', 10, $kw !== '' ? $a['focus_keyword'] : 'boş'],
            ['Başlıkta anahtar kelime', $kw !== '' && str_contains(self::lower($a['title']), $kw), 12, $a['title']],
            ['Meta başlık 30-65 karakter', $metaTitleLen >= 30 && $metaTitleLen <= 65, 8, "$metaTitleLen karakter"],
            ['Meta açıklama 120-160 karakter', $metaDescLen >= 120 && $metaDescLen <= 160, 8, "$metaDescLen karakter"],
            ['Meta açıklamada anahtar kelime', $kw !== '' && str_contains(self::lower($a['meta_description']), $kw), 8, ''],
            ['URL (slug) anahtar kelimeyi içeriyor', $kwSlug !== '' && str_contains($a['slug'], $kwSlug), 6, $a['slug']],
            ['İlk paragrafta anahtar kelime', $kw !== '' && str_contains($firstPara, $kw), 10, ''],
            ["En az $minWords kelime", $words >= $minWords, 14, "$words kelime"],
            ['En az 3 H2 alt başlık', count($h2[0]) >= 3, 8, count($h2[0]) . ' H2, ' . count($h3[0]) . ' H3'],
            ['Anahtar kelime yoğunluğu %0,5 - %2,5', $density >= 0.5 && $density <= 2.5, 6, "%$density ($kwCount kez)"],
            ['İç/dış bağlantı var', count($links[0]) >= 1, 4, count($links[0]) . ' bağlantı'],
            ['SSS (FAQ) bölümü', count($a['faq']) >= 3, 6, count($a['faq']) . ' soru'],
        ];

        $total = 0;
        $earned = 0;
        $out = [];
        foreach ($checks as [$label, $ok, $weight, $detail]) {
            $total += $weight;
            $earned += $ok ? $weight : 0;
            $out[] = ['label' => $label, 'ok' => (bool) $ok, 'weight' => $weight, 'detail' => (string) $detail];
        }
        return ['score' => (int) round($earned / $total * 100), 'checks' => $out, 'word_count' => $words];
    }

    private static function lower(string $s): string
    {
        return mb_strtolower(strtr($s, ['I' => 'ı', 'İ' => 'i']), 'UTF-8');
    }
}
