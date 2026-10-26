"""On-demand one-request TKGM connectivity diagnostic; prints no credentials."""
from parcel_bridge import DirectTKGMClient, TKGMAuthError, TKGMNotFoundError, TKGMRateLimitError
from requests.exceptions import RequestException


def main():
    print('XRE AI Parsel V11 | TKGM bağlantı kontrolü')
    print('Test: yalnızca il listesini çek (bir GET isteği)')
    try:
        with DirectTKGMClient(timeout=12) as client:
            print('Mod:', client.mode)
            print('Sunucu:', client.base)
            provinces = client.get_provinces()
            if provinces:
                print('BAŞARILI: TKGM il listesi alındı.', 'İl adedi:',len(provinces))
                print('NOT: İl listesinin çalışması, ada/parsel sorgusunun da açık olduğunu kanıtlamaz.')
            else:
                print('UYARI: Boş il listesi döndürüldü.')
    except TKGMAuthError:
        print('ERİŞİM REDDEDİLDİ: Servis 401/403 döndürdü. Koruma aşılmayacak.')
        print('Resmî Parsel Sorgu: https://parselsorguv2.tkgm.gov.tr/')
    except TKGMRateLimitError:
        print('İSTEK LİMİTİ: 429; tekrar tekrar denemeyin.')
    except (TKGMNotFoundError, RequestException) as e:
        print('ULAŞILAMADI:', type(e).__name__, '(internet/TKGM servis durumunu kontrol edin)')
    except Exception as e:
        print('HATA:', type(e).__name__, '(API/Python yapılandırması veya servis yanıtı)')


if __name__ == '__main__':
    main()
