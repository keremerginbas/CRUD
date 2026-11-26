#!/usr/bin/env bash
# Son yapay zekâ aramasının ses kaydını ölçer: asistanın sesi hatta nasıl gitti?
#   sudo bash /opt/xre-ai/ses_analiz.sh
# - Dip gürültü : asistan sustuğunda hatta kalan ses. -60 dB'den yüksekse (ör. -45) arka planda uğultu/hışırtı var.
# - Tiz oranı   : 2000 Hz üstü enerjinin toplam sese göre düzeyi. -25 dB'den düşükse ses boğuk.
K=/var/spool/asterisk/kayit
olc() {
  local f=$1 ad=$2
  [ -s "$f" ] || { echo "$ad: kayıt yok ($f)"; return; }
  local s; s=$(sox "$f" -n stats 2>&1)
  local sure rms tepe dip tiz
  sure=$(soxi -D "$f" 2>/dev/null | cut -d. -f1)
  rms=$(echo "$s" | awk '/RMS lev dB/{print $4}'); tepe=$(echo "$s" | awk '/Pk lev dB/{print $4}'); dip=$(echo "$s" | awk '/RMS Tr dB/{print $4}')
  tiz=$(sox "$f" -n highpass 2000 stats 2>&1 | awk '/RMS lev dB/{print $4}')
  printf '%-10s süre %ss | ortalama %s dB | tepe %s dB | dip gürültü %s dB | tiz oranı %s dB\n' "$ad" "$sure" "$rms" "$tepe" "$dip" \
    "$(awk -v a="$tiz" -v b="$rms" 'BEGIN{printf "%.1f", a-b}')"
}
olc "$K/son-asistan.wav" "Asistan"
olc "$K/son-musteri.wav" "Müşteri"
echo
echo "Yorum: dip gürültü -60 dB'den yüksekse arka plan sesi var · tiz oranı -25 dB'den düşükse ses boğuk · tepe 0 dB'ye yakınsa ses patlıyor."
