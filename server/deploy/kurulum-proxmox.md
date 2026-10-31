# Proxmox + Hestia kurulumu

```
İnternet ──443──▶ Hestia (CT 100, nginx + Let's Encrypt) ──▶ CT 140 "santral" :3000 (Node + SQLite)
                                                                   ▲
Netgsm webhook'ları ve mobil uygulama bu adrese gelir: https://santral.<alanadi>
```

## 1. Konteyner (Proxmox kabuğunda)

```bash
pveam update && pveam download local debian-12-standard_12.7-1_amd64.tar.zst   # şablon adı pveam available ile kontrol edin
pct create 140 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
  --hostname santral --cores 2 --memory 2048 --swap 512 \
  --rootfs local-lvm:16 --net0 name=eth0,bridge=vmbr0,ip=192.168.1.253/24,gw=192.168.1.1 \
  --unprivileged 1 --onboot 1 --start 1
```

IP adresini ağınıza göre değiştirin. Adres modemin DHCP aralığının dışında olmalı; içinde kalırsa modem aynı adresi başka bir cihaza verip çakışma çıkarır (Hestia 502 hatası verir).

## 2. Uygulama (CT 140 içinde: `pct enter 140`)

```bash
apt update && apt install -y curl git ca-certificates
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs
useradd --system --home /opt/santral santral
git clone --single-branch --depth 1 -b claude/blissful-maxwell-8xset4 https://github.com/keremerginbas/CRUD.git /opt/santral
cd /opt/santral/server && npm ci --omit=dev
cp .env.example .env && nano .env        # JWT_SECRET, PBX_WEBHOOK_SECRET (uzun rastgele), BITRIX_WEBHOOK_URL ...
mkdir -p data && chown -R santral: data && chmod 600 .env && chown santral: .env
sudo -u santral node src/import-lines.js hatlar.csv
cp deploy/santral.service /etc/systemd/system/ && systemctl enable --now santral
curl -s localhost:3000/health
```

Rastgele anahtar üretmek için: `openssl rand -hex 32`

## 3. Alan adı ve HTTPS (Hestia)

1. DNS: `santral.<alanadi>` için A kaydı → ofisin sabit dış IP'si (443 zaten Hestia'ya yönlü).
2. Hestia panelinde alan adını ekleyin, SSL → Let's Encrypt'i açın.
3. Hestia sunucusunda (CT 100, root) bir proxy şablonu oluşturun:

```bash
cd /usr/local/hestia/data/templates/web/nginx
cp default.tpl santral.tpl && cp default.stpl santral.stpl
sed -i 's#proxy_pass .*;#proxy_pass http://192.168.1.253:3000;#' santral.tpl santral.stpl
grep -n proxy_pass santral.stpl     # sadece "location /" bloğunda tek satır kalmalı; statik dosya bloklarını silin
```

4. Panelde alan adı → Düzenle → Gelişmiş → **Proxy şablonu: santral** → Kaydet.
5. Dışarıdan test: `curl https://santral.<alanadi>/health`

## 4. Yedek ve süreklilik

- Proxmox → Veri merkezi → Yedekleme: CT 140 için her gece `yedek` deposuna snapshot yedeği.
- Kritik: ofis interneti veya elektriği giderse santral sunucuya ulaşamaz. **Netgsm panelinde webhook'a ulaşılamazsa gelen aramanın 444 kuyruğuna düşmesini** (varsayılan yönlendirme) mutlaka tanımlayın. Sunucuya UPS önerilir.
- Proxmox (8006) ve Hestia (8083) panellerini internete açmayın; uzaktan erişim için VPN kullanın.

## Güncelleme

```bash
cd /opt/santral && git pull && cd server && npm ci --omit=dev && systemctl restart santral
```
