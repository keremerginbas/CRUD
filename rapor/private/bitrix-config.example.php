<?php

return [
    'webhook_base' => 'https://SIZIN-DOMAIN.bitrix24.com.tr/rest/1/WEBHOOK_TOKEN/',

    'timezone' => 'Europe/Istanbul',

    'cache_seconds' => 120,
    'max_activity_pages' => 200,
    'max_summary_pages' => 200,
    'max_lead_lookups' => 2000,

    'calls_cache_seconds' => 60,
    'max_call_pages' => 500,

    'allowed_origins' => [
        'https://xrex.com.tr',
        'https://www.xrex.com.tr',
    ],
];
