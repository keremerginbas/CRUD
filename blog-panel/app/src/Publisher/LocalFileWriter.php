<?php
declare(strict_types=1);

namespace BlogPanel\Publisher;

final class LocalFileWriter implements FileWriter
{
    public function ensureDir(string $parent, string $name): void
    {
        $path = rtrim($parent, '/') . '/' . $name;
        if (!is_dir($path) && !mkdir($path, 0755, true) && !is_dir($path)) {
            throw new \RuntimeException("Klasör oluşturulamadı: $path");
        }
    }

    public function write(string $dir, string $file, string $content): void
    {
        $path = rtrim($dir, '/') . '/' . $file;
        $tmp = $path . '.tmp' . bin2hex(random_bytes(4));
        if (file_put_contents($tmp, $content) === false || !rename($tmp, $path)) {
            @unlink($tmp);
            throw new \RuntimeException("Dosya yazılamadı: $path");
        }
        @chmod($path, 0644);
    }

    public function read(string $dir, string $file): ?string
    {
        $path = rtrim($dir, '/') . '/' . $file;
        if (!is_file($path)) {
            return null;
        }
        $content = file_get_contents($path);
        if ($content === false) {
            throw new \RuntimeException("Dosya okunamadı: $path");
        }
        return $content;
    }
}
