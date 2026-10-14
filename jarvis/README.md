# J.A.R.V.I.S. — Sesli asistan (Mac ve Windows)

"Hey Jarvis" deyin, konuşun. Gerçekçi bir sesle (ElevenLabs) akıcı şekilde cevap verir, sözünü
kesebilirsiniz, zor sorularda OpenAI (ya da Claude) ile derin düşünür ve gerekirse internette arar.
Toplantıyı ya da sizi uzun uzun dinleyip özetler, sorular sorar ve konuştuklarınızı hatırlar.

## Ne yapabilir?

| Ne dersiniz | Ne yapar |
|---|---|
| "Hey Jarvis" ya da **Ctrl+Option+J** (Windows: Ctrl+Alt+J) | Uyanır, "Efendim?" der, konuşma başlar |
| Herhangi bir soru, sohbet | Kısa ve doğal cevap verir, gerekince soru sorar |
| "Şu planı bir düşün…", "Dolar kaç?", "Bugünkü haberler ne?" | Derin düşünür, gerekirse internette arar |
| "Beni dinle", "Toplantıyı dinle", "Not al" | Susar ve kaydeder. Bitince "Hey Jarvis" deyin: yazıya döker, özetler, sesli anlatır, sorular sorar. Notlar `notlar` klasörüne kaydedilir |
| "Excel'i aç", "Safari'yi aç", "Bitrix'i aç" | Uygulamayı / siteyi açar |
| "Ekrana bak, bu hata ne diyor?" | Ekran görüntüsü alır ve yorumlar |
| "Kopyaladığım metni özetle" | Panodaki metni okur |
| "Yirmi dakika sonra toplantıyı hatırlat" | Zamanı gelince sesli hatırlatır |
| "Bunu hatırla: …" | Hafızasına kaydeder (`hafiza.md`) |
| "Geçen hafta ne konuşmuştuk?" | Hafızada ve toplantı notlarında arar |
| "Görüşürüz", "Sağ ol Jarvis" | Konuşmayı kapatır, tekrar "Hey Jarvis"i beklemeye döner |

## Mac'te kurulum (bir kez)

1. **Python 3.12** kurun: <https://www.python.org/downloads/macos/> → "macOS 64-bit universal2 installer".
2. Bu klasörü bir yere koyun (ör. `Belgeler/jarvis`).
3. **Terminal**'i açın (Spotlight: ⌘ Boşluk → "Terminal") ve şunu yazın
   (klasör yolunu kendinize göre değiştirin):
   ```
   cd ~/Documents/jarvis
   bash KUR.command
   ```
   Gerekenleri indirir (birkaç dakika), sonra `.env` dosyasını TextEdit'te açar.
4. `.env` dosyasına anahtarlarınızı yazın ve kaydedin (⌘S):
   - `ELEVENLABS_API_KEY` — elevenlabs.io → sol alt profil → **API Keys**
   - `OPENAI_API_KEY` — platform.openai.com → **API keys** → **Create new secret key** (`sk-` ile başlar)
     *(İsterseniz OpenAI yerine Claude: `ANTHROPIC_API_KEY` — platform.claude.com → API Keys. İkisinden biri yeterli.)*
   - `JARVIS_KULLANICI_ADI` — size nasıl hitap etsin
5. Çalıştırın:
   ```
   bash BASLAT.command
   ```
   İlk açılışta ElevenLabs hesabınızda "JARVIS" adlı asistanı kendisi oluşturur.

> Sonraki seferlerde Finder'da `BASLAT.command`'a çift tıklayabilirsiniz. İlk çift tıklamada
> "tanımlanamayan geliştirici" uyarısı çıkarsa: dosyaya **sağ tıklayın → Aç → Aç**.

### Mac izinleri (ilk açılışta)

Mac, Terminal'in şu işler için izin istemesini ister. **Ayarlar → Gizlilik ve Güvenlik** altından:

| İzin | Ne için | Gerekli mi |
|---|---|---|
| **Mikrofon** → Terminal | Sizi duyması | Evet (ilk açılışta sorar, "İzin Ver" deyin) |
| **Giriş İzleme** (Input Monitoring) → Terminal | Ctrl+Option+J kısayolu | İsteğe bağlı ("Hey Jarvis" izinsiz de çalışır) |
| **Ekran Kaydı** → Terminal | "Ekrana bak" | İsteğe bağlı |

İzin verdikten sonra Terminal'i kapatıp Jarvis'i yeniden başlatın.

### Toplantıda karşı tarafı da kaydetmek (isteğe bağlı, Mac)

Mac, uygulamaların bilgisayardan çıkan sesi kaydetmesine doğrudan izin vermez; bunun için ücretsiz
**BlackHole** sanal ses sürücüsü gerekir. Kurmazsanız Jarvis yalnızca mikrofonu kaydeder
(toplantı hoparlörden açıksa yine duyar; kulaklıktaysa karşı tarafı duyamaz).

1. BlackHole 2ch'i kurun: <https://existential.audio/blackhole/> (ya da Homebrew: `brew install blackhole-2ch`).
2. **Audio MIDI Ayarları** uygulamasını açın → sol alttaki **+** → **Çoklu Çıkış Aygıtı Oluştur** →
   hem hoparlörünüzü/kulaklığınızı hem **BlackHole 2ch**'i işaretleyin.
3. Toplantıdan önce menü çubuğundaki ses simgesinden çıkışı bu **Çoklu Çıkış Aygıtı** yapın.
   (Bu aygıt seçiliyken klavyedeki ses tuşları çalışmaz; toplantı bitince eski çıkışa dönün.)

Jarvis BlackHole'u kendisi bulur; dinleme modunda mikrofonla birleştirip kaydeder.

## Windows'ta kurulum

1. **Python 3.12** kurun (<https://www.python.org/downloads/>), ilk ekranda **"Add python.exe to PATH"**'i işaretleyin.
2. **`KUR.bat`**'a çift tıklayın, açılan `.env`'e anahtarları yazın.
3. **`BASLAT.bat`** ile çalıştırın. **`OTOMATIK_BASLAT.bat`**: Windows açılınca kendiliğinden başlar.

Windows'ta toplantı sesi ek kurulum gerekmeden kaydedilir.

## Ses seçimi

Varsayılan ses "George" (tok, sakin erkek sesi). Başka bir ses için: elevenlabs.io → **Voices** →
**Voice Library**'de beğendiğiniz sesi **Add to my voices** ile ekleyin, **⋯ → Copy voice ID** ile
kimliğini kopyalayıp `.env`'de `JARVIS_SES_ID=` satırına yapıştırın. Jarvis'i yeniden başlatınca
asistan kendiliğinden güncellenir.

## İpuçları ve sorun giderme

- **Kulaklık en iyisidir.** Hoparlörde Jarvis konuşurken mikrofon kapanır (yoksa kendi sesini duyup
  kendine cevap verir); bu yüzden sözünü sesle kesemezsiniz, cümlesini bitirmesini bekleyin.
  Kulaklık kullanıyorsanız `.env`'de `JARVIS_KULAKLIK=evet` yapın; konuşurken sözünü kesebilirsiniz.
- **Yanlışlıkla uyanıyorsa** `JARVIS_UYANDIRMA_ESIGI`'ni artırın (ör. 0.75);
  **"Hey Jarvis" dediğinizde uyanmıyorsa** azaltın (ör. 0.45). İngilizce gibi "hey CAR-vis" demek
  daha iyi tanınır. Kısayol her zaman çalışır.
- **Cevaplar geç geliyorsa** `.env`'de `JARVIS_SOHBET_MODELI=claude-sonnet-5-5` deneyin (daha hızlı;
  zor sorular yine derin düşünme motoruna gider). Ses için `JARVIS_SES_MODELI=eleven_flash_v2_5`
  en hızlısıdır, varsayılan `eleven_v3_conversational` en gerçekçisidir.
- **"model does not exist" ya da erişim hatası:** OpenAI hesabınız ilk modele erişemiyorsa Jarvis
  sıradakini dener. Hepsi başarısızsa platform.openai.com → Billing'de kredi yüklü mü bakın.
- **Mikrofon hiç duymuyorsa:** Ayarlar → Gizlilik ve Güvenlik → Mikrofon'da Terminal açık mı bakın;
  Ayarlar → Ses → Giriş'te doğru mikrofon seçili mi kontrol edin.
- **"Hey Jarvis"i beklerken Mac uyursa** Jarvis de uyur; uzun süre açık kalacaksa Ayarlar → Ekran
  Kilidi'nden uykuyu erteleyin ya da Terminal'de `caffeinate -i bash BASLAT.command` ile başlatın.
- Ekrandaki yazılar Terminal'de canlı görünür (🗣️ siz, 🤖 Jarvis, 🧠 derin düşünme, 🛠️ araç).

## Maliyet (yaklaşık)

- **ElevenLabs:** konuşma açıkken dakika başına ücret (plana göre). Dinleme modunda konuşma kapalıdır,
  yalnızca kayıt sonunda yazıya dökme ücreti alınır.
- **OpenAI (ya da Claude):** derin düşünme, ekran yorumlama, özet ve hafıza notları için kullanım kadar ücret.
- Canlı sohbetin kendisi ElevenLabs'te çalışır (ElevenLabs kredisinden düşer), ek anahtar gerektirmez.
- "Hey Jarvis" algılama tamamen bilgisayarınızda çalışır, ücretsizdir; beklerken internete ses gitmez.

## Gizlilik

- `.env` (anahtarlarınız), `hafiza.md`, `notlar/` ve `durum/` yalnızca sizin bilgisayarınızda durur;
  bunları kimseyle paylaşmayın.
- Konuşma sırasında ses ElevenLabs'e, metinler Claude'a gider. Dinleme kayıtları `notlar` klasöründe
  saklanır; istemediklerinizi silebilirsiniz.

## Dosyalar

- `jarvis.py` — ana program (uyandırma, konuşma, dinleme/özet, hafıza)
- `araclar.py` — bilgisayar araçları (uygulama/site açma, ekran, pano, hatırlatıcı, hafıza)
- `hafiza.md` — Jarvis'in hatırladıkları (düzenleyebilirsiniz)
- `notlar/` — dinleme kayıtları ve özetleri
- `KUR.command` / `BASLAT.command` — Mac; `KUR.bat` / `BASLAT.bat` / `OTOMATIK_BASLAT.bat` — Windows
