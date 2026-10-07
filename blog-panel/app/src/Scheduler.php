<?php
declare(strict_types=1);

namespace BlogPanel;

final class Scheduler
{
    /** Cron her çalıştığında: zaman aşımına uğrayan işleri kapatır, vakti gelen domainleri tetikler. */
    public static function run(): array
    {
        $db = App::db();
        $s = App::settings();
        $summary = ['expired' => 0, 'triggered' => 0, 'failed' => 0, 'messages' => []];

        $cutoff = date('Y-m-d H:i:s', time() - max(5, $s->int('job_timeout_minutes')) * 60);
        foreach ($db->all("SELECT * FROM jobs WHERE status = 'triggered' AND triggered_at < ?", [$cutoff]) as $job) {
            JobService::fail($job, 'Zaman aşımı: n8n sonuç göndermedi.');
            $summary['expired']++;
        }
        // Tetiklenemeden kalmış (ör. süreç yarıda kesildi) kuyruk kayıtları
        foreach ($db->all("SELECT * FROM jobs WHERE status = 'queued' AND created_at < ?", [$cutoff]) as $job) {
            JobService::fail($job, 'Kuyrukta takılı kaldı.');
            $summary['expired']++;
        }

        $due = $db->all(
            "SELECT d.* FROM domains d
             WHERE d.is_active = 1 AND d.next_post_at IS NOT NULL AND d.next_post_at <= ?
               AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.domain_id = d.id AND j.status IN ('queued','triggered'))
             ORDER BY d.next_post_at ASC LIMIT " . max(1, $s->int('max_jobs_per_run')),
            [Database::now()]
        );
        foreach ($due as $domain) {
            try {
                JobService::trigger($domain, 'cron');
                $summary['triggered']++;
                $summary['messages'][] = "{$domain['domain']}: tetiklendi";
            } catch (\Throwable $e) {
                $summary['failed']++;
                $summary['messages'][] = "{$domain['domain']}: " . $e->getMessage();
            }
        }
        App::settings()->set('scheduler_last_run', Database::now());
        return $summary;
    }
}
