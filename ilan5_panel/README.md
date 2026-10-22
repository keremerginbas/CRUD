# İlan5 paneli (React)

Eklentinin “Komuta Merkezi” paneli. Kaynak bu klasörde, derlenmiş çıktı `../ilan5_extension/panel/` içindedir; eklenti kullanıcısının derleme yapması gerekmez.

- Yığın: React 19, Vite 7, Tailwind CSS v4, shadcn/ui tarzı bileşenler (Base UI + class-variance-authority + tailwind-merge), TanStack Table 8, Recharts 3, Motion 12, Lucide.
- Panel, eklentinin çerçevesiz modüllerini (`sites.js`, `core.js`, `database.js`, `transfer.js`, SheetJS) klasik script olarak yükler ve arka plan servis çalışanıyla `chrome.runtime.sendMessage` üzerinden konuşur (`src/lib/ext.ts`, `src/lib/store.ts`).
- Chrome eklenti sayfaları satır içi ve uzak script çalıştıramaz; Vite yapılandırması her şeyi göreli yollu yerel dosyalar olarak üretir.

```bash
npm install
npm run build      # tip kontrolü + ../ilan5_extension/panel
npm run test:e2e   # derlenmiş paneli Chromium'da sahte chrome API ile dener
```
