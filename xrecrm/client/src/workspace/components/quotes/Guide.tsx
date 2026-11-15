// "Nasıl çalışır" kutusu: satış ekranlarında işin sırasını ve hesabın neye göre yapıldığını sade dille anlatır.
// Kullanıcı kapatırsa tercih tarayıcıda hatırlanır.
import { useState, type ReactNode } from "react";
import { HelpCircle } from "lucide-react";

export interface GuideStep {
  title: string;
  text: ReactNode;
}

export function Guide({ id, title = "Nasıl çalışır?", steps, note }: { id: string; title?: string; steps: GuideStep[]; note?: ReactNode }) {
  const key = `xre-guide-${id}`;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) !== "closed";
    } catch {
      return true;
    }
  });
  const toggle = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(key, next ? "open" : "closed");
    } catch {
      /* depolama kapalı */
    }
  };
  return (
    <details className="gd-box" open={open} onToggle={(e) => toggle((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <HelpCircle size={16} /> <strong>{title}</strong> <small>{open ? "gizlemek için tıklayın" : "görmek için tıklayın"}</small>
      </summary>
      <ol className="gd-steps">
        {steps.map((step, i) => (
          <li key={i}>
            <b>{i + 1}</b>
            <div>
              <strong>{step.title}</strong>
              <span>{step.text}</span>
            </div>
          </li>
        ))}
      </ol>
      {note && <p className="gd-note">{note}</p>}
    </details>
  );
}

export const QUOTE_GUIDE: GuideStep[] = [
  { title: "Daireyi ve müşteriyi seçin", text: "“Yeni teklif”e basın, projeden daireyi seçin, müşteriyi seçin. (Müşteri kartındaki “Teklif hazırla” düğmesi de aynı yere getirir.)" },
  { title: "Satış bedeli, peşinat ve taksit sayısını yazın", text: "Taksitleri ve vade farkını sistem hesaplar; siz hesap yapmazsınız." },
  { title: "Onaya gönderin", text: "Teklif yöneticiye gider. Onaylanmadan müşteriye verilemez, PDF çıkmaz." },
  { title: "Yönetici onaylar veya reddeder", text: "Onaylanırsa “Teklif PDF” düğmesi açılır; PDF’i müşteriye verirsiniz. “Bu fiyata satamayız” denirse bu paraya verilebilecek daireler listelenir." },
  { title: "Satış olunca “Satışa döndü” deyin", text: "Daire satıldı olur. Aynı sayfada alıcı bilgilerini girip sözleşmeyi (Word) ve senetleri (PDF) alırsınız." },
];
export const SENET_GUIDE: GuideStep[] = [
  { title: "Senetler ödeme planından çıkar", text: "Onaylı teklifte “Sözleşme ve senetler” bölümüne alıcı bilgilerini girince, plandaki her taksit ve ara ödeme için bir senet oluşur. Peşinat için senet yoktur." },
  { title: "Tutar ve vade teklifteki ile aynıdır", text: "Örnek: 60 taksit varsa 60 senet olur; her senedin tutarı o ayın taksiti, vadesi o ayın ödeme günüdür." },
  { title: "Ödeme gelince “Ödendi” deyin", text: "Vadesi geçip ödenmeyen senet kırmızı görünür." },
  { title: "Gecikme faizi", text: "Senet tutarı × aylık gecikme oranı × gecikilen gün ÷ 30. Örnek: 100.000 TL, aylık %3, 30 gün gecikme → 3.000 TL." },
];
export const COST_GUIDE: GuideStep[] = [
  { title: "Para maliyeti nedir?", text: "Vadeli satışta para bugün değil, aylar içinde gelir. İleride gelecek para bugünkü paradan daha az değerlidir. Aradaki fark para maliyetidir." },
  { title: "Neye göre hesaplanır?", text: "Sizin belirlediğiniz tek bir aylık orana göre. Her taksit, kaç ay sonra ödenecekse o kadar ay için bu oranla bugüne indirilir; hepsinin toplamı “bugünkü değer”dir." },
  { title: "Örnek", text: "Müşteri toplam 5.000.000 TL ödeyecek ama bu ödemelerin bugünkü değeri 4.100.000 TL ise, para maliyeti 900.000 TL’dir." },
  { title: "Nasıl karar verilir?", text: "Bugünkü değer liste fiyatının üstündeyse teklif kârlıdır (yeşil). Altındaysa daireyi liste fiyatından ucuza satıyorsunuz demektir (kırmızı)." },
  { title: "Oranı nereden değiştiririm?", text: "Bu sayfadaki “Oranlar” sekmesinden. Vade farkı oranı müşteriye yansıyan orandır; para maliyeti oranı yalnız sizin gördüğünüz iç hesaptır." },
];
export const DEALER_GUIDE: GuideStep[] = [
  { title: "Bayileri tanımlayın", text: "Önce ana bayiyi, sonra alt bayileri ekleyin ve çalışanları bayilere atayın." },
  { title: "Bayi müşterisini kaydeder", text: "Müşteriyi ve projeyi seçip “Kaydet ve korumaya al” der. Müşteri telefon numarasından tanınır." },
  { title: "Koruma süresince başkası kaydedemez", text: "Başka bayi aynı müşteriyi aynı proje için kaydetmek isterse “daha önce kayıtlı” uyarısı alır." },
  { title: "Süre dolunca", text: "Satış yapıldıysa kayıt o bayide kalır. Yapılmadıysa müşteri ana bayiye geçer ve diğer bayiler bir daha kaydedemez." },
];
