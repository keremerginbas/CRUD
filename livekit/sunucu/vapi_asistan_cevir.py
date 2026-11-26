#!/usr/bin/env python3
"""Vapi'den indirilen asistanları bu sunucunun asistan dosyalarına (YAML) çevirir.
Kullanım: vapi_asistan_cevir.py <asistanlar.json> <araclar.json> <ciktilar.json> <hedef-klasör> [--uzerine]
Mevcut dosyaların üzerine yazmaz (panelde yaptığınız değişiklikler korunur); --uzerine verilirse yeniler."""
import json
import re
import sys
from pathlib import Path

import yaml

TR = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")


def kimlik(ad: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", str(ad).translate(TR).lower()).strip("-")
    return (s or "asistan")[:60].strip("-")


class _Dumper(yaml.SafeDumper):
    pass


def _metin(dumper, veri):
    return dumper.represent_scalar("tag:yaml.org,2002:str", veri, style="|" if "\n" in veri else None)


_Dumper.add_representer(str, _metin)


def arac_cevir(t: dict) -> dict | None:
    """Yalnızca işlev (function) araçları taşınır; görüşmeyi kapatma gibi hazır araçlar bu sunucuda zaten var."""
    if t.get("type") != "function" or not isinstance(t.get("function"), dict):
        return None
    f = t["function"]
    ad = str(f.get("name") or "")
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", ad) or ad == "end_call":
        return None
    out = {"ad": ad, "aciklama": str(f.get("description") or ""), "parametreler": f.get("parameters") or {"type": "object", "properties": {}}}
    url = ((t.get("server") or {}).get("url") or "").strip()
    if url:
        out["url"] = url
    return out


def cevir(a: dict, araclar: dict, ciktilar: dict) -> tuple[dict, list[str]]:
    notlar: list[str] = []
    m = a.get("model") or {}
    sistem = "\n\n".join(str(x.get("content") or "") for x in (m.get("messages") or []) if x.get("role") == "system").strip()
    y: dict = {"id": kimlik(a.get("name") or a.get("id")), "ad": str(a.get("name") or a.get("id")), "vapi_id": a.get("id")}
    model = str(m.get("model") or "")
    if m.get("provider") == "openai" and model:
        y["model"] = model
    else:
        y["model"] = "gpt-4.1-mini"
        notlar.append(f"model {m.get('provider')}/{model} yerine gpt-4.1-mini kullanıldı")
    if isinstance(m.get("temperature"), (int, float)):
        y["sicaklik"] = m["temperature"]
    ses = a.get("voice") or {}
    if ses.get("provider") == "11labs" and ses.get("voiceId"):
        y["ses_id"] = ses["voiceId"]
    else:
        y["ses_id"] = ""
        notlar.append(f"ses ElevenLabs değil ({ses.get('provider') or 'tanımsız'}); varsayılan ElevenLabs sesi kullanılacak")
    y["ilk_mesaj_modu"] = "musteri_bekle" if a.get("firstMessageMode") == "assistant-waits-for-user" else "asistan"
    y["ilk_mesaj"] = str(a.get("firstMessage") or "")
    y["sunucu_url"] = str((a.get("server") or {}).get("url") or a.get("serverUrl") or "")
    if not y["sunucu_url"]:
        notlar.append("sunucu adresi (n8n webhook) yok: görüşme sonucu hiçbir yere gönderilmez")
    if a.get("maxDurationSeconds"):
        y["azami_sure_sn"] = int(min(7200, max(10, a["maxDurationSeconds"])))
    if a.get("silenceTimeoutSeconds"):
        y["sessizlik_sn"] = int(min(3600, max(5, a["silenceTimeoutSeconds"])))
    # araçlar: asistanın içine yazılmış olanlar + kimliğiyle bağlı olanlar
    liste, gorulen = [], set()
    for t in list(m.get("tools") or []) + [araclar.get(i) or {"type": "?", "id": i} for i in (m.get("toolIds") or [])]:
        c = arac_cevir(t)
        if c and c["ad"] not in gorulen:
            gorulen.add(c["ad"])
            liste.append(c)
        elif not c and t.get("type") not in ("endCall", "function"):
            notlar.append(f"araç taşınmadı: {t.get('type')} {t.get('id', '')}".strip())
    if liste:
        y["araclar"] = liste
    # görüşme sonu analizi
    ap = a.get("analysisPlan") or {}
    analiz: dict = {}
    ozet = (ap.get("summaryPlan") or {}).get("messages") or []
    ozet_metni = next((str(x.get("content")) for x in ozet if x.get("role") == "system" and x.get("content")), "") or str(ap.get("summaryPrompt") or "")
    if ozet_metni:
        analiz["ozet_talimati"] = ozet_metni
    sema = (ap.get("structuredDataPlan") or {}).get("schema") or ap.get("structuredDataSchema")
    cikti_idleri = (a.get("artifactPlan") or {}).get("structuredOutputIds") or []
    bagli = [ciktilar[i] for i in cikti_idleri if i in ciktilar]
    if len(bagli) < len(cikti_idleri):
        notlar.append("bazı yapılandırılmış çıktılar Vapi'den okunamadı")
    if bagli:
        tek = len(bagli) == 1 and (bagli[0].get("schema") or {}).get("type") == "object" and not sema
        if tek:
            analiz["yapilandirilmis"] = bagli[0]["schema"]
            y["vapi_ciktilari"] = [{"id": bagli[0]["id"], "ad": bagli[0].get("name") or "", "alan": ""}]
        else:
            ozellik = dict((sema or {}).get("properties") or {})
            y["vapi_ciktilari"] = []
            for c in bagli:
                alan = re.sub(r"[^a-zA-Z0-9_]+", "_", str(c.get("name") or c["id"]).translate(TR)).strip("_") or "cikti"
                s = dict(c.get("schema") or {"type": "string"})
                if c.get("description") and not s.get("description"):
                    s["description"] = c["description"]
                ozellik[alan] = s
                y["vapi_ciktilari"].append({"id": c["id"], "ad": c.get("name") or "", "alan": alan})
            analiz["yapilandirilmis"] = {"type": "object", "properties": ozellik}
    elif sema:
        analiz["yapilandirilmis"] = sema
    if analiz:
        y["analiz"] = analiz
    if not sistem:
        notlar.append("asistan metni (prompt) boş geldi")
    y["prompt"] = sistem or "(Vapi'de asistan metni bulunamadı; panelden yazın.)"
    return y, notlar


def main() -> int:
    asistanlar, arac_l, cikti_l = (json.load(open(p, encoding="utf-8")) for p in sys.argv[1:4])
    hedef, uzerine = Path(sys.argv[4]), "--uzerine" in sys.argv
    for ad, v in (("asistanlar", asistanlar), ("araçlar", arac_l)):
        if isinstance(v, dict):
            print(f"✗ Vapi {ad} listesini vermedi: {str(v.get('message') or v)[:200]}")
            return 1
    if isinstance(cikti_l, dict):
        cikti_l = cikti_l.get("results") or cikti_l.get("data") or []
    araclar = {t.get("id"): t for t in arac_l}
    ciktilar = {c.get("id"): c for c in cikti_l if isinstance(c, dict)}
    mevcut = {}
    for f in hedef.glob("*.y*ml"):
        d = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        if d.get("vapi_id"):
            mevcut[d["vapi_id"]] = f
    hedef.mkdir(parents=True, exist_ok=True)
    yeni = atlanan = 0
    for a in sorted(asistanlar, key=lambda x: str(x.get("name") or "")):
        y, notlar = cevir(a, araclar, ciktilar)
        dosya = mevcut.get(a.get("id"))
        if dosya and not uzerine:
            atlanan += 1
            print(f"  = {y['ad']}: zaten aktarılmış ({dosya.name}), dokunulmadı")
            continue
        if not dosya:
            dosya, i = hedef / f"{y['id']}.yaml", 2
            while dosya.exists():                      # aynı adlı başka asistan varsa sonuna sayı ekle
                dosya = hedef / f"{y['id'][:56]}-{i}.yaml"; i += 1
        y["id"] = dosya.stem
        dosya.write_text(yaml.dump(y, Dumper=_Dumper, allow_unicode=True, sort_keys=False, width=1000), encoding="utf-8")
        yeni += 1
        print(f"  ✓ {y['ad']}  →  {dosya.name}   (model {y['model']}, {len(y.get('araclar') or [])} araç, webhook {'var' if y['sunucu_url'] else 'YOK'})")
        for n in notlar:
            print(f"      not: {n}")
    print(f"\n{yeni} asistan aktarıldı, {atlanan} asistan zaten vardı.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
