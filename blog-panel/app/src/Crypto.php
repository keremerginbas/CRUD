<?php
declare(strict_types=1);

namespace BlogPanel;

/**
 * Veritabanındaki gizli değerleri (API token, şifre) app_key ile şifreler.
 * libsodium varsa XSalsa20-Poly1305, yoksa OpenSSL AES-256-GCM kullanır.
 */
final class Crypto
{
    private const KEY_BYTES = 32;

    private string $key;

    public function __construct(string $base64Key, private ?bool $useSodium = null)
    {
        $key = base64_decode($base64Key, true);
        if ($key === false || strlen($key) !== self::KEY_BYTES) {
            throw new \RuntimeException('config.php içindeki app_key geçersiz (32 baytlık base64 olmalı).');
        }
        $this->key = $key;
        $this->useSodium ??= function_exists('sodium_crypto_secretbox');
        if (!$this->useSodium && !function_exists('openssl_encrypt')) {
            throw new \RuntimeException('PHP\'de sodium veya openssl eklentisinden biri açık olmalı.');
        }
    }

    public function encrypt(string $plain): string
    {
        if ($this->useSodium) {
            $nonce = random_bytes(\SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
            return 'enc:' . base64_encode($nonce . sodium_crypto_secretbox($plain, $nonce, $this->key));
        }
        $iv = random_bytes(12);
        $cipher = openssl_encrypt($plain, 'aes-256-gcm', $this->key, OPENSSL_RAW_DATA, $iv, $tag);
        if ($cipher === false) {
            throw new \RuntimeException('Şifreleme başarısız.');
        }
        return 'gcm:' . base64_encode($iv . $tag . $cipher);
    }

    public function decrypt(?string $stored): string
    {
        if ($stored === null || $stored === '') {
            return '';
        }
        if (str_starts_with($stored, 'gcm:')) {
            $raw = (string) base64_decode(substr($stored, 4), true);
            $plain = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', $this->key, OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
        } elseif (str_starts_with($stored, 'enc:')) {
            if (!function_exists('sodium_crypto_secretbox_open')) {
                throw new \RuntimeException('Bu değer sodium ile şifrelenmiş; PHP\'de sodium eklentisini açın.');
            }
            $raw = (string) base64_decode(substr($stored, 4), true);
            $nonce = substr($raw, 0, \SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
            $plain = sodium_crypto_secretbox_open(substr($raw, \SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), $nonce, $this->key);
        } else {
            return $stored;
        }
        if ($plain === false) {
            throw new \RuntimeException('Şifreli değer çözülemedi (app_key değişmiş olabilir).');
        }
        return $plain;
    }
}
