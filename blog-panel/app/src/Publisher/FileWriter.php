<?php
declare(strict_types=1);

namespace BlogPanel\Publisher;

interface FileWriter
{
    public function ensureDir(string $parent, string $name): void;

    public function write(string $dir, string $file, string $content): void;

    /** Dosya içeriğini döner; dosya yoksa null. */
    public function read(string $dir, string $file): ?string;

    /** Dosyayı siler (WHM'de çöp kutusuna taşır); yoksa sessizce geçer. */
    public function delete(string $dir, string $file): void;
}
