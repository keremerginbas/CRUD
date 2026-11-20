# NetGSM → Ofis Sunucusu Ses Kalitesi Testi

Amaç: NetGSM sesini Amerika'daki Vapi yerine **ofisteki sunucuda** karşılarsak paket kaybının bitip bitmediğini 1 günde ölçmek.
Canlı Vapi hatlarına dokunmaz; NetSantral'da açılan **ayrı bir test dahilisi** kullanılır.

## 1. Proxmox: sanal makine
- Ubuntu Server 24.04, **4 çekirdek, 8 GB RAM, 60 GB disk** (test sonrası LiveKit de bu makineye kurulacak)
- Ağ: `vmbr0`, yerel ağda **sabit IP** (ör. 192.168.1.50)

## 2. Ofis modemi / güvenlik duvarı
- **UDP 5060** → sanal makinenin yerel IP'si
- **UDP 10000–20000** → sanal makinenin yerel IP'si
- Modemde **SIP ALG** ayarı varsa **kapatın** (ses sorunlarının en sık sebebi)

## 3. NetSantral
- Yeni bir **dahili** açın (ör. 1099) ve şifre verin. Mevcut Vapi yönlendirmelerine dokunmayın.
- Dahiliye dış arama yetkisi verin (giden test için).

## 4. Kurulum (sanal makinede)
`kur.sh`, `ara.sh`, `kalite.sh` dosyalarını makineye kopyalayın, sonra:

```bash
sudo bash kur.sh
```

Dahili kullanıcı adı ve şifresini sorar. Sonunda kayıt durumunda **Registered** görmelisiniz.

## 5. Test aramaları
Kendi cep telefonunuza 5 arama, her biri 1–2 dakika konuşarak (söylediğiniz size geri yankılanır):

```bash
sudo bash ara.sh 05XXXXXXXXX
```

## 6. Sonuç

```bash
sudo bash kalite.sh
```

| Sonuç | Anlamı |
|---|---|
| Kayıp < %1, jitter < 30 ms | Sorun Vapi yolundaymış → LiveKit kurulumuna geçilir |
| Kayıp yüksek | Sorun NetGSM altyapısında → başka Türk SIP operatörüyle (Verimor / Bulutfon) aynı test |

Ses kayıtları: `/var/spool/asterisk/test/`
