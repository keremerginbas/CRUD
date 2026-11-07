# XRE Sesli Asistan — Kendi Sunucumuzda (LiveKit) Kurulum Planı

Amaç: Vapi'yi kaldırıp aynı asistanı (Selin) kendi Proxmox sunucumuzda çalıştırmak.
- Ses NetGSM → bizim sunucu → NetGSM arasında kalır, ABD'ye gidip gelmez (gecikme / kesik ses biter).
- Platform ücreti olmaz; sadece kullandığımız servisler (ses tanıma, model, ses) ödenir.
- n8n ve Bitrix akışları **değişmez**: sunucu, arama sonunda n8n'e Vapi ile aynı biçimde "end-of-call-report" gönderir.

> Fiyatlar yaklaşık değerlerdir (2026 başı), kurulumdan önce sağlayıcı sayfalarından teyit edilmeli.

---

## 1. Mimari

```
                 NetGSM NetSantral (SIP trunk)
                        │  SIP 5060 + RTP (UDP)
                        ▼
┌──────────────── Proxmox ─ yeni VM: "xre-voice" (Ubuntu 24.04) ────────────────┐
│  livekit-sip   ← telefonu odaya bağlar                                         │
│  livekit-server← ses odaları (WebRTC/RTP)                                      │
│  redis                                                                         │
│  xre-agent (Python, livekit-agents)                                            │
│     ├─ Ses tanıma : Deepgram nova-3 (tr)                                       │
│     ├─ Model      : OpenAI GPT-4.1 / 4.1-mini (Vapi'deki prompt aynen)         │
│     ├─ Ses        : Azure tr-TR-EmelNeural  (ya da ElevenLabs / Cartesia)      │
│     └─ HTTP API   : POST /arama  (n8n buradan arama başlatır)                  │
└────────────────────────────────────────────────────────────────────────────────┘
          │ arama bitince: end-of-call-report (Vapi formatında)
          ▼
   n8n (xre111.shop)  →  Bitrix / Telegram / SMS  (mevcut akışlar)
```

**Neden HestiaCP'nin olduğu makineye değil, ayrı VM?**
HestiaCP nginx/apache, firewall (iptables) ve portları kendisi yönetir. LiveKit'in binlerce UDP portuna
ve 5060'a ihtiyacı var; aynı makinede ikisi birbirinin ayarını bozar. Proxmox'ta ayrı bir VM en temiz yol.

## 2. Sunucu (Proxmox VM)

| Ayar | Değer |
|---|---|
| İşletim sistemi | Ubuntu Server 24.04 LTS |
| CPU | 4 vCPU (aynı anda ~10 görüşme rahat) |
| RAM | 8 GB |
| Disk | 40 GB (ses kaydı tutulacaksa +100 GB) |
| Ağ | Bridge (vmbr0), **sabit genel IP** ya da modem/firewall'da port yönlendirme |

**Açılması gereken portlar (VM'e yönlendirilecek):**

| Port | Protokol | Ne için |
|---|---|---|
| 5060 | UDP + TCP | SIP (NetGSM ↔ livekit-sip) — **sadece NetGSM IP'lerine** açılmalı |
| 10000–20000 | UDP | Telefon sesi (RTP) |
| 7880 | TCP | LiveKit API (sadece iç ağ / n8n sunucusu) |
| 7881 | TCP | WebRTC TCP yedeği |
| 50000–60000 | UDP | WebRTC sesi (tarayıcıdan test için) |
| 8088 | TCP | xre-agent HTTP API (n8n → /arama), sadece n8n IP'sine |

Sunucu Türkiye'deyse gecikme en düşük olur. Sunucu evde/ofiste ve IP'si değişkense **sabit IP şart**;
NetGSM trunk'ı sabit adrese yönlendirir.

## 3. Maliyet (dakika başına, yaklaşık)

| Kalem | Vapi (şimdi) | Kendi sunucu (4.1-mini) | Kendi sunucu (GPT-4.1) |
|---|---|---|---|
| Platform | ~0,05 $ | 0 | 0 |
| Ses tanıma (Deepgram nova-3) | ~0,01 $ | ~0,008 $ | ~0,008 $ |
| Model | ~0,006 $ | ~0,006 $ | ~0,03 $ |
| Ses (TTS) | ElevenLabs ~0,036 $ | Azure ~0,007 $ | Azure ~0,007 $ |
| **Toplam** | **~0,10 $/dk** | **~0,02 $/dk** | **~0,045 $/dk** |

- Sunucu zaten var → ek aylık ücret yok (elektrik/internet hariç).
- NetGSM dakika ücretleri değişmez.
- Örnek: ayda 5.000 dakika → Vapi ~500 $, kendi sunucu ~100–225 $.
- ElevenLabs sesini korumak istenirse kendi sunucuda da kullanılabilir (+~0,03 $/dk).

## 4. Kurulum adımları

### Adım 1 — VM oluştur (Proxmox, ~20 dk)
1. Proxmox → Create VM → Ubuntu 24.04 ISO, 4 vCPU / 8 GB / 40 GB, ağ: vmbr0.
2. Kurulumda sabit IP ver, SSH aç.
3. Modem/firewall'da yukarıdaki portları bu VM'e yönlendir.

### Adım 2 — Docker ve LiveKit (~30 dk)
```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2
sudo mkdir -p /opt/xre-voice && cd /opt/xre-voice
```

`/opt/xre-voice/livekit.yaml`
```yaml
port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true
redis:
  address: 127.0.0.1:6379
keys:
  XRE_API_KEY: XRE_API_SECRET_EN_AZ_32_KARAKTER   # değiştirin
```

`/opt/xre-voice/sip.yaml`
```yaml
api_key: XRE_API_KEY
api_secret: XRE_API_SECRET_EN_AZ_32_KARAKTER
ws_url: ws://127.0.0.1:7880
redis:
  address: 127.0.0.1:6379
sip_port: 5060
rtp_port: 10000-20000
use_external_ip: true
logging:
  level: info
```

`/opt/xre-voice/docker-compose.yml`
```yaml
services:
  redis:
    image: redis:7-alpine
    network_mode: host
    restart: unless-stopped
  livekit:
    image: livekit/livekit-server:latest
    command: --config /etc/livekit.yaml
    volumes: ["./livekit.yaml:/etc/livekit.yaml"]
    network_mode: host
    restart: unless-stopped
  sip:
    image: livekit/sip:latest
    environment:
      SIP_CONFIG_FILE: /etc/sip.yaml
    volumes: ["./sip.yaml:/etc/sip.yaml"]
    network_mode: host
    restart: unless-stopped
  agent:
    build: ./agent
    env_file: ./agent/.env
    network_mode: host
    restart: unless-stopped
```
```bash
docker compose up -d redis livekit sip
```

### Adım 3 — NetGSM trunk bağlantısı (~1 saat, NetGSM ile birlikte)
NetGSM'den alınacaklar: SIP sunucu adresi, SIP kullanıcı adı/şifre (giden arama için), NetGSM'in sinyal IP'leri.

- **Gelen arama:** NetSantral → Gelen Çağrı → numara → *Trunk Yönlendirme* hedefi:
  `sip:+905337436024@<VM_GENEL_IP>:5060` (şu an Vapi'ye giden yönlendirmenin yerine).
- **Giden arama:** LiveKit'e NetGSM hesabı "outbound trunk" olarak tanımlanır.

`lk` (LiveKit CLI) ile:
```bash
# gelen
lk sip inbound create inbound.json      # numaralar + sadece NetGSM IP'leri
lk sip dispatch create dispatch.json    # her gelen arama → "xre-franchise" ajanı
# giden
lk sip outbound create outbound.json    # NetGSM SIP adresi + kullanıcı/şifre
```
`outbound.json` örneği:
```json
{ "trunk": { "name": "netgsm-franchise",
  "address": "<NETGSM_SIP_SUNUCUSU>",
  "numbers": ["+905337436024", "+905337436803", "+905337436004"],
  "auth_username": "<NETGSM_KULLANICI>", "auth_password": "<NETGSM_SIFRE>" } }
```
**Codec:** NetGSM tarafında yalnızca G.711 A-law (PCMA) açık olmalı.

### Adım 4 — Asistan servisi (xre-agent) (~3–5 gün geliştirme, bizim tarafımızda)
Python, `livekit-agents` kütüphanesi. Yapacakları:
1. **Prompt:** `vapi/xre_franchise_outbound.md` ve inbound prompt aynen kullanılır; `{{isim}}`, `{{takvim}}` gibi değişkenler n8n'den gelen değerlerle doldurulur.
2. **Açılış:** n8n'in gönderdiği `dynamic_greeting` ilk cümle olarak söylenir (kesintiye kapalı).
3. **Konuşma:** Deepgram nova-3 (tr) → GPT-4.1 → Azure Emel sesi. Kısa cevaplarda (evet/hayır) hızlı tur bitişi.
4. **Görüşmeyi bitirme aracı:** "Harika, talebinizi aldım…" sonrası aramayı kapatır.
5. **Arama sonu:** Transkriptten aynı yapılandırılmış alanları (`arama_sonucu`, `appointment_date`, `dnc_talebi`, …) çıkarır ve n8n'in mevcut adresine **Vapi'nin end-of-call-report biçiminde** POST eder → n8n/Bitrix akışları hiç değişmeden çalışır.
6. **HTTP API:** `POST /arama` — n8n'deki "Vapi - Aramayı Başlat" düğümü sadece adres değiştirerek buraya döner (aynı JSON gövdesi: `phoneNumberId`, `customer.number`, `assistantOverrides.variableValues`, `metadata`).
7. **Ses kaydı (isteğe bağlı):** LiveKit Egress ile kayıt → MinIO/disk; kayıt linki Bitrix notuna eklenir.

`agent/.env` (anahtarlar repoya konmaz):
```
LIVEKIT_URL=ws://127.0.0.1:7880
LIVEKIT_API_KEY=XRE_API_KEY
LIVEKIT_API_SECRET=...
DEEPGRAM_API_KEY=...
OPENAI_API_KEY=...
AZURE_SPEECH_KEY=...
AZURE_SPEECH_REGION=westeurope
N8N_SONUC_URL=https://xre111.shop/webhook/franchise-vapi-call-result
AGENT_HTTP_TOKEN=...   # n8n bu token ile /arama çağırır
```

### Adım 5 — Test ve geçiş (~1–2 gün)
1. Tek numara (örn. 0533 743 60 04) LiveKit'e yönlendirilir, diğerleri Vapi'de kalır.
2. 20–30 test araması: gecikme (<1,5 sn), "evet" algılama, isim, randevu → Bitrix kontrolü.
3. Sorun yoksa diğer numaralar ve projeler (Motto, Ankaport, EFAS) sırayla taşınır.
4. Vapi aboneliği en son kapatılır (geri dönüş yolu açık kalır).

## 5. Toplam süre ve iş bölümü

| İş | Kim | Süre |
|---|---|---|
| VM + port yönlendirme + sabit IP | Siz / sunucu yöneticisi | 0,5 gün |
| LiveKit + SIP kurulumu | Biz (SSH erişimiyle) | 0,5 gün |
| NetGSM trunk ayarı | Siz + NetGSM destek | 0,5–1 gün |
| xre-agent geliştirme | Biz | 3–5 gün |
| Test + geçiş | Birlikte | 1–2 gün |
| **Toplam** | | **~1,5 hafta** |

## 6. Riskler

- **Sabit IP / port yönlendirme yoksa** NetGSM sunucuya ulaşamaz → kurulumun ön şartı.
- **İnternet yükleme hızı:** her görüşme ~100 kbit/s; 10 eşzamanlı görüşme ~1 Mbit/s yeterli, ama bağlantı kararlı olmalı.
- **Bakım:** Sunucu kapanırsa aramalar durur. Proxmox'ta otomatik başlatma + n8n'de "sunucu cevap vermiyor" Telegram uyarısı eklenmeli.
- **Kayıt/KVKK:** Ses kayıtları kendi sunucumuzda tutulur (avantaj), saklama süresi belirlenmeli.

## 7. Başlamak için gerekenler (sizden)
1. Proxmox'ta VM açıldığında SSH erişimi (IP, kullanıcı).
2. Sunucunun genel (sabit) IP'si ve portların yönlendirildiği bilgisi.
3. NetGSM'den: SIP sunucu adresi, SIP kullanıcı adı/şifre, NetGSM sinyal IP'leri.
4. API anahtarları: Deepgram, OpenAI, Azure Speech (Azure portal → "Speech" kaynağı, bölge West Europe).
