<?php
declare(strict_types=1);

namespace BlogPanel;

final class N8nClient
{
    public function __construct(private string $webhookUrl, private string $secret)
    {
        if ($webhookUrl === '' || $secret === '') {
            throw new \RuntimeException('n8n webhook adresi veya gizli anahtar kayıtlı değil. Ayarlar sayfasında girip "Ayarları kaydet" butonuna basın.');
        }
    }

    public static function fromSettings(): self
    {
        return new self(App::settings()->get('n8n_webhook_url'), App::settings()->get('n8n_secret'));
    }

    public function send(array $payload): void
    {
        $r = Http::request(
            'POST',
            $this->webhookUrl,
            ['Content-Type' => 'application/json', 'X-Blog-Panel-Secret' => $this->secret],
            json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            20
        );
        if ($r['status'] < 200 || $r['status'] >= 300) {
            throw new \RuntimeException("n8n webhook HTTP {$r['status']} döndü: " . mb_substr($r['body'], 0, 200));
        }
    }

    public function ping(): void
    {
        $this->send(['test' => true, 'sent_at' => date('c')]);
    }
}
