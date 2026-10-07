<?php
declare(strict_types=1);

namespace BlogPanel;

final class Settings
{
    public const SECRET_KEYS = ['whm_token', 'n8n_secret'];

    public const DEFAULTS = [
        'panel_base_url'        => '',
        'whm_host'              => '',
        'whm_user'              => 'root',
        'whm_token'             => '',
        'whm_verify_ssl'        => '1',
        'n8n_webhook_url'       => '',
        'n8n_secret'            => '',
        'default_interval_days' => '3',
        'default_publish_hour'  => '10',
        'max_jobs_per_run'      => '5',
        'job_timeout_minutes'   => '45',
        'retry_minutes'         => '120',
        'max_consecutive_fails' => '3',
        'min_word_count'        => '900',
        'min_seo_score'         => '40',
    ];

    private ?array $cache = null;

    public function __construct(private Database $db, private Crypto $crypto)
    {
    }

    public function get(string $name): string
    {
        $this->cache ??= array_column($this->db->all('SELECT name, value FROM settings'), 'value', 'name');
        $value = $this->cache[$name] ?? self::DEFAULTS[$name] ?? '';
        return in_array($name, self::SECRET_KEYS, true) ? $this->crypto->decrypt($value) : (string) $value;
    }

    public function int(string $name): int
    {
        return (int) $this->get($name);
    }

    public function set(string $name, string $value): void
    {
        if (in_array($name, self::SECRET_KEYS, true) && $value !== '') {
            $value = $this->crypto->encrypt($value);
        }
        $this->db->run('DELETE FROM settings WHERE name = ?', [$name]);
        $this->db->insert('settings', ['name' => $name, 'value' => $value]);
        $this->cache = null;
    }
}
