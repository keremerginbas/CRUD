# J.A.R.V.I.S. — Sesli asistan (Windows)

"Hey Jarvis" deyin, konuşun. Gerçekçi bir sesle (ElevenLabs) akıcı şekilde cevap verir, sözünü
kesebilirsiniz, zor sorularda Claude ile derin düşünür ve gerekirse internette arar.
Toplantıyı ya da sizi uzun uzun dinleyip özetler, sorular sorar ve konuştuklarınızı hatırlar.

## Ne yapabilir?

| Ne dersiniz | Ne yapar |
|---|---|
| "Hey Jarvis" ya da **Ctrl+Alt+J** | Uyanır, "Efendim?" der, konuşma başlar |
| Herhangi bir soru, sohbet | Kısa ve doğal cevap verir, gerekince soru sorar |
| "Şu planı bir düşün…", "Dolar kaç?", "Bugünkü haberler ne?" | Claude ile derin düşünür, gerekirse internette arar |
| "Beni dinle", "Toplantıyı dinle", "Not al" | Susar ve kaydeder (mikrofon + bilgisayarın sesi). Bitince "Hey Jarvis" deyin: yazıya döker, özetler, sesli anlatır, sorular sorar. Notlar `notlar` klasörüne kaydedilir |
| "Excel'i aç", "YouTube'u aç", "Bitrix'i aç" | Uygulamayı / siteyi açar |
| "Ekrana bak, bu hata ne diyor?" | Ekran görüntüsü alır, Claude ile yorumlar |
| "Kopyaladığım metni özetle" | Panodaki metni okur |
| "Yirmi dakika sonra toplantıyı hatırlat" | Zamanı gelince sesli hatırlatır |
| "Bunu hatırla: …" | Hafızasına kaydeder (`hafiza.md`) |
| "Geçen hafta ne konuşmuştuk?" | Hafızada ve toplantı notlarında arar |
| "Görüşürüz", "Sağ ol Jarvis" | Konuşmayı kapatır, tekrar "Hey Jarvis"i beklemeye döner |

## Kurulum (bir kez)

1. **Python 3.12** kurun: <https://www.python.org/downloads/> — kurulumun ilk ekranında
   **"Add python.exe to PATH"** kutusunu işaretleyin.
2. Bu klasörü bilgisayarınızda bir yere koyun (ör. `Belgeler\jarvis`).
3. **`KUR.bat`**'a çift tıklayın. Gerekenleri indirir (birkaç dakika), sonra `.env` dosyasını açar.
4. `.env` dosyasına anahtarlarınızı yazın ve kaydedin:
   - `ELEVENLABS_API_KEY` — elevenlabs.io → sol alt profil → **API Keys**
   - `ANTHROPIC_API_KEY` — platform.claude.com → **API Keys**
   - `JARVIS_KULLANICI_ADI` — size nasıl hitap etsin
5. **`BASLAT.bat`** ile çalıştırın. İlk açılışta ElevenLabs hesabınızda "JARVIS" adlı asistanı
   kendisi oluşturur.
6. İsterseniz **`OTOMATIK_BASLAT.bat`**: Windows açılınca kendiliğinden başlar.

## Ses seçimi

Varsayılan ses "George" (tok, sakin erkek sesi). Daha "Jarvis" ya da Türk aksanlı bir ses için:
elevenlabs.io → **Voices** → **Voice Library**'de beğendiğiniz sesi **Add to my voices** ile ekleyin,
sesin yanındaki **⋯ → Copy voice ID** ile kimliğini kopyalayıp `.env`'de `JARVIS_SES_ID=` satırına
yapıştırın. Jarvis'i yeniden başlatınca asistan kendiliğinden güncellenir.

## İpuçları ve sorun giderme

- **Kulaklık en iyisidir.** Kulaklık kullanıyorsanız `.env`'de `JARVIS_KULAKLIK=evet` yapın;
  Jarvis konuşurken rahatça sözünü kesebilirsiniz.
- **Hoparlörde kendi sözünü kesiyorsa** `JARVIS_SOZ_KESME_ESIGI`'ni artırın (ör. 4000);
  siz araya giremiyorsanız azaltın (ör. 1500).
- **Yanlışlıkla uyanıyorsa** `JARVIS_UYANDIRMA_ESIGI`'ni artırın (ör. 0.75);
  **"Hey Jarvis" dediğinizde uyanmıyorsa** azaltın (ör. 0.45). İngilizce gibi "hey CAR-vis" demek
  daha iyi tanınır. Her zaman Ctrl+Alt+J de çalışır.
- **Cevaplar geç geliyorsa** `.env`'de `JARVIS_SOHBET_MODELI=claude-sonnet-5-5` deneyin (daha hızlı;
  zor sorular yine Claude Opus ile derin düşünülür). Ses için `JARVIS_SES_MODELI=eleven_flash_v2_5`
  en hızlısıdır, varsayılan `eleven_v3_conversational` en gerçekçisidir.
- **Bilgisayarın sesi kaydedilemedi uyarısı:** yalnızca mikrofon kaydedilir; toplantıyı hoparlörden
  dinliyorsanız yine de duyar.
- **Kısayol bazı pencerelerde çalışmıyorsa:** yönetici olarak açılmış pencerelerde Windows
  kısayolu engeller; "Hey Jarvis" kullanın.
- Ekrandaki yazılar bu pencerede canlı görünür (🗣️ siz, 🤖 Jarvis, 🧠 derin düşünme, 🛠️ araç).

## Maliyet (yaklaşık)

- **ElevenLabs:** konuşma açıkken dakika başına ücret (plana göre, genelde dakikası birkaç cent).
  Dinleme modunda konuşma kapalıdır, yalnızca kayıt sonunda yazıya dökme ücreti alınır.
- **Claude:** derin düşünme, ekran yorumlama, özet ve hafıza notları için kendi anahtarınızdan
  kullanım kadar ücret.
- "Hey Jarvis" algılama tamamen bilgisayarınızda çalışır, ücretsizdir ve beklerken internete ses gitmez.

## Gizlilik

- `.env` (anahtarlarınız), `hafiza.md`, `notlar/` ve `durum/` yalnızca sizin bilgisayarınızda durur;
  bunları kimseyle paylaşmayın.
- Konuşma sırasında ses ElevenLabs'e, metinler Claude'a gider. Dinleme modundaki kayıtlar
  `notlar` klasöründe saklanır; istemediklerinizi silebilirsiniz.

## Dosyalar

- `jarvis.py` — ana program (uyandırma, konuşma, dinleme/özet, hafıza)
- `araclar.py` — bilgisayar araçları (uygulama/site açma, ekran, pano, hatırlatıcı, hafıza)
- `hafiza.md` — Jarvis'in hatırladıkları (Not Defteri ile düzenleyebilirsiniz)
- `notlar/` — dinleme kayıtları ve özetleri
