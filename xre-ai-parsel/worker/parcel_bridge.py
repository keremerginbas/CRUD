"""One-request JSON bridge between local Express and bundled tkgm-py.

Usage: python worker/parcel_bridge.py < stdin.json
Output: one compact JSON object, with no secrets in responses.
The upstream client is unofficial; valid authorized credentials are required
for address/ada/parsel lookups. Do not attempt to bypass access controls.
"""
import json
import os
import sys
import unicodedata
import requests
from pathlib import Path
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).resolve().parent / 'vendor'))
from tkgm.models import Geometry, Province, District, Neighborhood, Parcel  # noqa: E402
from tkgm.exceptions import (  # noqa: E402
    TKGMAuthError, TKGMNotFoundError, TKGMRateLimitError,
    TKGMHTTPError, TKGMParseError, TKGMError,
)



# Two modes: public endpoint, with no token; or explicitly authorized endpoint.
# Never impersonate a browser Origin/Referer or try to bypass 401/403.
# Public access can change at any time; only the remote service decides.
PUBLIC_BASE = 'https://cbsapi.tkgm.gov.tr/megsiswebapi.v3/api'
AUTHORIZED_BASE = 'https://cbsapi.tkgm.gov.tr/megsiswebapi.v3.1/api'
# Parsel Sorgu > Analiz ekranının kullandığı uç nokta (kullanıcının tarayıcı ağ kaydından):
# GET .../megsiswebapi.v3.1/api/analiz?AnalizTip=1&Yil=2025&IlceId=161 -> [{parselId, enlem, boylam, sayi}]
ANALYSIS_URL = 'https://cbsapi.tkgm.gov.tr/megsiswebapi.v3.1/api/analiz'
ANALYSIS_TYPES = {1: 'Alım Satım Yoğunluğu'}


class DirectTKGMClient:
    def __init__(self, token=None, timeout=12, **_kwargs):
        self.token = token
        self.timeout = timeout
        self.mode = os.environ.get('TKGM_PARCEL_MODE', 'public').strip().lower()
        if self.mode not in ('public', 'authorized'):
            raise ValueError('TKGM_PARCEL_MODE public veya authorized olmalıdır.')
        if self.mode == 'authorized' and not token:
            raise TKGMAuthError('Yetkili modda TKGM_TOKEN gerekli.')
        base = os.environ.get('TKGM_API_BASE', '').strip()
        # Fixed allow-list; no arbitrary domains, arbitrary paths or unencrypted HTTP.
        allowed = {PUBLIC_BASE, AUTHORIZED_BASE}
        self.base = base.rstrip('/') if base else (AUTHORIZED_BASE if self.mode == 'authorized' else PUBLIC_BASE)
        if self.base not in allowed:
            raise ValueError('TKGM_API_BASE yalnızca desteklenen TKGM HTTPS adreslerinden biri olabilir.')
        self.session = requests.Session()
        self.session.headers.update({'Accept': 'application/json', 'User-Agent': 'XRE-AI-Parsel/0.11 (local personal query)'})
        if self.mode == 'authorized' and token:
            self.session.headers['Authorization'] = f'Bearer {token}'

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.session.close()

    def _get(self, route):
        response = self.session.get(f'{self.base}/{route.lstrip("/")}', timeout=self.timeout)
        if response.status_code in (401, 403):
            raise TKGMAuthError('Servis yetki gerektiriyor veya istek reddedildi.')
        if response.status_code == 429:
            raise TKGMRateLimitError('Sorgu limiti.')
        if response.status_code == 404:
            raise TKGMNotFoundError('Kayıt bulunamadı veya uç nokta artık kullanılmıyor.')
        if not response.ok:
            raise TKGMHTTPError(response.status_code, 'TKGM yanıt hatası')
        # Idari listeler (il/ilce/mahalle) sinir poligonlariyla geldigi icin parsel yanitindan buyuk olabilir.
        if len(response.content) > 20_000_000:
            raise TKGMParseError('TKGM yanıtı boyut sınırını aşıyor.')
        try:
            data = response.json()
        except ValueError as exc:
            raise TKGMParseError('TKGM JSON yerine başka içerik döndürdü.') from exc
        if not isinstance(data, dict):
            raise TKGMParseError('TKGM nesne biçiminde JSON döndürmedi.')
        if 'Message' in data or 'message' in data and not data.get('geometry') and not data.get('features'):
            msg = str(data.get('Message', data.get('message', '')))
            if any(x in msg.lower() for x in ('bulunamad', 'not found', 'no http resource')):
                raise TKGMNotFoundError('Bu adreste kayıt bulunamadı.')
            raise TKGMParseError('TKGM beklenen veri biçimini döndürmedi.')
        return data

    def get_analysis(self, analysis_type, year, district_id):
        # Sabit adres + doğrulanmış tam sayı parametreler; Origin/Referer taklidi yapılmaz.
        response = self.session.get(ANALYSIS_URL, params={'AnalizTip': analysis_type, 'Yil': year, 'IlceId': district_id}, timeout=self.timeout)
        if response.status_code in (401, 403):
            raise TKGMAuthError('Analiz servisi isteği reddetti.')
        if response.status_code == 429:
            raise TKGMRateLimitError('Sorgu limiti.')
        if not response.ok:
            raise TKGMHTTPError(response.status_code, 'TKGM analiz yanıt hatası')
        if len(response.content) > 20_000_000:
            raise TKGMParseError('TKGM yanıtı boyut sınırını aşıyor.')
        try:
            data = response.json()
        except ValueError as exc:
            raise TKGMParseError('TKGM JSON yerine başka içerik döndürdü.') from exc
        if not isinstance(data, list):
            raise TKGMParseError('Analiz yanıtı liste değil.')
        return data

    @staticmethod
    def _list(data, cls):
        feats = data.get('features')
        if not isinstance(feats, list):
            raise TKGMParseError('İdari liste yanıtı beklenen biçimde değil.')
        return [cls.from_feature(f) for f in feats]

    def get_provinces(self):
        return self._list(self._get('idariYapi/ilListe'), Province)

    def get_districts(self, province_id):
        return self._list(self._get(f'idariYapi/ilceListe/{province_id}'), District)

    def get_neighborhoods(self, district_id):
        return self._list(self._get(f'idariYapi/mahalleListe/{district_id}'), Neighborhood)

    def get_parcel(self, neighborhood_id, block, parcel):
        data = self._get(f'parsel/{neighborhood_id}/{block}/{parcel}')
        return Parcel.from_response(data, neighborhood_id, block, parcel)

    def get_parcel_by_coordinate(self, lat, lon):
        data = self._get(f'parsel/{lat:.6f}/{lon:.6f}/')
        return Parcel.from_response(data, 0, 0, 0)


def output(obj):
    print(json.dumps(obj, ensure_ascii=False, separators=(',', ':')))


def normal_name(s):
    s = str(s).strip().replace('İ', 'I').replace('ı', 'i')
    s = unicodedata.normalize('NFKD', s).casefold()
    return ''.join(c for c in s if not unicodedata.combining(c))


def parse_integer(value, field):
    if isinstance(value, bool) or not str(value).isdigit():
        raise ValueError(f'{field} pozitif tam sayı olmalıdır.')
    number = int(value)
    if not (1 <= number <= 2147483647):
        raise ValueError(f'{field} 1 ile 2147483647 arasında olmalıdır.')
    return number


def parse_region_id(value):
    return parse_integer(value, 'Bölge kimliği')


def choose_name(items, name, what):
    needle = normal_name(name)
    matches = [item for item in items if normal_name(item.name) == needle]
    if len(matches) == 1:
        return matches[0]
    if not matches:
        raise ValueError(f'{what} bulunamadı. Listeden seçin: {name!r}')
    raise ValueError(f'{what} birden fazla eşleşti. Listeden seçin.')


def region_item(item):
    # TKGM idari listeleri her kayit icin sinir poligonu dondurur; yalnizca gecerli Polygon/MultiPolygon aktarilir.
    result = {'id': int(item.id), 'name': item.name}
    geom = item.geometry
    if geom and geom.type in ('Polygon', 'MultiPolygon') and isinstance(geom.coordinates, list) and geom.coordinates:
        result['geometry'] = {'type': geom.type, 'coordinates': geom.coordinates}
    return result


def parcel_result(parcel, query_type):
    props = parcel.properties or {}
    feature = parcel.to_geojson()
    geom = feature.get('geometry')
    if not props or not geom or geom.get('type') not in ('Polygon', 'MultiPolygon'):
        raise TKGMNotFoundError('Servis doğrulanabilir parsel sınırı döndürmedi.')
    # Minimal geometry integrity and geographic-bound checks, not cadastral verification.
    coords = geom.get('coordinates')
    if not isinstance(coords, list) or not coords:
        raise TKGMParseError('Geçersiz parsel koordinatları.')
    def extract_points(obj):
        if isinstance(obj, list) and len(obj) >= 2 and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in obj[:2]):
            yield obj
        elif isinstance(obj, list):
            for child in obj:
                yield from extract_points(child)
    points = list(extract_points(coords))
    if not (3 <= len(points) <= 12000) or any(not (25 <= pt[0] <= 46 and 35 <= pt[1] <= 43) for pt in points):
        raise TKGMParseError('Parsel geometrisi Türkiye sınırları içinde değil veya bozuk.')
    area = props.get('alan')
    area_number = None
    if isinstance(area, (float, int)) and not isinstance(area, bool):
        area_number = float(area)
    elif isinstance(area, str):
        try:
            area_number = float(area.replace('.', '').replace(',', '.'))
        except ValueError:
            pass
    if area_number is not None and not (0 < area_number < 1e10):
        area_number = None
    return {
        'ok': True, 'source': 'TKGM CBS servis yanıtı (resmî belge değildir)',
        'checkedAt': datetime.now(timezone.utc).isoformat(),
        'queryType': query_type,
        'parcel': {
            'province': props.get('ilAd'),
            'district': props.get('ilceAd'),
            'neighborhood': props.get('mahalleAd'),
            'block': str(props.get('adaNo') or parcel.block or ''),
            'parcel': str(props.get('parselNo') or parcel.parcel or ''),
            'areaM2': area_number,
            'qualification': props.get('nitelik'),
            'sheet': props.get('pafta'),
            'geometry': feature,
        },
    }


def handle(req):
    action = req.get('action')
    token = os.environ.get('TKGM_TOKEN', '').strip()
    # Token is accepted from server environment only, never from the browser.

    if action == 'coordinate' and os.environ.get('TKGM_COORDINATE_ENABLED') != 'true':
        return {'ok': False, 'code': 'DISABLED',
                'error': 'Koordinat sorgulaması etkin değil. Veri kullanım koşullarını doğruladıktan sonra etkinleştirin.'}

    with DirectTKGMClient(token=token or None, timeout=12) as client:
        if action == 'provinces':
            items = client.get_provinces()
        elif action == 'districts':
            items = client.get_districts(parse_region_id(req.get('provinceId')))
        elif action == 'neighborhoods':
            items = client.get_neighborhoods(parse_region_id(req.get('districtId')))
        elif action == 'parcel':
            block = parse_integer(req.get('block'), 'Ada')
            number = parse_integer(req.get('parcel'), 'Parsel')
            nid = req.get('neighborhoodId')
            if nid:
                neighborhood_id = parse_region_id(nid)
            else:
                # Fallback for existing textual V9 clients: exact-name matching only.
                province = choose_name(client.get_provinces(), req.get('province', ''), 'İl')
                district = choose_name(client.get_districts(province.id), req.get('district', ''), 'İlçe')
                neighborhood = choose_name(client.get_neighborhoods(district.id), req.get('neighborhood', ''), 'Mahalle')
                neighborhood_id = neighborhood.id
            found = client.get_parcel(neighborhood_id, block, number)
            # A successful HTTP response alone does not establish the requested parcel.
            # Reject inconsistent returned cadastral identifiers rather than marking verified.
            received_block = found.properties.get('adaNo') if found.properties else None
            received_parcel = found.properties.get('parselNo') if found.properties else None
            if received_block is not None and str(received_block).strip().isdigit() and int(received_block) != block:
                raise TKGMNotFoundError('Ada numarası gelen veriyle eşleşmedi.')
            if received_parcel is not None and str(received_parcel).strip().isdigit() and int(received_parcel) != number:
                raise TKGMNotFoundError('Parsel numarası gelen veriyle eşleşmedi.')
            return parcel_result(found, 'ada-parsel')
        elif action == 'analysis':
            analysis_type = parse_integer(req.get('analysisType'), 'Analiz tipi')
            if analysis_type not in ANALYSIS_TYPES:
                raise ValueError('Desteklenmeyen analiz tipi.')
            year = parse_integer(req.get('year'), 'Yıl')
            if not (2000 <= year <= datetime.now(timezone.utc).year):
                raise ValueError('Yıl 2000 ile bu yıl arasında olmalıdır.')
            district_id = parse_region_id(req.get('districtId'))
            rows = client.get_analysis(analysis_type, year, district_id)
            # Yalnızca beklenen alanlar aktarılır.
            clean = [{'parselId': r.get('parselId'), 'enlem': r.get('enlem'), 'boylam': r.get('boylam'), 'sayi': r.get('sayi')}
                     for r in rows if isinstance(r, dict)]
            return {'ok': True, 'source': 'TKGM Parsel Sorgu analiz servisi (resmî belge değildir)',
                    'checkedAt': datetime.now(timezone.utc).isoformat(), 'analysisType': ANALYSIS_TYPES[analysis_type], 'rows': clean}
        elif action == 'coordinate':
            try:
                lat, lon = float(req.get('lat')), float(req.get('lng'))
            except (ValueError, TypeError):
                raise ValueError('Koordinatlar geçersiz.')
            if not (35 <= lat <= 43 and 25 <= lon <= 46):
                raise ValueError('Türkiye için geçerli koordinat girin.')
            return parcel_result(client.get_parcel_by_coordinate(lat, lon), 'koordinat')
        else:
            raise ValueError('Bilinmeyen Python sorgu komutu.')
        return {'ok': True, 'items': [region_item(i) for i in items]}


def main():
    try:
        request = json.load(sys.stdin)
        if not isinstance(request, dict):
            raise ValueError('İstek JSON nesnesi olmalıdır.')
        response = handle(request)
    except TKGMAuthError:
        response = {'ok': False, 'code': 'ACCESS_RESTRICTED',
                    'error': 'TKGM sunucusu sorguyu 401/403 ile reddetti. Bu modda erişim mümkün değil; resmî Parsel Sorgu uygulamasını kullanın veya yetkili erişim edinin.'}
    except TKGMNotFoundError:
        response = {'ok': False, 'code': 'NOT_FOUND', 'error': 'Bu kriterlere uygun parsel bulunamadı.'}
    except TKGMRateLimitError:
        response = {'ok': False, 'code': 'RATE_LIMIT', 'error': 'TKGM sorgu limiti aşıldı. Daha sonra tekrar deneyin.'}
    except TKGMHTTPError as exc:
        status = exc.status_code
        response = {'ok': False, 'code': 'ACCESS_RESTRICTED' if status in (401, 403) else 'UPSTREAM',
                    'error': 'TKGM erişimi reddedildi.' if status in (401, 403) else f'TKGM servisi HTTP {status} hatası döndürdü.'}
    except (TKGMParseError, TKGMError):
        response = {'ok': False, 'code': 'UPSTREAM', 'error': 'TKGM servis yanıtı işlenemedi.'}
    except ValueError as exc:
        response = {'ok': False, 'code': 'BAD_REQUEST', 'error': str(exc)}
    except Exception as exc:
        # Never echo tokens, response body or sensitive upstream details.
        print(f'Python bridge error: {type(exc).__name__}', file=sys.stderr)
        response = {'ok': False, 'code': 'UNAVAILABLE', 'error': 'TKGM servisine ulaşılamadı; internet bağlantısını ve yetkileri kontrol edin.'}
    output(response)


if __name__ == '__main__':
    main()
