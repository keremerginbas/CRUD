# XRE AI Parsel V13 — Yerel parsel sorgu ve analiz

React/TypeScript + Leaflet harita, Express yerel API, Python TKGM istemcisi ve SQLite veri saklama.

**V13:** TKGM Parsel Sorgu tarzı sol panel, seçildikçe çizilen il/ilçe/mahalle sınırları, aranabilir seçiciler ve uydu zoom düzeltmesi. Ayrıntı: `V13_DEGISIKLIKLER.md`.

**Yeni:** `TKGM_TOKEN` vermeden, kullanıcı tarafından sağlanan `parselsorgu-main` projesinin kullandığı doğrudan adres biçimiyle TKGM CBS sorgusu **denenir**. Bu, servis izni garantisi değildir. Erişim kapalıysa 401/403 düzgün yansıtılır ve resmî portala yönlendirilir.

## V12 — Parsel sınırı görünürlük düzeltmesi

- TKGM'den alınan **Polygon/MultiPolygon** sınırları kalın **kırmızı** kenarlık ve saydam kırmızı alan dolgusu ile çizilir.
- 489 m² gibi küçük parseller için harita otomatik olarak 20. zoom seviyesine kadar yaklaşabilir. Harita altlığı 19. seviyeden sonra yeniden ölçeklenir (normaldir).
- **Parsele Yakınlaş** tuşu sorguyu yeniden yapmadan GeoJSON sınırına odaklanır.
- Parsel sorgusu başarılı olduğunda önceki kırmızı nokta pini sınırı kapatmasın diye geçici olarak gizlenir; haritada yeni bir yere tıklayınca seçilen nokta pini yeniden görünür.
- TKGM verisinin içerik ve yetki koşulları değiştirilmedi. **Kadastral nitelik “Arsa” görünmesi, “konut imarlı” bilgisini doğrulamaz.** İmar bilgisi belediyeden ayrıca kontrol edilmelidir.

## Windows

1. Zip'i **boş, yeni bir klasöre** açın (eski sürümün üzerine açmayın).
2. `KURULUM.bat`
3. **`BASLAT.bat`** — arayüzü derler, API ile birlikte tek pencerede açar: `http://localhost:3001`
4. Geliştirme için (kod değiştirirken anında yenileme): `BASLAT_API.bat` + `BASLAT_HARITA.bat` → `http://localhost:5173`. 5173 doluysa Vite artık başka porta kaymaz, hata verir: önce eski pencereyi kapatın.

Adım adım detay: `KURULUM_WINDOWS.md`.

## Güvenlik

Kimlik doğrulama yok; bu yüzden dış internete veya yerel ağdaki başka kullanıcılara açmayın. `.env` ve `data/*.sqlite` dosyalarını paylaşmayın. TKGM servis erişimi üçüncü taraf kuralları ve müsaitliğine bağlıdır. Resmî tapu/imar kaydı yerine geçmez.

## Testler

`py -3 -m unittest discover -s tests -v` (14 birim testi, mock yanıtlar; **canlı TKGM testi değildir**).

Kaynak kodların dayanağı: kullanıcı tarafından sağlanan `parselsorgu-main.zip`, `tkgm-py-master (1).zip` ve `class.tkgm.php-master.zip`. Bundled `worker/vendor/tkgm` modelleri için MIT lisansı `worker/vendor/TKGM_PY_LICENSE.txt` dosyasındadır.
