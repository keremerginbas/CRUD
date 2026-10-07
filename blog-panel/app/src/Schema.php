<?php
declare(strict_types=1);

namespace BlogPanel;

final class Schema
{
    /** @return string[] */
    public static function statements(string $driver): array
    {
        $pk = $driver === 'sqlite' ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'INT UNSIGNED AUTO_INCREMENT PRIMARY KEY';
        $fk = $driver === 'sqlite' ? 'INTEGER' : 'INT UNSIGNED';
        $text = $driver === 'sqlite' ? 'TEXT' : 'MEDIUMTEXT';
        $tail = $driver === 'sqlite' ? '' : ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

        return [
            "CREATE TABLE IF NOT EXISTS users (
                id $pk,
                username VARCHAR(64) NOT NULL UNIQUE,
                password_hash VARCHAR(255) NOT NULL,
                last_login_at DATETIME NULL,
                created_at DATETIME NOT NULL
            )$tail",
            "CREATE TABLE IF NOT EXISTS settings (
                name VARCHAR(64) NOT NULL PRIMARY KEY,
                value TEXT NULL
            )$tail",
            "CREATE TABLE IF NOT EXISTS domains (
                id $pk,
                domain VARCHAR(255) NOT NULL UNIQUE,
                cpanel_user VARCHAR(64) NULL,
                docroot VARCHAR(512) NULL,
                domain_type VARCHAR(16) NULL,
                is_active TINYINT NOT NULL DEFAULT 0,
                publish_method VARCHAR(16) NOT NULL DEFAULT 'static',
                wp_url VARCHAR(255) NULL,
                wp_user VARCHAR(128) NULL,
                wp_app_password TEXT NULL,
                wp_category_id INT NULL,
                wp_status VARCHAR(16) NOT NULL DEFAULT 'publish',
                static_dir VARCHAR(64) NOT NULL DEFAULT 'blog',
                static_extra_head TEXT NULL,
                niche VARCHAR(255) NULL,
                target_audience VARCHAR(255) NULL,
                language VARCHAR(8) NOT NULL DEFAULT 'tr',
                tone VARCHAR(64) NULL,
                seed_keywords TEXT NULL,
                extra_instructions TEXT NULL,
                post_interval_days INT NOT NULL DEFAULT 3,
                publish_hour INT NOT NULL DEFAULT 10,
                next_post_at DATETIME NULL,
                last_post_at DATETIME NULL,
                fail_count INT NOT NULL DEFAULT 0,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            )$tail",
            "CREATE TABLE IF NOT EXISTS jobs (
                id $pk,
                domain_id $fk NOT NULL,
                status VARCHAR(16) NOT NULL DEFAULT 'queued',
                trigger_type VARCHAR(16) NOT NULL DEFAULT 'cron',
                token VARCHAR(64) NOT NULL,
                error TEXT NULL,
                triggered_at DATETIME NULL,
                completed_at DATETIME NULL,
                created_at DATETIME NOT NULL,
                FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
            )$tail",
            "CREATE TABLE IF NOT EXISTS posts (
                id $pk,
                domain_id $fk NOT NULL,
                job_id $fk NULL,
                title VARCHAR(255) NOT NULL,
                slug VARCHAR(255) NOT NULL,
                meta_title VARCHAR(255) NULL,
                meta_description VARCHAR(512) NULL,
                focus_keyword VARCHAR(255) NULL,
                keywords TEXT NULL,
                excerpt TEXT NULL,
                content_html $text NOT NULL,
                faq_json TEXT NULL,
                tags TEXT NULL,
                seo_score INT NOT NULL DEFAULT 0,
                seo_report TEXT NULL,
                status VARCHAR(16) NOT NULL DEFAULT 'pending',
                error TEXT NULL,
                remote_id VARCHAR(64) NULL,
                remote_url VARCHAR(512) NULL,
                published_at DATETIME NULL,
                created_at DATETIME NOT NULL,
                FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
            )$tail",
            "CREATE TABLE IF NOT EXISTS logs (
                id $pk,
                level VARCHAR(8) NOT NULL,
                context VARCHAR(64) NOT NULL,
                message TEXT NOT NULL,
                created_at DATETIME NOT NULL
            )$tail",
            'CREATE INDEX idx_jobs_status ON jobs (status, domain_id)',
            'CREATE INDEX idx_posts_domain ON posts (domain_id, status)',
            'CREATE INDEX idx_domains_next ON domains (is_active, next_post_at)',
        ];
    }

    public static function install(Database $db): void
    {
        foreach (self::statements($db->driver) as $sql) {
            try {
                $db->pdo->exec($sql);
            } catch (\PDOException $e) {
                // Index zaten varsa yeniden kurulumda yoksay
                if (!str_starts_with($sql, 'CREATE INDEX')) {
                    throw $e;
                }
            }
        }
    }
}
