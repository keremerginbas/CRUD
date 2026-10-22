import { createMockProvider } from './mock.js';
import { createSiteProvider, loadSiteConfig } from './sites.js';

// PROVIDERS=demo  → sadece demo veriler (varsayılan)
// PROVIDERS=live  → gerçek siteler
// PROVIDERS=obilet,skyscanner → sadece seçilen gerçek siteler
export function createProviders(setting = process.env.PROVIDERS || 'demo', siteConfig = loadSiteConfig()) {
  if (setting === 'demo') {
    return Object.entries(siteConfig).map(([id, site]) =>
      createMockProvider({ id, name: site.name, modes: Object.keys(site.modes) }),
    );
  }
  const wanted = setting === 'live' ? Object.keys(siteConfig) : setting.split(',').map((s) => s.trim());
  return wanted.map((id) => {
    if (!siteConfig[id]) throw new Error(`Bilinmeyen sağlayıcı: ${id}`);
    return createSiteProvider(id, siteConfig[id]);
  });
}
