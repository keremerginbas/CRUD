/* Bridge to the framework-free extension modules (loaded as classic scripts in index.html)
   and to the background service worker. */

export type Category = 'arsa' | 'arac' | 'konut' | 'isyeri' | 'diger' | 'belirsiz';
export type CrmStatus = '' | 'new' | 'called' | 'interested' | 'meeting' | 'not_interested' | 'closed';

export interface ListingRecord {
  id: string;
  source: string;
  url: string;
  listingId: string;
  title: string;
  price: number | null;
  currency: string;
  area: number | null;
  location: {city?: string; district?: string; neighborhood?: string};
  phones: string[];
  sellerName: string;
  description: string;
  rawDetails: Record<string, string>;
  features: string[];
  images: string[];
  category: Category;
  classification?: {category: Category; status: string; evidence?: {category: Category; source: string; text: string}[]};
  quality?: {status: 'complete' | 'missing' | 'review'; missing: string[]; warnings: string[]};
  archiveStatus: 'active' | 'review';
  capturedAt: string;
  updatedAt: string;
  firstSeenAt: string;
  deletedAt: string | null;
  categoryPath?: string[];
  monitoring?: Monitoring;
  market?: {searchIds: string[]; lastSeenAt?: string; firstObservedAt?: string};
  history?: {at: string; price: number | null; currency: string}[];
  lists?: string[];
  crm?: {status: CrmStatus; note: string; updatedAt?: string};
  messagedAt?: string | null;
}
export interface Monitoring {
  status?: 'active' | 'suspected' | 'removed' | 'unknown' | 'blocked' | 'error';
  lastCheckedAt?: string; lastActiveAt?: string; firstMissingAt?: string; removedAt?: string;
  lastEvidence?: string; lastError?: string; notificationStatus?: string;
}
export interface MarketStat {ppa: number; median: number | null; sample: number; ratio: number | null; opportunity: boolean}
export interface MarketEvent {
  id: string; type: 'new' | 'price_up' | 'price_down' | 'removed' | 'reactivated';
  recordId: string; listingId: string; title: string; url: string; category: Category; source: string;
  searchIds: string[]; at: string; oldPrice: number | null; newPrice: number | null; currency: string;
  delta: number | null; percent: number | null;
}
export interface Site {id: string; name: string; domain: string; category?: Category}

interface CoreApi {
  CATEGORIES: Record<Category, string>;
  CRM_STATUSES: Record<Exclude<CrmStatus, ''>, string>;
  SAFETY_KEY: string;
  filterRecords(records: ListingRecord[], filters: Record<string, unknown>): ListingRecord[];
  formatMoney(price: number | null, currency?: string): string;
  marketStats(records: ListingRecord[]): Map<string, MarketStat>;
  sellerCounts(records: ListingRecord[]): Map<string, number>;
  sellerListingCount(record: ListingRecord, counts: Map<string, number>): number;
  pricePerArea(record: ListingRecord): number | null;
}
interface DbApi {
  getAll(): Promise<ListingRecord[]>;
  get(id: string): Promise<ListingRecord | undefined>;
  upsertMany(records: unknown[], options?: Record<string, unknown>): Promise<{saved: number; added: number; updated: number}>;
  setCategory(id: string, category: Category): Promise<ListingRecord>;
  setDeleted(id: string, deleted: boolean): Promise<ListingRecord>;
  setCrm(id: string, patch: {status?: string; note?: string}): Promise<ListingRecord>;
  relabelList(fromId: string, toId?: string): Promise<{changed: number}>;
  addToList(ids: string[], listId: string): Promise<{changed: number}>;
  getEvents(options?: Record<string, unknown>): Promise<MarketEvent[]>;
  importEvents(events: unknown[]): Promise<unknown>;
  getMessageTemplates(): Promise<{id: string; name: string; body: string}[]>;
  saveMessageTemplate(template: unknown): Promise<unknown>;
}
interface TransferApi {
  importFile(file: File): Promise<unknown[] & {marketEvents?: unknown[]; listMeta?: ListMeta[]; settingsMeta?: BackupSettings; importSummary?: {invalid?: number; duplicates?: number}}>;
  exportXlsx(records: unknown[]): Promise<string> | string;
  exportCsv(records: unknown[]): Promise<string> | string;
  exportBackup(records: unknown[], options: Record<string, unknown>): Promise<string> | string;
}
interface SitesApi {
  SITES: Site[];
  get(id: string): Site | null;
  forHost(host: string): Site | null;
  sourceFor(url: string): string;
  listingId(url: string): string;
  name(id: string): string;
  namesText(): string;
}
export interface ListMeta {id: string; name: string; createdAt: string}
export interface BackupSettings {
  searches?: Record<string, unknown>[]; safety?: Record<string, unknown> | null; alerts?: Record<string, unknown> | null;
  monitor?: Record<string, unknown>; templates?: {id: string; name: string; body: string}[];
}

declare global {
  interface Window {
    IlanCore: CoreApi; IlanDB: DbApi; IlanTransfer: TransferApi; IlanSites: SitesApi;
    chrome?: any;
  }
}

export const Core = () => window.IlanCore;
export const DB = () => window.IlanDB;
export const Transfer = () => window.IlanTransfer;
export const Sites = () => window.IlanSites;
export const chromeApi = (): any => (globalThis as any).chrome;
export const hasExtension = () => Boolean(chromeApi()?.runtime?.sendMessage);

/** Sends a command to the background worker; throws with the worker's Turkish message on failure. */
export async function runtime<T = any>(type: string, config: Record<string, unknown> = {}): Promise<T> {
  if (!hasExtension()) throw new Error('Bu ekranı kurulu İlan5 eklentisi üzerinden açın.');
  const result = await chromeApi().runtime.sendMessage({type, ...config});
  if (!result?.ok) throw new Error(result?.error || 'İşlem için yanıt alınamadı.');
  return result as T;
}
export async function storageGet<T = any>(key: string): Promise<T | undefined> {
  try { return chromeApi()?.storage?.local ? (await chromeApi().storage.local.get(key))[key] : undefined; } catch { return undefined; }
}
export async function storageGetMany(keys: string[]): Promise<Record<string, any>> {
  try { return chromeApi()?.storage?.local ? await chromeApi().storage.local.get(keys) : {}; } catch { return {}; }
}
export async function storageSet(values: Record<string, unknown>) {
  if (chromeApi()?.storage?.local) await chromeApi().storage.local.set(values);
}

export const CATEGORY_LABELS: Record<Category, string> = {arsa: 'Arsa', arac: 'Araç', konut: 'Konut', isyeri: 'İşyeri', diger: 'Diğer', belirsiz: 'Belirsiz'};
export const num = (value: unknown) => Number(value || 0).toLocaleString('tr-TR');
export const formatDate = (value?: string | number | null) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.valueOf()) ? String(value) : new Intl.DateTimeFormat('tr-TR', {dateStyle: 'medium', timeStyle: 'short'}).format(d);
};
export const formatShortDate = (value?: string | null) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.valueOf()) ? '—' : new Intl.DateTimeFormat('tr-TR', {day: '2-digit', month: 'short'}).format(d);
};
export const money = (r: Pick<ListingRecord, 'price' | 'currency'>) =>
  r.price === null || r.price === undefined ? 'Fiyat belirtilmemiş' : Core().formatMoney(Number(r.price), r.currency || 'TRY');
export const moneyValue = (value: number | null | undefined, currency = 'TRY') =>
  value === null || value === undefined ? '—' : Core().formatMoney(Number(value), currency || 'TRY');
export const formatPhone = (phone: string) => {
  const n = String(phone).replace(/\D/g, '');
  return /^90\d{10}$/.test(n) ? `0${n.slice(2, 5)} ${n.slice(5, 8)} ${n.slice(8, 10)} ${n.slice(10)}` : phone;
};
export const safeUrl = (raw?: string) => { try { const url = new URL(String(raw)); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; } };
export const isDeleted = (r: ListingRecord) => Boolean(r.deletedAt);
export const isReview = (r: ListingRecord) =>
  r.archiveStatus === 'review' || r.quality?.status === 'review' || ['unknown', 'conflict'].includes(r.classification?.status || '') || r.category === 'belirsiz';
export const sourceName = (id: string) => Sites()?.name(id) || id;
export const locationText = (r: ListingRecord) => [r.location?.city, r.location?.district, r.location?.neighborhood].filter(Boolean).join(' · ');

export function qualityOf(r: ListingRecord): {label: string; tone: 'success' | 'warning' | 'danger' | 'muted'} {
  if (isDeleted(r)) return {label: 'Çöp kutusunda', tone: 'muted'};
  if (isReview(r)) return {label: 'İnceleme gerekli', tone: 'danger'};
  if (r.quality?.status === 'missing') return {label: 'Eksik alan var', tone: 'warning'};
  if (r.quality?.status === 'complete') return {label: 'Temel alanlar tam', tone: 'success'};
  return {label: 'Kontrol edilmedi', tone: 'warning'};
}
export const AVAILABILITY_LABELS: Record<string, string> = {
  active: 'Yayında', suspected: 'Tekrar kontrol bekliyor', removed: 'Yayından kaldırılmış',
  unknown: 'Henüz doğrulanmadı', blocked: 'Erişim kontrolü bekliyor', error: 'Kontrol tamamlanamadı',
};
export const NOTIFICATION_LABELS: Record<string, string> = {
  queued: 'Bildirim sırada', sending: 'Gönderiliyor', sent: 'Telegram bildirimi gönderildi', failed: 'Bildirim gönderilemedi',
  uncertain: 'Teslimat durumu belirsiz', pending: 'Bildirim bekliyor', queue_error: 'Bildirim kuyruğu yeniden denenecek',
  cancelled: 'İlan durumu değişti; bildirim iptal edildi',
};
export const availabilityOf = (r: ListingRecord) => r.monitoring?.status || 'unknown';
