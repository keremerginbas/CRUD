<?php
/**
 * Plugin Name: Blog Panel SEO Meta
 * Description: Blog Panel'in REST API ile gönderdiği Yoast / Rank Math SEO alanlarını kabul eder.
 * Version: 1.0
 *
 * Kurulum: bu dosyayı wp-content/mu-plugins/ klasörüne yükleyin (klasör yoksa oluşturun).
 */

add_action('init', static function (): void {
    $keys = [
        '_yoast_wpseo_title', '_yoast_wpseo_metadesc', '_yoast_wpseo_focuskw',
        'rank_math_title', 'rank_math_description', 'rank_math_focus_keyword',
    ];
    foreach ($keys as $key) {
        register_post_meta('post', $key, [
            'type' => 'string',
            'single' => true,
            'show_in_rest' => true,
            'sanitize_callback' => 'sanitize_text_field',
            'auth_callback' => static fn () => current_user_can('edit_posts'),
        ]);
    }
});
