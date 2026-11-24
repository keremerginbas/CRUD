// ===================== JARVIS AYARLARI =====================
// Bu dosyayı düzenle, kaydet; bir sonraki açılışta geçerli olur.
window.JARVIS_AYARLAR = {
  HITAP: "patron",

  // Hava durumu için şehir adı (anahtar gerekmez, Open-Meteo kullanılır)
  SEHIR: "İstanbul",

  // Takvim: iCal (.ics) adresi. Boş bırakırsan takvim atlanır.
  //  - Google Takvim: Ayarlar → takvimini seç → "iCal biçimindeki gizli adres"
  //  - iCloud (Mac Takvim): takvime sağ tık → Paylaş → "Herkese Açık Takvim" → linki kopyala (webcal:// olabilir)
  //  - Outlook: Ayarlar → Takvim → Paylaşılan takvimler → Takvim yayımla → ICS linki
  // Birden fazla takvim için adresleri aynı tırnağın içinde virgülle ayır.
  // Not: Bu satır tek satır kalmalı (açılış betikleri adresi buradan okur).
  TAKVIM_URL: "",

  // Kapanış cümleleri (saate göre)
  KAPANIS_SABAH: "Bugün bolca işimiz var. Hadi kodlamaya başlayalım.",
  KAPANIS_OGLEN: "Kaldığımız yerden devam edelim. Hadi kodlamaya başlayalım.",
  KAPANIS_AKSAM: "Mesai uzun sürecek gibi. Hadi kodlamaya başlayalım.",

  // Tercih edilen sesler (ilk bulunan kullanılır)
  // Windows/Edge: Ahmet (erkek, en JARVIS'e benzeyen) · Mac: Yelda
  SES_TERCIHI: ["Ahmet", "Tolga", "Yelda", "Emel", "tr-TR"],
};
