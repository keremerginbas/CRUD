#!/usr/bin/env bash
# =====================================================================
#  Proxmox'ta "ai-arama" sanal makinesini OTOMATİK kurar.
#  Proxmox sunucusunda (root@pve) çalıştırın:   bash pve_kur.sh
#
#  Ne yapar:
#   1) Ubuntu 24.04 hazır imajını indirir (kurulum ekranı yok)
#   2) VM 200 "ai-arama": 4 çekirdek, 8 GB RAM, 40 GB disk, IP 192.168.1.50
#   3) Makine açılınca içine Docker ve temel araçları kurar
#   4) Bu klasördeki test betiklerini (kur.sh, ara.sh, kalite.sh) makineye kopyalar
#  Mevcut makinelere ve santrale DOKUNMAZ.
# =====================================================================
set -euo pipefail

VMID=${VMID:-200}
AD=ai-arama
IP=${IP:-192.168.1.50}
GW=${GW:-192.168.1.1}
DEPO=${DEPO:-local-lvm}
KOPRU=${KOPRU:-vmbr0}
KULLANICI=xre
IMAJ_URL=https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img
IMAJ=/var/lib/vz/template/iso/noble-server-cloudimg-amd64.img
ANAHTAR=/root/.ssh/ai_arama_ed25519
BURASI=$(cd "$(dirname "$0")" && pwd)

command -v qm >/dev/null || { echo "Bu betik Proxmox sunucusunda (root@pve) çalıştırılmalı."; exit 1; }
if qm status "$VMID" >/dev/null 2>&1; then echo "VM $VMID zaten var. Başka numara için: VMID=201 bash pve_kur.sh"; exit 1; fi
if ping -c1 -W1 "$IP" >/dev/null 2>&1; then echo "$IP adresi başka bir cihazda kullanılıyor. Başka adres için: IP=192.168.1.60 bash pve_kur.sh"; exit 1; fi
pvesm status | awk '{print $1}' | grep -qx "$DEPO" || { echo "Depo bulunamadı: $DEPO"; exit 1; }

echo "Makineye konsoldan girerken kullanacağınız şifreyi belirleyin (kullanıcı adı: $KULLANICI)."
read -rsp "Şifre: " SIFRE; echo
read -rsp "Şifre (tekrar): " SIFRE2; echo
[ -n "$SIFRE" ] && [ "$SIFRE" = "$SIFRE2" ] || { echo "Şifreler boş ya da birbirini tutmuyor."; exit 1; }

echo "== 1/4 Ubuntu 24.04 imajı indiriliyor =="
mkdir -p "$(dirname "$IMAJ")"
[ -s "$IMAJ" ] || wget -q --show-progress -O "$IMAJ.indiriliyor" "$IMAJ_URL"
[ -s "$IMAJ" ] || mv "$IMAJ.indiriliyor" "$IMAJ"

echo "== 2/4 Sanal makine oluşturuluyor (VM $VMID, $IP) =="
[ -f "$ANAHTAR" ] || ssh-keygen -q -t ed25519 -N "" -C "pve->ai-arama" -f "$ANAHTAR"
qm create "$VMID" --name "$AD" --ostype l26 --cores 4 --cpu host --memory 8192 --balloon 0 \
  --net0 "virtio,bridge=$KOPRU" --scsihw virtio-scsi-pci --agent 1 --onboot 1 \
  --serial0 socket --vga serial0
qm set "$VMID" --scsi0 "$DEPO:0,import-from=$IMAJ,discard=on"
qm resize "$VMID" scsi0 40G
qm set "$VMID" --ide2 "$DEPO:cloudinit" --boot order=scsi0 \
  --ciuser "$KULLANICI" --cipassword "$SIFRE" --sshkeys "$ANAHTAR.pub" \
  --ipconfig0 "ip=$IP/24,gw=$GW" --nameserver "1.1.1.1 8.8.8.8" --ciupgrade 0
qm start "$VMID"

echo "== 3/4 Makinenin açılması bekleniyor (1-3 dakika) =="
SSH="ssh -i $ANAHTAR -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/root/.ssh/known_hosts_ai_arama -o ConnectTimeout=5 $KULLANICI@$IP"
for i in $(seq 1 60); do
  if $SSH true 2>/dev/null; then break; fi
  [ "$i" = 60 ] && { echo "Makineye bağlanılamadı. Proxmox'ta VM $VMID → Konsol'dan durumuna bakın."; exit 1; }
  sleep 5
done
$SSH "cloud-init status --wait >/dev/null 2>&1 || true"

echo "== 4/4 Docker ve araçlar kuruluyor, test betikleri kopyalanıyor =="
$SSH "sudo DEBIAN_FRONTEND=noninteractive apt-get update -q && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q qemu-guest-agent docker.io docker-compose-v2 curl dnsutils ufw && sudo systemctl enable --now qemu-guest-agent docker && sudo timedatectl set-timezone Europe/Istanbul"
for f in kur.sh ara.sh kalite.sh; do
  [ -f "$BURASI/$f" ] && scp -q -i "$ANAHTAR" -o UserKnownHostsFile=/root/.ssh/known_hosts_ai_arama "$BURASI/$f" "$KULLANICI@$IP:~/" && echo "  kopyalandı: $f"
done

echo
echo "TAMAM. Sanal makine hazır: $AD (VM $VMID) — $IP"
echo "Makineye girmek için (bu Proxmox ekranından):"
echo "  ssh -i $ANAHTAR $KULLANICI@$IP"
echo "Sonraki adım (NetGSM test dahilisi hazır olunca), makinenin içinde:"
echo "  sudo bash kur.sh"
