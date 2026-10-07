<?php
// install.php bu dosyayı otomatik olarak config.php adıyla oluşturur.
// Elle kurulum yapacaksanız kopyalayıp düzenleyin: cp config.sample.php config.php
return [
    'db' => [
        'driver'   => 'mysql',          // mysql | sqlite
        'host'     => 'localhost',
        'port'     => 3306,
        'name'     => 'cpuser_blogpanel',
        'user'     => 'cpuser_blogpanel',
        'pass'     => '',
        'path'     => __DIR__ . '/storage/panel.sqlite', // yalnızca sqlite
    ],
    // 32 baytlık base64 anahtar: php -r "echo base64_encode(random_bytes(32));"
    'app_key'  => '',
    'timezone' => 'Europe/Istanbul',
];
