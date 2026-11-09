/* Derived, data-backed insights for the command center. Every number comes from the archive. */
import {Core, Sites, isDeleted, isReview, type ListingRecord, type MarketEvent, type MarketStat} from './ext';
import type {Job, SafetyState} from './store';

export type Priority = {
  id: string; level: 'high' | 'medium' | 'low'; label: string; title: string; detail?: string;
  action: {kind: 'detail'; id: string} | {kind: 'listings'; filters: Record<string, string>} | {kind: 'view'; view: 'collect' | 'settings' | 'market'};
};

export function priorities(input: {records: ListingRecord[]; stats: Map<string, MarketStat>; events: MarketEvent[]; job: Job | null; safety: SafetyState | null}): Priority[] {
  const {records, stats, events, job, safety} = input;
  const active = records.filter(r => !isDeleted(r));
  const list: Priority[] = [];
  if (job && ['blocked', 'paused'].includes(job.status)) {
    list.push({id: 'job', level: 'high', label: job.status === 'blocked' ? 'Tarama bekliyor' : 'Tarama duraklatıldı', title: job.status === 'blocked' ? 'Doğrulama veya giriş ekranı çıktı; tarama penceresini kontrol edin.' : 'Kalan sıra korunuyor; devam ettirebilirsiniz.', detail: Sites().name(job.source || ''), action: {kind: 'view', view: 'collect'}});
  }
  for (const r of active.filter(r => r.crm?.status === 'meeting').slice(0, 3)) {
    list.push({id: 'meet:' + r.id, level: 'high', label: 'Görüşülecek', title: r.title || 'Başlıksız ilan', detail: r.crm?.note ? r.crm.note.slice(0, 90) : r.sellerName || undefined, action: {kind: 'detail', id: r.id}});
  }
  const drops = events.filter(e => e.type === 'price_down' && Number.isFinite(e.percent)).sort((a, b) => Number(a.percent) - Number(b.percent)).slice(0, 2);
  for (const e of drops) {
    const record = active.find(r => r.id === e.recordId);
    list.push({id: 'drop:' + e.id, level: 'medium', label: `Fiyat %${Math.abs(Number(e.percent)).toLocaleString('tr-TR', {maximumFractionDigits: 1})} düştü`, title: e.title || 'Başlıksız ilan', detail: `${Core().formatMoney(e.oldPrice, e.currency)} → ${Core().formatMoney(e.newPrice, e.currency)}`, action: record ? {kind: 'detail', id: record.id} : {kind: 'view', view: 'market'}});
  }
  const untouched = active.filter(r => stats.get(r.id)?.opportunity && !r.crm?.status && !r.messagedAt && (r.phones || []).length);
  if (untouched.length) list.push({id: 'untouched', level: 'medium', label: 'Ulaşılmamış fırsat', title: `${untouched.length.toLocaleString('tr-TR')} fırsat ilanına henüz ulaşılmadı`, detail: 'Telefonu kayıtlı, bölge medyanının en az %20 altında.', action: {kind: 'listings', filters: {insight: 'opportunity', crm: 'none'}}});
  const review = active.filter(isReview).length;
  if (review) list.push({id: 'review', level: 'low', label: 'İnceleme', title: `${review.toLocaleString('tr-TR')} ilanın kategorisi doğrulanmalı`, action: {kind: 'listings', filters: {category: 'review'}}});
  const limit = Number(safety?.safety.phoneDailyLimit ?? 0);
  if (limit) for (const site of Sites().SITES) {
    const used = Number(safety?.todaySites?.[site.id]?.phones || 0);
    if (used >= limit * 0.8) list.push({id: 'limit:' + site.id, level: used >= limit ? 'medium' : 'low', label: 'Telefon limiti', title: `${site.name}: bugün ${used}/${limit} telefon gösterildi`, detail: used >= limit ? 'Limit doldu; ilanlar yarına kadar telefonsuz kaydedilir.' : 'Limit dolmak üzere.', action: {kind: 'view', view: 'settings'}});
  }
  return list;
}

export const initials = (text: string) => text.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toLocaleUpperCase('tr-TR')).join('') || '?';
export const median = (values: number[]) => { if (!values.length) return null; const s = [...values].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const percentChange = (current: number, previous: number) => previous > 0 ? (current - previous) / previous * 100 : current > 0 ? null : 0;
