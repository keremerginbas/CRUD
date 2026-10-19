# Gerçek fotoğraf ve videolar

Bu klasöre dosyaları aşağıdaki adlarla koyun, sonra şunu çalıştırın:

    python3 scripts/import_photos.py && npm run build

| Dosya adı (uzantı .jpg/.png/.webp veya video için .mp4/.mov) | Kullanıldığı yer |
|---|---|
| `hafriyat`  | Ana sayfa girişi, Hafriyat sayfası |
| `temel`     | Temel Kazı İşleri |
| `altyapi`   | Altyapı İşleri |
| `yol`       | Yol Kazı İşleri |
| `dolgu`     | Dolgu İşleri |
| `makine`    | İş Makineleri |
| `insaat`    | İnşaat & Taahhüt, Hakkımızda |
| `nakliye`   | Nakliye, İletişim |
| `blog/<yazi-adresi>.jpg` | (isteğe bağlı) blog kapakları |

- Fotoğraflar yatay (en az 1600 px genişlik) olmalı; 16:9'a otomatik kırpılır.
- Aynı ada hem foto hem video koyarsanız video oynar, foto kapak (poster) olur.
- Videolar sessize alınır, 1280x720'ye ve en fazla 20 saniyeye indirilir.
- **Telif:** Yalnızca firmanın kendi çektiği ya da ticari kullanım lisanslı (Unsplash, Pexels, Pixabay vb.)
  görseller kullanılmalıdır. Google/Yandex Görseller'den alınan fotoğraflar başkalarına aittir.
