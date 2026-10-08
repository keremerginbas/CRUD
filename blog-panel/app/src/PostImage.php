<?php
declare(strict_types=1);

namespace BlogPanel;

/** n8n'den base64 gelen öne çıkan görseli doğrular. */
final class PostImage
{
    private const MAX_BYTES = 8 * 1024 * 1024;

    /**
     * @param mixed $payload ['b64' => base64, 'alt' => alt metni]
     * @return array{bytes:string, ext:string, mime:string, width:int, height:int, alt:string, filename:string}|null
     */
    public static function fromPayload(mixed $payload, string $slug, string $fallbackAlt): ?array
    {
        if (!is_array($payload) || empty($payload['b64']) || !is_string($payload['b64'])) {
            return null;
        }
        $bytes = base64_decode($payload['b64'], true);
        if ($bytes === false || $bytes === '') {
            throw new \RuntimeException('Görsel verisi geçerli base64 değil.');
        }
        if (strlen($bytes) > self::MAX_BYTES) {
            throw new \RuntimeException('Görsel 8 MB sınırını aşıyor.');
        }
        [$ext, $mime] = match (true) {
            str_starts_with($bytes, "RIFF") && substr($bytes, 8, 4) === 'WEBP' => ['webp', 'image/webp'],
            str_starts_with($bytes, "\x89PNG\r\n\x1a\n") => ['png', 'image/png'],
            str_starts_with($bytes, "\xFF\xD8\xFF") => ['jpg', 'image/jpeg'],
            default => throw new \RuntimeException('Görsel türü desteklenmiyor (yalnızca WebP, PNG, JPEG).'),
        };
        $size = @getimagesizefromstring($bytes);
        if (!$size || $size[0] < 200 || $size[1] < 100) {
            throw new \RuntimeException('Görsel okunamadı veya çok küçük.');
        }
        $alt = trim(strip_tags((string) ($payload['alt'] ?? ''))) ?: $fallbackAlt;

        return [
            'bytes' => $bytes, 'ext' => $ext, 'mime' => $mime, 'width' => (int) $size[0], 'height' => (int) $size[1],
            'alt' => mb_substr($alt, 0, 200), 'filename' => $slug . '.' . $ext,
        ];
    }
}
