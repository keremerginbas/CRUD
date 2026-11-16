/* Panel side of the Bitrix transfer: settings, host permission and sending selected listings to n8n. */
import {DB, chromeApi, storageGet, storageSet, type ListingRecord} from './ext';

export type TargetId = 'arsa' | 'barter' | 'auto';
export interface BitrixTarget {id: TargetId; name: string; hint: string}
export interface BitrixConfig {targets: Record<TargetId, {url: string}>}
export interface BitrixResult {id: string; listingId: string; status: 'added' | 'duplicate' | 'error'; dealId: string; message: string}
interface BitrixApi {
  KEY: string; TARGETS: BitrixTarget[];
  webhookUrl(value: string): string; originPattern(value: string): string; normalizeConfig(raw: unknown): BitrixConfig;
  send(fetchFn: typeof fetch, url: string, target: string, records: ListingRecord[], options?: {onProgress?: (done: number, total: number) => void}): Promise<BitrixResult[]>;
  ping(fetchFn: typeof fetch, url: string, target: string): Promise<boolean>;
}
declare global { interface Window { IlanBitrix: BitrixApi } }
export const Bitrix = () => window.IlanBitrix;
const doFetch: typeof fetch = (input, init) => fetch(input, init);

export async function loadBitrixConfig(): Promise<BitrixConfig> { return Bitrix().normalizeConfig(await storageGet(Bitrix().KEY)); }

/** Must be called straight from a click: Chrome asks the user once per n8n address. */
export function requestAccess(urls: string[]): Promise<boolean> {
  const permissions = chromeApi()?.permissions;
  const origins = [...new Set(urls.filter(Boolean).map(url => Bitrix().originPattern(url)))];
  if (!origins.length || !permissions?.request) return Promise.resolve(true);
  return permissions.request({origins});
}
async function hasAccess(url: string): Promise<boolean> {
  const permissions = chromeApi()?.permissions;
  if (!permissions?.contains) return true;
  return permissions.contains({origins: [Bitrix().originPattern(url)]});
}
export async function saveBitrixConfig(config: BitrixConfig) { await storageSet({[Bitrix().KEY]: Bitrix().normalizeConfig(config)}); }

export async function testTarget(target: TargetId, url: string) {
  if (!await hasAccess(url)) throw new Error('Chrome bu n8n adresine erişim izni vermedi. “Kaydet”e basıp izni onaylayın.');
  return Bitrix().ping(doFetch, url, target);
}

/** Sends the listings, records the Deal IDs on each listing and returns a summary. */
export async function sendToBitrix(target: TargetId, records: ListingRecord[], onProgress?: (done: number, total: number) => void) {
  const url = (await loadBitrixConfig()).targets[target]?.url;
  if (!url) throw new Error('Bu hat için n8n adresi girilmemiş. Ayarlar → Bitrix aktarımı bölümünden ekleyin.');
  if (!await hasAccess(url)) throw new Error('Chrome bu n8n adresine erişim izni vermedi. Ayarlar → Bitrix aktarımı → Kaydet ile izni onaylayın.');
  const results = await Bitrix().send(doFetch, url, target, records, {onProgress});
  for (const result of results) if (result.status !== 'error' && result.dealId) {
    try { await DB().setBitrix(result.id, target, {dealId: result.dealId, status: result.status}); } catch { /* the transfer itself succeeded */ }
  }
  return {results, added: results.filter(r => r.status === 'added').length, duplicate: results.filter(r => r.status === 'duplicate').length,
    errors: results.filter(r => r.status === 'error')};
}
