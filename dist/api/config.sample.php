<?php
// Bu dosyayı "config.php" adıyla kopyalayın ve anahtarınızı girin.
// config.php .gitignore'dadır ve .htaccess ile dışarıdan erişime kapalıdır.
return [
    // OpenAI API anahtarı (sk-...). Alternatif: sunucuda OPENAI_API_KEY ortam değişkeni.
    'openai_api_key' => '',
    'openai_model'   => 'gpt-4o-mini',
    // İletişim formunun gideceği adres
    'mail_to'        => 'cmshafriyat01@gmail.com',
    'mail_from'      => 'noreply@cmsharfiyat.com.tr',
    // IP başına 10 dakikada izin verilen sohbet mesajı
    'rate_limit'     => 30,
];
