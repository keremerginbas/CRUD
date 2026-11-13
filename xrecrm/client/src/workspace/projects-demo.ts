// Demo modu için örnek proje ve daire envanteri. Adlar kurgusaldır; gerçek firma veya kişi içermez.
// Görseller dış sunucuya gitmeden, satır içi SVG olarak üretilir.
import type { Inventory, Project, Unit, UnitCurrency, UnitStatus } from "../../../shared/real-estate";

function art(hue: number, real: boolean, towers: number[]): string {
  const sky = real ? [`hsl(${hue} 28% 78%)`, `hsl(${hue} 22% 62%)`] : [`hsl(${hue} 70% 82%)`, `hsl(${(hue + 40) % 360} 75% 68%)`];
  const body = real ? `hsl(${hue} 10% 46%)` : `hsl(${hue} 32% 34%)`;
  const glass = real ? `hsl(${hue} 18% 70%)` : `hsl(${(hue + 30) % 360} 80% 86%)`;
  const width = 800;
  const step = width / (towers.length + 1);
  let shapes = "";
  towers.forEach((height, i) => {
    const w = step * 0.62;
    const x = step * (i + 1) - w / 2;
    const y = 450 - height;
    shapes += `<rect x="${x}" y="${y}" width="${w}" height="${height}" rx="6" fill="${body}"/>`;
    for (let row = 0; row < Math.floor(height / 34) - 1; row++)
      for (let col = 0; col < 3; col++)
        shapes += `<rect x="${x + 14 + col * ((w - 28) / 3)}" y="${y + 16 + row * 34}" width="${(w - 28) / 3 - 8}" height="18" rx="2" fill="${glass}" opacity="${real ? 0.55 : 0.9}"/>`;
  });
  const crane = real
    ? `<g stroke="hsl(${hue} 12% 30%)" stroke-width="6" fill="none"><path d="M690 450V120M610 150h170M690 120l-60 30M690 120l80 30M770 150v60"/></g>`
    : `<circle cx="660" cy="110" r="46" fill="#fff" opacity="0.75"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient></defs><rect width="800" height="500" fill="url(#g)"/>${crane}${shapes}<rect y="450" width="800" height="50" fill="${real ? `hsl(${hue} 14% 36%)` : `hsl(${(hue + 100) % 360} 34% 42%)`}"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function makeProjectsDemo(): Inventory {
  const stamp = new Date().toISOString();
  const projects: Project[] = [
    {
      id: "demo-project-1",
      name: "Örnek Vadi Konutları",
      city: "İstanbul",
      district: "Kartal",
      address: "Örnek Mah. Vadi Cad. No: 10",
      description:
        "Deniz ve vadi manzaralı iki bloktan oluşan konut projesi. Metroya yürüme mesafesinde, geniş peyzaj alanı ve kapalı otoparkıyla aile yaşamına uygun planlandı.",
      status: "satışta",
      deliveryDate: "2027-06-30",
      developer: "Örnek Yapı Geliştirme",
      amenities: ["Kapalı otopark", "Açık havuz", "Fitness salonu", "Çocuk oyun alanı", "7/24 güvenlik"],
      images: [
        { id: "demo-img-1", url: art(200, false, [300, 380, 260]), kind: "render", caption: "Genel görünüm" },
        { id: "demo-img-2", url: art(170, false, [220, 340, 340, 220]), kind: "render", caption: "Peyzaj ve bloklar" },
        { id: "demo-img-3", url: art(205, true, [180, 260]), kind: "gerçek", caption: "Şantiye — A blok kaba inşaat" },
      ],
      archived: false,
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: "demo-project-2",
      name: "Deneme Kule Rezidans",
      city: "İzmir",
      district: "Bayraklı",
      address: "Deneme Mah. Körfez Blv. No: 5",
      description: "Körfez manzaralı tek kule; rezidans hizmetleri, ofis katları ve zemin katta ticari üniteler.",
      status: "yakında",
      deliveryDate: "2028-03-31",
      developer: "Deneme Gayrimenkul Yatırım",
      amenities: ["Resepsiyon", "Vale", "Kapalı havuz", "Toplantı salonu"],
      images: [
        { id: "demo-img-4", url: art(265, false, [400]), kind: "render", caption: "Kule — gün batımı" },
        { id: "demo-img-5", url: art(250, true, [150]), kind: "gerçek", caption: "Temel çalışmaları" },
      ],
      archived: false,
      createdAt: stamp,
      updatedAt: stamp,
    },
  ];
  const row = (
    n: number, projectId: string, block: string, floor: number, unitNo: string, type: string, grossM2: number, netM2: number,
    facade: string, view: string, listPrice: number, currency: UnitCurrency, status: UnitStatus, features: string[],
  ): Unit => ({
    id: `demo-unit-${n}`, projectId, block, floor, unitNo, type, grossM2, netM2, facade, view, listPrice, currency, status, features,
    notes: "", floorPlanImageUrl: "", archived: false, createdAt: stamp, updatedAt: stamp,
  });
  const p1 = "demo-project-1";
  const p2 = "demo-project-2";
  const units: Unit[] = [
    row(1, p1, "A", 1, "1", "1+1", 68, 55, "Kuzey", "Bahçe", 3_150_000, "TRY", "müsait", ["Balkon"]),
    row(2, p1, "A", 2, "5", "2+1", 105, 88, "Güney", "Vadi", 4_650_000, "TRY", "müsait", ["Balkon", "Ebeveyn banyosu"]),
    row(3, p1, "A", 4, "13", "2+1", 108, 90, "Güneydoğu", "Vadi", 4_950_000, "TRY", "opsiyonlu", ["Balkon"]),
    row(4, p1, "A", 7, "25", "3+1", 145, 122, "Güneybatı", "Deniz", 7_400_000, "TRY", "müsait", ["Teras", "Ebeveyn banyosu", "Giyinme odası"]),
    row(5, p1, "B", 0, "1", "2+1", 112, 93, "Doğu", "Bahçe", 4_300_000, "TRY", "müsait", ["Bahçe kullanımı"]),
    row(6, p1, "B", 3, "10", "3+1", 140, 118, "Batı", "Vadi", 6_600_000, "TRY", "satıldı", ["Balkon", "Ebeveyn banyosu"]),
    row(7, p1, "B", 9, "34", "4+1 dubleks", 210, 176, "Güney", "Deniz", 11_900_000, "TRY", "müsait", ["Teras", "Şömine"]),
    row(8, p2, "", 6, "601", "1+1", 72, 58, "Batı", "Körfez", 185_000, "USD", "müsait", ["Akıllı ev"]),
    row(9, p2, "", 6, "602", "2+1", 118, 96, "Güneybatı", "Körfez", 298_000, "USD", "müsait", ["Akıllı ev", "Balkon"]),
    row(10, p2, "", 14, "1403", "2+1", 121, 98, "Batı", "Körfez", 335_000, "USD", "opsiyonlu", ["Akıllı ev"]),
    row(11, p2, "", 21, "2101", "3+1", 168, 139, "Güneybatı", "Körfez", 520_000, "USD", "müsait", ["Teras", "Akıllı ev"]),
    row(12, p2, "", 0, "D1", "Dükkan", 95, 84, "Doğu", "Bulvar", 9_800_000, "TRY", "müsait", ["Cadde cepheli"]),
  ];
  return { projects, units };
}
