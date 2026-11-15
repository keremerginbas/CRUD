# Tarayıcı telefonu (Webphone / SIP.js)

Çalışan, CRM sekmesinden kulaklığıyla arar ve gelen aramayı karşılar; ayrı masa
telefonu ya da softphone gerekmez. Üst çubuktaki telefon simgesi paneli açar.

## Neler var

- Santrale SIP.js ile WSS üzerinden kayıt, kopunca kendiliğinden yeniden bağlanma
- Giden arama (tuş takımı veya müşteri kartındaki **Tarayıcıdan ara**), gelen aramada müşteri adıyla yanıtla/reddet
- Sessize alma, bekletme, görüşme içi tuşlama (IVR), başka dahiliye/numaraya aktarma
- Görüşme kaydı müşteri kartına düşer (Asterisk AMI dinleyicisi bağlıysa CDR'den, değilse tarayıcıdan)
- Aynı kullanıcı iki sekme açarsa yalnız biri kaydolur; diğer sekmeden başlatılan arama ona devredilir
- SIP şifresi sunucuda AES-256-GCM ile şifreli saklanır, yalnız sahibinin tarayıcısına gönderilir

## Kurulum

### 1. Santral tarafı (WebRTC ucu)

Tarayıcı düz SIP (UDP/TCP) konuşamaz; santralin **WSS** ucu ve WebRTC (DTLS-SRTP) desteği gerekir.

**Asterisk / FreePBX / Issabel** (`http.conf` ve `pjsip.conf`):

```ini
; http.conf
[general]
enabled=yes
tlsenable=yes
tlsbindaddr=0.0.0.0:8089
tlscertfile=/etc/letsencrypt/live/santral.example.com/fullchain.pem
tlsprivatekey=/etc/letsencrypt/live/santral.example.com/privkey.pem

; pjsip.conf
[transport-wss]
type=transport
protocol=wss
bind=0.0.0.0

[101]
type=endpoint
context=from-internal
disallow=all
allow=opus,ulaw,alaw
webrtc=yes
auth=101
aors=101
[101]
type=auth
auth_type=userpass
username=101
password=GUCLU-BIR-SIFRE
[101]
type=aor
max_contacts=1
remove_existing=yes
```

FreePBX'te aynı ayar arayüzden yapılır: dahili → Advanced → *Enable WebRTC defaults: Yes*.
Eski `chan_sip` modülü yüklüyse WebSocket'i o kapar; `modules.conf` içinde
`[modules]` altına `noload => chan_sip.so` yazın.

**Netgsm Netsantral gibi bulut santraller:** sağlayıcıdan WSS/WebRTC adresi isteyin.
Vermiyorlarsa araya kendi Asterisk'iniz girer; Netgsm ona SIP trunk olarak bağlanır.

### 2. TURN sunucusu (önerilir)

Kurumsal ağ, CGNAT veya 4G arkasında ses tek yönlü kalabilir. `coturn` kurup
`use-auth-secret` ve `static-auth-secret=...` ayarlayın; aynı sırrı CRM'e girin.
CRM her oturum için 1 saatlik geçici TURN kimliği üretir.

### 3. CRM ayarları

Entegrasyonlar → **Tarayıcı telefonu (Webphone / SIP.js)**:

| Ayar | Örnek |
| --- | --- |
| `WEBPHONE_WSS_URL` | `wss://santral.example.com:8089/ws` |
| `WEBPHONE_SIP_DOMAIN` | boşsa WSS adresindeki sunucu adı |
| `WEBPHONE_STUN_URLS` | boşsa Google STUN; kapatmak için `none` |
| `WEBPHONE_TURN_URLS` | `turn:turn.example.com:3478,turns:turn.example.com:5349` |
| `WEBPHONE_TURN_SECRET` | coturn `static-auth-secret` değeri |
| `WEBPHONE_TURN_USERNAME` / `WEBPHONE_TURN_PASSWORD` | sır yoksa sabit kimlik |
| `PBX_DIAL_PREFIX` | dış hat ön eki (ör. `9`) |

### 4. Her çalışan

Telefon simgesi → dahili numarası, (gerekiyorsa) SIP kullanıcı adı ve SIP şifresi →
**Kaydet ve bağlan**. Tarayıcı mikrofon izni ister; CRM adresi HTTPS olmalıdır.

## Sorun giderme

| Belirti | Olası neden |
| --- | --- |
| "Santral girişi reddetti" | Dahili/SIP şifresi yanlış ya da dahilide WebRTC kapalı |
| Sürekli "Santrale bağlanıyor…" | WSS adresi/portu kapalı, sertifika geçersiz, `chan_sip` WebSocket'i kapıyor |
| Arama açılıyor, ses yok | TURN yok ya da santralin RTP portları (10000-20000/UDP) kapalı |
| "Telefon başka sekmede açık" | Normal; aramalar o sekmeden yapılır |

## Maliyet

Yazılım tarafında ek lisans yoktur: SIP.js (MIT), Asterisk/FreePBX (GPL), coturn (BSD) ve
Let's Encrypt sertifikası ücretsizdir. Aylık gider altyapıdan doğar.
Rakamlar Kasım 2026 için **yaklaşık tahmindir**; sağlayıcıdan güncel teklif alın.

| Kalem | Ne zaman gerekir | Yaklaşık aylık |
| --- | --- | --- |
| SIP.js, CRM geliştirmesi | Her zaman | 0 |
| Santral sunucusu (Asterisk/FreePBX, 2 vCPU / 4 GB VPS) | Sağlayıcı WSS vermiyorsa ya da kendi santraliniz yoksa | 5-15 € |
| TURN sunucusu (coturn) | Ofis dışı / kurumsal ağ kullanıcıları varsa | Santralle aynı VPS'te 0; ayrı VPS 4-6 € |
| TURN trafiği | Yalnız aktarılan (relay) görüşmelerde | Dakikada ~1,5 MB; çoğu VPS kotasının içinde |
| SSL sertifikası | WSS için şart | 0 (Let's Encrypt) |
| Numara, dahili aboneliği, dakika ücretleri | Operatör (Netgsm vb.) | Mevcut tarifeniz; webphone bunu değiştirmez |
| Kulaklık | Çalışan başına bir kez | 500-1.500 TL (USB kulaklık) |

Bant genişliği: görüşme başına Opus ile ~50 kbps, G.711 ile ~90 kbps (her yön).
10 eşzamanlı görüşme 1 Mbps'in altındadır.
