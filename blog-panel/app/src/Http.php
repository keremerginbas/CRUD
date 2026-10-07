<?php
declare(strict_types=1);

namespace BlogPanel;

final class Http
{
    /**
     * @param array<string,string> $headers
     * @return array{status:int, body:string, json:mixed}
     */
    public static function request(string $method, string $url, array $headers = [], ?string $body = null, int $timeout = 30, array $opts = []): array
    {
        $ch = curl_init($url);
        $headerLines = [];
        foreach ($headers as $k => $v) {
            $headerLines[] = "$k: $v";
        }
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST  => strtoupper($method),
            CURLOPT_HTTPHEADER     => $headerLines,
            CURLOPT_TIMEOUT        => $timeout,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_USERAGENT      => 'BlogPanel/1.0 (+n8n)',
        ]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }
        if (isset($opts['verify_ssl']) && !$opts['verify_ssl']) {
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
            curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
        }
        if (isset($opts['basic_auth'])) {
            curl_setopt($ch, CURLOPT_USERPWD, $opts['basic_auth']);
        }
        $resp = curl_exec($ch);
        $err = curl_error($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);

        if ($resp === false) {
            throw new \RuntimeException("Bağlantı hatası ($url): $err");
        }
        return ['status' => $status, 'body' => (string) $resp, 'json' => json_decode((string) $resp, true)];
    }
}
