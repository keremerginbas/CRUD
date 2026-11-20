# NetGSM → Ofis Sunucusu Ses Kalitesi Testi

Amaç: NetGSM sesini Amerika'daki Vapi yerine **ofisteki sunucuda** karşılarsak paket kaybının bitip bitmediğini 1 günde ölçmek.
Canlı Vapi hatlarına dokunmaz; NetSantral'da açılan **ayrı bir test dahilisi** kullanılır.

## 1. Proxmox: sanal makine
- Ubuntu Server 24.04, **4 çekirdek, 8 GB RAM, 60 GB disk** (test sonrası LiveKit de bu makineye kurulacak)
- Ağ: `vmbr0`, yerel ağda **sabit IP** (ör. 192.168.1.50)

## 2. Ofis modemi / güvenlik duvarı
Ofisteki mevcut santral (CT 150, 192.168.1.247) **UDP 5060** ve **UDP 10000–10200** kullanıyor. O yönlendirmelere **dokunmayın**; test ayrı portlarda çalışır:
- **UDP 5070** → test sanal makinesinin yerel IP'si
- **UDP 20000–20200** → test sanal makinesinin yerel IP'si
- Modemde **SIP ALG** kapalı olmalı (mevcut santral için de zaten kapalı olmalı)

Ofis dış IP'si (kayıtlardaki): **81.214.28.155** — `kur.sh` çalışırken otomatik doğrular.

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
