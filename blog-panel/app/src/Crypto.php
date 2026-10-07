<?php
declare(strict_types=1);

namespace BlogPanel;

/** Veritabanındaki gizli değerleri (API token, şifre) app_key ile şifreler. */
final class Crypto
{
    private string $key;

    public function __construct(string $base64Key)
    {
        $key = base64_decode($base64Key, true);
        if ($key === false || strlen($key) !== SODIUM_CRYPTO_SECRETBOX_KEYBYTES) {
            throw new \RuntimeException('config.php içindeki app_key geçersiz (32 baytlık base64 olmalı).');
        }
        $this->key = $key;
    }

    public function encrypt(string $plain): string
    {
        $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        return 'enc:' . base64_encode($nonce . sodium_crypto_secretbox($plain, $nonce, $this->key));
    }

    public function decrypt(?string $stored): string
    {
        if ($stored === null || $stored === '') {
            return '';
        }
        if (!str_starts_with($stored, 'enc:')) {
            return $stored;
        }
        $raw = base64_decode(substr($stored, 4), true);
        $nonce = substr((string) $raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $plain = sodium_crypto_secretbox_open(substr((string) $raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), $nonce, $this->key);
        if ($plain === false) {
            throw new \RuntimeException('Şifreli değer çözülemedi (app_key değişmiş olabilir).');
        }
        return $plain;
    }
}
