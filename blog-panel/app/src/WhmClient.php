<?php
declare(strict_types=1);

namespace BlogPanel;

/** WHM API 1 istemcisi (API token ile: WHM > Development > Manage API Tokens). */
final class WhmClient
{
    public function __construct(
        private string $host,
        private string $user,
        private string $token,
        private bool $verifySsl = true,
    ) {
        if ($host === '' || $token === '') {
            throw new \RuntimeException('WHM adresi veya API token kayıtlı değil. Ayarlar sayfasında bilgileri girip "Ayarları kaydet" butonuna basın.');
        }
    }

    public static function fromSettings(): self
    {
        $s = App::settings();
        return new self($s->get('whm_host'), $s->get('whm_user'), $s->get('whm_token'), $s->get('whm_verify_ssl') === '1');
    }

    public function version(): string
    {
        $data = $this->call('version');
        return (string) ($data['data']['version'] ?? '?');
    }

    /** @return list<array{domain:string,user:string,docroot:string,domain_type:string}> */
    public function listDomains(): array
    {
        $data = $this->call('get_domain_info');
        $out = [];
        foreach ($data['data']['domains'] ?? [] as $d) {
            if (!in_array($d['domain_type'] ?? '', ['main', 'addon', 'sub'], true)) {
                continue; // parked/alias domainlerin ayrı docroot'u yok
            }
            $out[] = [
                'domain'      => strtolower((string) $d['domain']),
                'user'        => (string) $d['user'],
                'docroot'     => rtrim((string) $d['docroot'], '/'),
                'domain_type' => (string) $d['domain_type'],
            ];
        }
        return $out;
    }

    /** cPanel UAPI fonksiyonunu bir hesap adına çalıştırır. */
    public function uapi(string $cpUser, string $module, string $function, array $params = []): array
    {
        $data = $this->call('uapi_cpanel', [
            'cpanel.user' => $cpUser,
            'cpanel.module' => $module,
            'cpanel.function' => $function,
        ] + $params, 'POST');
        $res = $data['data']['uapi'] ?? null;
        if (!is_array($res)) {
            throw new \RuntimeException("UAPI $module::$function beklenmeyen yanıt döndü.");
        }
        if ((int) ($res['status'] ?? 0) !== 1) {
            throw new \RuntimeException("UAPI $module::$function hatası: " . implode('; ', (array) ($res['errors'] ?? ['bilinmiyor'])));
        }
        return $res;
    }

    /** cPanel API 2 fonksiyonu (UAPI karşılığı olmayan Fileman::mkdir gibi). */
    public function api2(string $cpUser, string $module, string $function, array $params = []): array
    {
        $data = $this->call('cpanel', [
            'cpanel_jsonapi_user' => $cpUser,
            'cpanel_jsonapi_apiversion' => 2,
            'cpanel_jsonapi_module' => $module,
            'cpanel_jsonapi_func' => $function,
        ] + $params, 'POST');
        $res = $data['cpanelresult'] ?? $data['result'] ?? $data;
        if (!empty($res['error'])) {
            throw new \RuntimeException("API2 $module::$function hatası: " . $res['error']);
        }
        return $res;
    }

    private function call(string $function, array $params = [], string $method = 'GET'): array
    {
        $params['api.version'] = 1;
        $url = rtrim($this->host, '/') . '/json-api/' . $function;
        $headers = ['Authorization' => "whm {$this->user}:{$this->token}"];
        $body = null;
        if ($method === 'GET') {
            $url .= '?' . http_build_query($params);
        } else {
            $headers['Content-Type'] = 'application/x-www-form-urlencoded';
            $body = http_build_query($params);
        }
        $r = Http::request($method, $url, $headers, $body, 60, ['verify_ssl' => $this->verifySsl]);
        if ($r['status'] === 401 || $r['status'] === 403) {
            throw new \RuntimeException('WHM yetkilendirme hatası: API token veya kullanıcı adı hatalı.');
        }
        if (!is_array($r['json'])) {
            throw new \RuntimeException("WHM geçersiz yanıt döndü (HTTP {$r['status']}).");
        }
        $meta = $r['json']['metadata'] ?? null;
        if (is_array($meta) && isset($meta['result']) && (int) $meta['result'] !== 1) {
            throw new \RuntimeException("WHM $function hatası: " . ($meta['reason'] ?? 'bilinmiyor'));
        }
        return $r['json'];
    }
}
