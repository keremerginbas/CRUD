// Hazır sözleşme şablonu: firma kendi Word şablonunu yükleyene kadar kullanılır.
// Metin genel bir taslaktır; imzalanmadan önce firmanın hukuk danışmanınca gözden geçirilmelidir.
import { buildDocx, type DocxParagraph } from "./docx-fill.js";

const h = (text: string): DocxParagraph => ({ text, bold: true, size: 12, spaceAfter: 80 });
const p = (text: string): DocxParagraph => ({ text, align: "both" });

export const DEFAULT_CONTRACT_PARAGRAPHS: DocxParagraph[] = [
  { text: "GAYRİMENKUL SATIŞ SÖZLEŞMESİ", bold: true, size: 16, align: "center", spaceAfter: 60 },
  { text: "Sözleşme no: {{teklif_no}}    Tarih: {{sozlesme_tarihi}}    Yer: {{sozlesme_yeri}}", align: "center", spaceAfter: 280 },
  h("1. TARAFLAR"),
  p("SATICI: {{sirket_adi}} — {{sirket_adresi}} — Tel: {{sirket_telefon}}"),
  p("ALICI: {{alici_adi}} — T.C. Kimlik No: {{alici_tckn}} — Adres: {{alici_adres}} — Tel: {{alici_telefon}} — E-posta: {{alici_eposta}}"),
  p("KEFİL (varsa): {{kefil_adi}} — T.C. Kimlik No: {{kefil_tckn}} — Adres: {{kefil_adres}}"),
  h("2. SÖZLEŞMENİN KONUSU"),
  p("İşbu sözleşmenin konusu; {{proje_adi}} projesinde yer alan {{blok}} blok, {{kat}}. kat, {{daire_no}} numaralı, {{daire_tipi}} tipindeki, brüt {{brut_m2}} m² / net {{net_m2}} m² büyüklüğündeki bağımsız bölümün aşağıdaki koşullarla ALICI'ya satışıdır."),
  h("3. SATIŞ BEDELİ VE ÖDEME"),
  p("Bağımsız bölümün satış bedeli {{satis_bedeli}} ({{satis_bedeli_yaziyla}}) olarak kararlaştırılmıştır."),
  p("ALICI, sözleşme tarihinde {{pesinat}} ({{pesinat_yaziyla}}) peşinat ödeyecektir. Vadeye kalan {{vadeli_tutar}} tutarındaki bakiye, aylık {{aylik_oran}} vade farkı uygulanarak {{taksit_sayisi}} ayda ödenecektir. Vade farkı tutarı {{vade_farki}} olup ALICI'nın peşinat dahil ödeyeceği toplam tutar {{toplam_odeme}} ({{toplam_odeme_yaziyla}}) olarak hesaplanmıştır."),
  p("Ödemeler aşağıdaki ödeme planına göre yapılacaktır:"),
  { text: "{{odeme_plani}}" },
  h("4. SENETLER"),
  p("Vadeli ödemelerin teminatı olarak ALICI tarafından toplam {{senet_toplami}} tutarında {{senet_sayisi}} adet senet düzenlenerek SATICI'ya teslim edilmiştir. Senetlerin dökümü aşağıdadır:"),
  { text: "{{senet_listesi}}" },
  h("5. GECİKME"),
  p("Vadesinde ödenmeyen her taksit için, vade tarihinden ödeme tarihine kadar geçen süre üzerinden aylık {{gecikme_faizi}} oranında gecikme faizi uygulanır."),
  h("6. TESLİM VE DİĞER HÜKÜMLER"),
  p("Bağımsız bölümün teslimi, tapu devri, vergi, harç ve masraflara ilişkin hususlar ile fesih koşulları taraflarca ayrıca kararlaştırılan özel şartlara ve yürürlükteki mevzuata tabidir."),
  p("İşbu sözleşme {{sozlesme_tarihi}} tarihinde {{sozlesme_yeri}} ilinde iki nüsha olarak düzenlenmiş, taraflarca okunarak imzalanmıştır."),
  { text: "", spaceAfter: 400 },
  { text: "SATICI                                                    ALICI                                                    KEFİL", bold: true },
  { text: "{{sirket_adi}}                              {{alici_adi}}                              {{kefil_adi}}" },
  { text: "", spaceAfter: 200 },
  { text: "Satış danışmanı: {{satis_danismani}}", size: 9 },
];

export const buildDefaultContractTemplate = (): Uint8Array => buildDocx(DEFAULT_CONTRACT_PARAGRAPHS);
