<?php
declare(strict_types=1);

namespace BlogPanel\Publisher;

use BlogPanel\WhmClient;

final class PublisherFactory
{
    public const METHODS = [
        'static'       => 'Statik HTML (WHM üzerinden dosya yazar)',
        'wordpress'    => 'WordPress (REST API + Uygulama Şifresi)',
        'static_local' => 'Statik HTML (panel ile aynı sunucu, doğrudan dosya)',
    ];

    public static function for(array $domain): PublisherInterface
    {
        return match ($domain['publish_method']) {
            'wordpress'    => new WordPressPublisher(),
            'static'       => new StaticPublisher(new WhmFileWriter(WhmClient::fromSettings(), (string) $domain['cpanel_user'])),
            'static_local' => new StaticPublisher(new LocalFileWriter()),
            default        => throw new \RuntimeException('Bilinmeyen yayın yöntemi: ' . $domain['publish_method']),
        };
    }
}
