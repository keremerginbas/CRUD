<?php
declare(strict_types=1);

namespace BlogPanel\Publisher;

use BlogPanel\WhmClient;

/** Dosyaları WHM üzerinden ilgili cPanel hesabı adına yazar (dosya sahipliği doğru kalır). */
final class WhmFileWriter implements FileWriter
{
    public function __construct(private WhmClient $whm, private string $cpUser)
    {
        if ($cpUser === '') {
            throw new \RuntimeException('Domain için cPanel kullanıcısı tanımlı değil (WHM senkronizasyonu yapın).');
        }
    }

    public function ensureDir(string $parent, string $name): void
    {
        try {
            $this->whm->api2($this->cpUser, 'Fileman', 'mkdir', ['path' => $parent, 'name' => $name, 'permissions' => '0755']);
        } catch (\RuntimeException $e) {
            if (!preg_match('/exist/i', $e->getMessage())) {
                throw $e;
            }
        }
    }

    public function write(string $dir, string $file, string $content): void
    {
        $this->whm->uapi($this->cpUser, 'Fileman', 'save_file_content', [
            'dir' => $dir,
            'file' => $file,
            'content' => $content,
            'from_charset' => 'UTF-8',
            'to_charset' => 'UTF-8',
            'fallback' => 1,
        ]);
    }

    public function read(string $dir, string $file): ?string
    {
        try {
            $res = $this->whm->uapi($this->cpUser, 'Fileman', 'get_file_content', ['dir' => $dir, 'file' => $file]);
        } catch (\RuntimeException $e) {
            if (preg_match('/exist|no such file|not found|bulunamad|mevcut de/i', $e->getMessage())) {
                return null;
            }
            throw $e;
        }
        return (string) ($res['data']['content'] ?? '');
    }
}
