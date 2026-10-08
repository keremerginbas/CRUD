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

    /**
     * İkili dosya (görsel) yükler: WHM'den geçici bir cPanel oturumu açar ve
     * UAPI Fileman::upload_files'a multipart istek gönderir. Gerekli yetki: create-user-session.
     */
    public function uploadFile(string $cpUser, string $dir, string $filename, string $bytes, string $mime): void
    {
        $session = $this->call('create_user_session', ['user' => $cpUser, 'service' => 'cpaneld']);
        $loginUrl = (string) ($session['data']['url'] ?? '');
        $token = (string) ($session['data']['cp_security_token'] ?? '');
        $parts = parse_url($loginUrl);
        if ($loginUrl === '' || $token === '' || empty($parts['host'])) {
            throw new \RuntimeException('cPanel oturumu açılamadı (API token\'da create-user-session yetkisi gerekli).');
        }
        $base = ($parts['scheme'] ?? 'https') . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
        $cookieFile = tempnam(sys_get_temp_dir(), 'bpcookie');
        $tmpFile = tempnam(sys_get_temp_dir(), 'bpimg');
        file_put_contents($tmpFile, $bytes);
        try {
            $common = [
                CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 120, CURLOPT_CONNECTTIMEOUT => 15,
                CURLOPT_COOKIEJAR => $cookieFile, CURLOPT_COOKIEFILE => $cookieFile, CURLOPT_USERAGENT => 'BlogPanel/1.0',
            ];
            if (!$this->verifySsl) {
                $common[CURLOPT_SSL_VERIFYPEER] = false;
                $common[CURLOPT_SSL_VERIFYHOST] = 0;
            }
            // 1) Oturum çerezini al
            $ch = curl_init($loginUrl);
            curl_setopt_array($ch, $common + [CURLOPT_FOLLOWLOCATION => false]);
            if (curl_exec($ch) === false) {
                throw new \RuntimeException('cPanel oturumuna bağlanılamadı: ' . curl_error($ch));
            }
            curl_close($ch);

            // 2) Dosyayı yükle (aynı adlı dosyanın üzerine yazar)
            $ch = curl_init($base . $token . '/execute/Fileman/upload_files');
            curl_setopt_array($ch, $common + [
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => ['dir' => $dir, 'overwrite' => '1', 'file-1' => new \CURLFile($tmpFile, $mime, $filename)],
            ]);
            $resp = curl_exec($ch);
            $err = curl_error($ch);
            $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            curl_close($ch);
            if ($resp === false) {
                throw new \RuntimeException('Görsel yüklenemedi: ' . $err);
            }
            $json = json_decode((string) $resp, true);
            if (!is_array($json) || (int) ($json['status'] ?? 0) !== 1) {
                $msg = is_array($json) ? implode('; ', (array) ($json['errors'] ?? [])) : "HTTP $status";
                throw new \RuntimeException('Görsel yüklenemedi: ' . ($msg ?: 'bilinmeyen hata'));
            }
        } finally {
            @unlink($tmpFile);
            @unlink($cookieFile);
        }
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
