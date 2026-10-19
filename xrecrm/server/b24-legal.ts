// XRE WhatsApp için pazar yerinin istediği herkese açık sayfalar: son kullanıcı
// lisans sözleşmesi, gizlilik politikası ve destek. Varsayılan dil İngilizce
// (Bitrix24 Market zorunlu kılar); ?lang=tr Türkçe gösterir.
//
// Geliştirici ve iletişim bilgileri Entegrasyonlar ekranından gelir
// (B24_VENDOR_NAME, B24_VENDOR_ADDRESS, B24_SUPPORT_EMAIL, B24_SUPPORT_PHONE, B24_SUPPORT_HOURS).
import type { Express, Request, Response } from "express";
import { PANEL_STYLE } from "./b24-panel-html.js";
import { REPORT_TTL_DAYS, MEDIA_KEEP_DAYS } from "./b24-live.js";
import { type Lang } from "./b24-i18n.js";

export const LEGAL_UPDATED = "2026-10-16";
const env = (k: string) => process.env[k]?.trim() || "";
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function vendorInfo() {
  return {
    name: env("B24_VENDOR_NAME") || "XRE Software",
    address: env("B24_VENDOR_ADDRESS"),
    email: env("B24_SUPPORT_EMAIL"),
    phone: env("B24_SUPPORT_PHONE"),
    hours: env("B24_SUPPORT_HOURS") || "Monday–Friday, 09:00–18:00 (UTC+3)",
  };
}

function shell(res: Response, lang: Lang, title: string, body: string, path: string) {
  const other = lang === "en" ? "tr" : "en";
  res
    .status(200)
    .type("html")
    .setHeader("cache-control", "public, max-age=3600")
    .send(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · WhatsApp by XRE</title>
<style>${PANEL_STYLE}
.doc{max-width:820px;margin:0 auto;padding:32px 20px 64px}
.doc header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:14px;margin-bottom:8px}
.doc h1{font-size:26px;margin:4px 0}.doc h2{font-size:17px;margin:26px 0 6px}.doc p,.doc li{color:var(--ink-2);line-height:1.65}
.doc small{color:var(--ink-3)}.doc nav a{color:var(--accent);font-weight:600;margin-left:14px;text-decoration:none}
.doc .card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-m);padding:16px 20px;margin:14px 0}
.doc a{color:var(--accent)}
@media (max-width:600px){.doc{padding:20px 16px 48px}.doc nav a{margin:0 12px 0 0}}</style></head>
<body><main class="doc"><header><div><small>WhatsApp by XRE</small><h1>${esc(title)}</h1><small>${lang === "en" ? "Last updated" : "Son güncelleme"}: ${LEGAL_UPDATED}</small></div>
<nav><a href="/b24/legal/terms${lang === "tr" ? "?lang=tr" : ""}">${lang === "en" ? "License agreement" : "Lisans sözleşmesi"}</a><a href="/b24/legal/privacy${lang === "tr" ? "?lang=tr" : ""}">${lang === "en" ? "Privacy policy" : "Gizlilik politikası"}</a><a href="/b24/support${lang === "tr" ? "?lang=tr" : ""}">${lang === "en" ? "Support" : "Destek"}</a><a href="${path}?lang=${other}" hreflang="${other}">${other === "tr" ? "Türkçe" : "English"}</a></nav></header>
${body}</main></body></html>`);
}

const contactLines = (lang: Lang) => {
  const v = vendorInfo();
  return [
    `<b>${esc(v.name)}</b>`,
    v.address ? esc(v.address) : "",
    v.email ? `${lang === "en" ? "E-mail" : "E-posta"}: <a href="mailto:${esc(v.email)}">${esc(v.email)}</a>` : "",
    v.phone ? `${lang === "en" ? "Phone" : "Telefon"}: ${esc(v.phone)}` : "",
  ]
    .filter(Boolean)
    .join("<br>");
};

function termsEn() {
  const v = vendorInfo();
  return `<p>This End User License Agreement (“Agreement”) is between <b>${esc(v.name)}</b> (“Licensor”, “we”) and the organization that installs the <b>WhatsApp by XRE</b> application (“Application”) on its Bitrix24 account (“Customer”, “you”). By installing or using the Application you accept this Agreement.</p>
<h2>1. The Application</h2><p>WhatsApp by XRE connects WhatsApp numbers to Bitrix24 Open Channels so that WhatsApp chats can be answered in Bitrix24. It also offers optional features such as message translation, voice message transcription, lead qualification, an AI assistant, live monitoring and manager reports.</p>
<h2>2. License</h2><p>We grant you a non-exclusive, non-transferable, revocable license to use the Application for your internal business purposes for as long as it is installed and, for paid numbers, for the paid license period. You may not resell, reverse engineer, or use the Application to send unsolicited messages (spam).</p>
<h2>3. Fees and trial</h2><p>Installing the Application is free. Each connected WhatsApp number receives a free trial when it is first connected. After the trial, a paid license per number is required to keep sending and receiving messages on that number. Current prices, periods and discounts are shown inside the Application on the <b>Billing</b> tab before any payment. Payments are made by bank transfer or with a license code; the license is extended after we confirm the payment. Fees already paid are not refundable unless required by law.</p>
<h2>4. WhatsApp</h2><p>The Application connects to WhatsApp as a linked device of your WhatsApp account, in the same way as WhatsApp Web. The Application is not affiliated with, endorsed or sponsored by WhatsApp or Meta. You are responsible for using WhatsApp in line with WhatsApp’s terms and applicable law, including having a lawful basis to message your contacts. WhatsApp may restrict accounts that violate its policies; we are not responsible for such restrictions.</p>
<h2>5. AI features</h2><p>AI features are optional and can be turned off in the Application. AI output (translations, summaries, assistant replies) may contain mistakes; you are responsible for reviewing how the AI assistant is configured and what knowledge it uses.</p>
<h2>6. Your data</h2><p>You remain the owner of your data. We process it only to provide the Application, as described in our <a href="/b24/legal/privacy">Privacy Policy</a>.</p>
<h2>7. Availability and support</h2><p>We aim to keep the service available at all times but do not guarantee uninterrupted operation. Support is provided through the channels listed on our <a href="/b24/support">Support page</a>.</p>
<h2>8. Warranty and liability</h2><p>The Application is provided “as is”. To the maximum extent permitted by law, we disclaim all implied warranties, and our total liability for any claim is limited to the fees you paid for the Application in the 12 months before the claim. We are not liable for indirect or consequential damages, lost profits or lost data.</p>
<h2>9. Term and termination</h2><p>This Agreement applies while the Application is installed. You may terminate it at any time by uninstalling the Application. We may suspend access in case of abuse or non-payment.</p>
<h2>10. Changes</h2><p>We may update this Agreement. The current version is always available at this address, with its date at the top.</p>
<h2>11. Governing law</h2><p>This Agreement is governed by the laws of the Republic of Türkiye, without prejudice to mandatory consumer protection rules of your country.</p>
<h2>12. Contact</h2><div class="card">${contactLines("en")}</div>`;
}

function termsTr() {
  const v = vendorInfo();
  return `<p>Bu Son Kullanıcı Lisans Sözleşmesi (“Sözleşme”), <b>${esc(v.name)}</b> (“Lisans veren”, “biz”) ile <b>WhatsApp by XRE</b> uygulamasını (“Uygulama”) Bitrix24 hesabına kuran kuruluş (“Müşteri”, “siz”) arasındadır. Uygulamayı kurarak veya kullanarak bu Sözleşmeyi kabul etmiş olursunuz.</p>
<h2>1. Uygulama</h2><p>WhatsApp by XRE, WhatsApp numaralarını Bitrix24 Açık Kanallarına bağlar; böylece WhatsApp sohbetleri Bitrix24 içinden cevaplanır. Ayrıca isteğe bağlı olarak mesaj çevirisi, sesli mesajı yazıya dökme, müşteri nitelendirme, AI asistan, canlı monitör ve yönetici raporu sunar.</p>
<h2>2. Lisans</h2><p>Uygulamayı kurulu kaldığı sürece ve ücretli numaralar için ödenen lisans süresi boyunca kendi iç işleriniz için kullanmanız amacıyla münhasır olmayan, devredilemez, geri alınabilir bir lisans veririz. Uygulamayı yeniden satamaz, tersine mühendislik yapamaz, istenmeyen toplu mesaj (spam) göndermek için kullanamazsınız.</p>
<h2>3. Ücretler ve deneme</h2><p>Uygulamanın kurulumu ücretsizdir. Her WhatsApp numarası ilk bağlandığında ücretsiz deneme alır. Deneme bitince o numarada mesajlaşmaya devam etmek için numara başına ücretli lisans gerekir. Güncel fiyat, dönem ve indirimler ödemeden önce Uygulamanın <b>Ödeme</b> sekmesinde gösterilir. Ödeme havale veya lisans koduyla yapılır; lisans, ödeme tarafımızca onaylanınca uzatılır. Kanunen zorunlu haller dışında ödenen ücretler iade edilmez.</p>
<h2>4. WhatsApp</h2><p>Uygulama, WhatsApp Web gibi, WhatsApp hesabınızın bağlı cihazı olarak çalışır. Uygulamanın WhatsApp veya Meta ile bir bağlantısı, onayı ya da sponsorluğu yoktur. WhatsApp’ı WhatsApp kurallarına ve yürürlükteki mevzuata (kişilere mesaj atmak için hukuki dayanak dahil) uygun kullanmak sizin sorumluluğunuzdadır. WhatsApp kurallarını ihlal eden hesapları kısıtlayabilir; bu kısıtlamalardan sorumlu değiliz.</p>
<h2>5. Yapay zekâ özellikleri</h2><p>Yapay zekâ özellikleri isteğe bağlıdır ve Uygulamadan kapatılabilir. Yapay zekâ çıktıları (çeviri, özet, asistan cevabı) hata içerebilir; AI asistanın nasıl yapılandırıldığını ve hangi bilgileri kullandığını denetlemek sizin sorumluluğunuzdadır.</p>
<h2>6. Verileriniz</h2><p>Verilerinizin sahibi sizsiniz. Verileri yalnız Uygulamayı sunmak için ve <a href="/b24/legal/privacy?lang=tr">Gizlilik Politikamızda</a> anlatıldığı şekilde işleriz.</p>
<h2>7. Erişilebilirlik ve destek</h2><p>Hizmeti kesintisiz sunmayı hedefleriz ancak kesintisiz çalışmayı garanti etmeyiz. Destek, <a href="/b24/support?lang=tr">Destek sayfasındaki</a> kanallardan verilir.</p>
<h2>8. Garanti ve sorumluluk</h2><p>Uygulama “olduğu gibi” sunulur. Kanunun izin verdiği en geniş ölçüde zımni garantiler kabul edilmez ve herhangi bir talep için toplam sorumluluğumuz, talepten önceki 12 ayda Uygulama için ödediğiniz ücretle sınırlıdır. Dolaylı zararlardan, kâr veya veri kaybından sorumlu değiliz.</p>
<h2>9. Süre ve fesih</h2><p>Sözleşme Uygulama kurulu olduğu sürece geçerlidir. Uygulamayı kaldırarak istediğiniz zaman feshedebilirsiniz. Kötüye kullanım veya ödeme yapılmaması halinde erişimi durdurabiliriz.</p>
<h2>10. Değişiklikler</h2><p>Bu Sözleşmeyi güncelleyebiliriz. Güncel sürüm her zaman bu adreste, tarihiyle birlikte yayımlanır.</p>
<h2>11. Uygulanacak hukuk</h2><p>Bu Sözleşmeye Türkiye Cumhuriyeti hukuku uygulanır; ülkenizin emredici tüketici koruma kuralları saklıdır.</p>
<h2>12. İletişim</h2><div class="card">${contactLines("tr")}</div>`;
}

function privacyEn() {
  const v = vendorInfo();
  return `<p>This policy explains how <b>${esc(v.name)}</b> processes data when you use the <b>WhatsApp by XRE</b> application for Bitrix24. For the personal data of your contacts and employees, you (the Bitrix24 account owner) are the data controller and we act as your data processor.</p>
<h2>1. Data we process</h2><ul>
<li><b>Bitrix24 account data:</b> account domain and member ID, OAuth access and refresh tokens issued by Bitrix24, user IDs and names of employees (to assign roles and show statistics).</li>
<li><b>WhatsApp messages:</b> messages, voice notes and files exchanged on connected numbers pass through our servers to be delivered between WhatsApp and Bitrix24. We keep the last 40 messages of each chat to provide translation, qualification, the AI assistant, statistics and reports.</li>
<li><b>Media files:</b> stored temporarily so Bitrix24 can download them, and deleted automatically after ${MEDIA_KEEP_DAYS} days.</li>
<li><b>Statistics and reports:</b> message counts, response times and report contents. Report links stop working after ${REPORT_TTL_DAYS} days.</li>
<li><b>Technical logs:</b> Bitrix24 REST API requests and responses (without tokens, long texts shortened) are kept for 7 days for troubleshooting, as required by Bitrix24 Market.</li>
<li><b>Billing data:</b> company or person name, tax details, address and billing e-mail you enter on the Billing tab, and your payment notices.</li>
</ul>
<h2>2. Purposes</h2><p>We use this data only to provide and support the Application: delivering messages, the features you enable, licensing and invoicing, security and troubleshooting. We do not sell data and do not use it for advertising.</p>
<h2>3. AI processing</h2><p>If AI features are enabled, the relevant message texts, voice notes and the AI assistant’s knowledge base are sent to OpenAI (OpenAI, L.L.C., USA) through its API to produce translations, transcripts, summaries and replies. Requests are sent with storage disabled; under OpenAI’s API terms, API data is not used to train its models. You can turn AI features off at any time in the Application settings.</p>
<h2>4. Sub-processors</h2><ul><li>Our hosting provider (servers that run the Application).</li><li>OpenAI, only when AI features are enabled.</li><li>WhatsApp (Meta) and Bitrix24, as the platforms you connect.</li></ul>
<h2>5. Retention and deletion</h2><p>When you uninstall the Application, we log out the connected WhatsApp sessions and delete the Bitrix24 tokens, stored chat history, statistics, reports and media of your account. We keep your billing records and the license periods of your numbers (so that a reinstall keeps paid time), as required for accounting. You can request earlier deletion by contacting us.</p>
<h2>6. Security</h2><p>Access to the management panel requires a Bitrix24 administrator session; data endpoints use short-lived signed tickets; Bitrix24 installations and events are verified with Bitrix24’s OAuth server; traffic is encrypted with TLS.</p>
<h2>7. Your rights</h2><p>Depending on applicable law (such as GDPR or the Turkish KVKK), you and the people whose data you process may request access, correction or deletion of personal data. Requests about your contacts should be sent to you as the controller; we will assist you. Contact us using the details below.</p>
<h2>8. Contact</h2><div class="card">${contactLines("en")}</div>`;
}

function privacyTr() {
  const v = vendorInfo();
  return `<p>Bu politika, Bitrix24 için <b>WhatsApp by XRE</b> uygulamasını kullandığınızda <b>${esc(v.name)}</b> tarafından hangi verilerin nasıl işlendiğini açıklar. Kişilerinizin ve çalışanlarınızın kişisel verileri için veri sorumlusu sizsiniz (Bitrix24 hesap sahibi); biz veri işleyen olarak hareket ederiz.</p>
<h2>1. İşlediğimiz veriler</h2><ul>
<li><b>Bitrix24 hesap verileri:</b> hesap alan adı ve kimliği, Bitrix24’ün verdiği OAuth erişim ve yenileme belirteçleri, çalışanların kullanıcı kimlikleri ve adları (rol atama ve istatistik için).</li>
<li><b>WhatsApp mesajları:</b> bağlı numaralardaki mesajlar, sesli mesajlar ve dosyalar WhatsApp ile Bitrix24 arasında iletilmek üzere sunucularımızdan geçer. Çeviri, nitelendirme, AI asistan, istatistik ve rapor için her sohbetin son 40 mesajı saklanır.</li>
<li><b>Medya dosyaları:</b> Bitrix24’ün indirebilmesi için geçici olarak saklanır ve ${MEDIA_KEEP_DAYS} gün sonra otomatik silinir.</li>
<li><b>İstatistik ve raporlar:</b> mesaj sayıları, cevap süreleri ve rapor içerikleri. Rapor bağlantıları ${REPORT_TTL_DAYS} gün sonra açılmaz.</li>
<li><b>Teknik kayıtlar:</b> Bitrix24 REST API istek ve cevapları (belirteçler hariç, uzun metinler kısaltılarak) sorun gidermek için 7 gün saklanır; bu Bitrix24 Market kuralıdır.</li>
<li><b>Fatura verileri:</b> Ödeme sekmesine girdiğiniz unvan veya ad soyad, vergi bilgileri, adres, fatura e-postası ve ödeme bildirimleriniz.</li>
</ul>
<h2>2. Amaçlar</h2><p>Bu verileri yalnız Uygulamayı sunmak ve desteklemek için kullanırız: mesaj iletimi, açtığınız özellikler, lisans ve faturalama, güvenlik ve sorun giderme. Verileri satmayız ve reklam için kullanmayız.</p>
<h2>3. Yapay zekâ ile işleme</h2><p>Yapay zekâ özellikleri açıksa ilgili mesaj metinleri, sesli mesajlar ve AI asistanın bilgi tabanı; çeviri, yazıya dökme, özet ve cevap üretmek için API üzerinden OpenAI’ye (OpenAI, L.L.C., ABD) gönderilir. İstekler saklama kapalı olarak gönderilir; OpenAI API koşullarına göre API verileri model eğitiminde kullanılmaz. Yapay zekâ özelliklerini Uygulama ayarlarından istediğiniz an kapatabilirsiniz.</p>
<h2>4. Alt işleyenler</h2><ul><li>Barındırma sağlayıcımız (Uygulamayı çalıştıran sunucular).</li><li>OpenAI, yalnız yapay zekâ özellikleri açıkken.</li><li>Bağladığınız platformlar olarak WhatsApp (Meta) ve Bitrix24.</li></ul>
<h2>5. Saklama ve silme</h2><p>Uygulamayı kaldırdığınızda bağlı WhatsApp oturumlarını kapatır; hesabınıza ait Bitrix24 belirteçlerini, sohbet geçmişini, istatistikleri, raporları ve medyayı sileriz. Muhasebe yükümlülüğü gereği fatura kayıtlarınızı ve numaralarınızın lisans sürelerini (yeniden kurulumda ödenen süre kaybolmasın diye) saklarız. Daha erken silinmesini bizimle iletişime geçerek isteyebilirsiniz.</p>
<h2>6. Güvenlik</h2><p>Yönetim paneline erişim Bitrix24 yönetici oturumu gerektirir; veri uçları kısa ömürlü imzalı biletlerle çalışır; Bitrix24 kurulumları ve olayları Bitrix24’ün OAuth sunucusuyla doğrulanır; trafik TLS ile şifrelenir.</p>
<h2>7. Haklarınız</h2><p>Yürürlükteki mevzuata (KVKK, GDPR gibi) göre siz ve verisini işlediğiniz kişiler kişisel verilere erişim, düzeltme veya silme talep edebilir. Kişilerinizle ilgili talepler veri sorumlusu olarak size iletilmelidir; size yardımcı oluruz. Aşağıdaki bilgilerden bize ulaşabilirsiniz.</p>
<h2>8. İletişim</h2><div class="card">${contactLines("tr")}</div>`;
}

function supportBody(lang: Lang) {
  const v = vendorInfo();
  const en = lang === "en";
  return `<div class="card">${contactLines(lang)}<br>${en ? "Support hours" : "Destek saatleri"}: ${esc(v.hours)}<br>${en ? "We reply to every request within 1 business day." : "Her talebe 1 iş günü içinde dönüş yaparız."}</div>
<h2>${en ? "Getting started" : "Başlangıç"}</h2><ol>
<li>${en ? "Open <b>WhatsApp by XRE</b> from the left menu of Bitrix24 (administrator account)." : "Bitrix24 sol menüsünden <b>WhatsApp by XRE</b>’ı açın (yönetici hesabı)."}</li>
<li>${en ? "On the <b>Connections</b> tab click <b>Add number</b>, give it a name and scan the QR code with WhatsApp (Settings → Linked devices → Link a device)." : "<b>Bağlantılar</b> sekmesinde <b>Numara ekle</b>’ye tıklayın, ad verin ve QR kodu WhatsApp’tan okutun (Ayarlar → Bağlı cihazlar → Cihaz bağla)."}</li>
<li>${en ? "On the <b>Roles</b> tab create roles with the numbers each team may see, then assign roles to employees on the <b>Staff</b> tab. Employees receive only the chats of their numbers in Open Channels." : "<b>Roller</b> sekmesinde her ekibin görebileceği numaralarla roller oluşturun, <b>Personel</b> sekmesinde çalışanlara rol atayın. Çalışanlar Açık Kanallarda yalnız kendi numaralarının sohbetlerini alır."}</li>
<li>${en ? "Optional: turn on translation, voice transcription and qualification on the <b>Settings</b> tab, and configure the <b>AI Assistant</b> and <b>Reports</b>." : "İsteğe bağlı: <b>Ayarlar</b> sekmesinden çeviri, sesli mesaj ve nitelendirmeyi açın; <b>AI Asistan</b> ve <b>Raporlar</b>’ı yapılandırın."}</li></ol>
<h2>${en ? "Common questions" : "Sık sorulanlar"}</h2>
<p><b>${en ? "Messages arrive twice." : "Mesajlar iki kez düşüyor."}</b> ${en ? "The number is probably also linked to another integration. Log out of the other integration in WhatsApp → Linked devices." : "Numara büyük olasılıkla başka bir entegrasyona da bağlı. WhatsApp → Bağlı cihazlar’dan diğer entegrasyonun oturumunu kapatın."}</p>
<p><b>${en ? "A number shows “Not connected”." : "Numara “Bağlı değil” görünüyor."}</b> ${en ? "Open its card and click <b>Reconnect</b>, then scan the new QR code. Keep the phone online for the first sync." : "Kartını açıp <b>Yeniden bağla</b>’ya tıklayın ve yeni QR kodu okutun. İlk eşitleme için telefon internete bağlı olsun."}</p>
<p><b>${en ? "Messages stopped after the trial." : "Deneme bitince mesajlar durdu."}</b> ${en ? "Buy a license for that number on the <b>Billing</b> tab or redeem a license code." : "<b>Ödeme</b> sekmesinden o numara için lisans alın veya lisans kodu kullanın."}</p>`;
}

const langOfReq = (req: Request): Lang => (String(req.query.lang || "").toLowerCase() === "tr" ? "tr" : "en");

export function registerLegalRoutes(app: Express) {
  app.get("/b24/legal/terms", (req, res) => {
    const lang = langOfReq(req);
    shell(res, lang, lang === "en" ? "End User License Agreement" : "Son Kullanıcı Lisans Sözleşmesi", lang === "en" ? termsEn() : termsTr(), "/b24/legal/terms");
  });
  app.get("/b24/legal/privacy", (req, res) => {
    const lang = langOfReq(req);
    shell(res, lang, lang === "en" ? "Privacy Policy" : "Gizlilik Politikası", lang === "en" ? privacyEn() : privacyTr(), "/b24/legal/privacy");
  });
  app.get("/b24/support", (req, res) => {
    const lang = langOfReq(req);
    shell(res, lang, lang === "en" ? "Support" : "Destek", supportBody(lang), "/b24/support");
  });
}
