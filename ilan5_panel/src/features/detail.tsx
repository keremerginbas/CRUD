import * as React from 'react';
import {ExternalLink, MapPin, Phone, Trash2, Undo2, Map as MapIcon, Landmark, TriangleAlert} from 'lucide-react';
import {CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis} from 'recharts';
import {Dialog, SheetContent, DialogTitle} from '@/components/ui/dialog';
import {Button, buttonVariants} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {NativeSelect, Textarea} from '@/components/ui/input';
import {toast} from '@/components/ui/toast';
import {AvailabilityBadge, Field, QualityBadge, SourceBadge} from '@/components/common';
import {
  CATEGORY_LABELS, Core, DB, NOTIFICATION_LABELS, availabilityOf, formatDate, formatPhone, isDeleted, isReview, locationText, money, safeUrl,
  type Category, type ListingRecord,
} from '@/lib/ext';
import {listName, refresh, useStore} from '@/lib/store';
import {closeDetail, useUi} from '@/lib/ui';
import {cn} from '@/lib/utils';

function Block({title, children, className}: {title: string; children: React.ReactNode; className?: string}) {
  return (
    <section className={cn('border-t py-5 first:border-t-0', className)}>
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function PriceHistory({record}: {record: ListingRecord}) {
  const points = [...(record.history || []).filter(h => h.price !== null && h.currency === record.currency), {at: record.updatedAt, price: record.price, currency: record.currency}]
    .filter(p => p.price !== null && p.at).map(p => ({date: new Date(p.at).getTime(), price: Number(p.price)}));
  const distinct = new Set(points.map(p => p.price));
  if (points.length < 2 || distinct.size < 2) return null;
  const fmt = (value: number) => Core().formatMoney(value, record.currency || 'TRY');
  return (
    <Block title="Fiyat geçmişi">
      <div className="h-44 w-full" data-testid="price-history">
        <ResponsiveContainer>
          <LineChart data={points} margin={{top: 8, right: 8, bottom: 0, left: 8}}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="date" type="number" domain={['dataMin', 'dataMax']} tickFormatter={v => new Intl.DateTimeFormat('tr-TR', {day: '2-digit', month: 'short'}).format(v)} tick={{fontSize: 11, fill: 'var(--muted-foreground)'}} stroke="var(--border)" />
            <YAxis tickFormatter={v => Intl.NumberFormat('tr-TR', {notation: 'compact'}).format(v)} tick={{fontSize: 11, fill: 'var(--muted-foreground)'}} stroke="var(--border)" width={48} />
            <ChartTooltip formatter={value => fmt(Number(value))} labelFormatter={v => formatDate(Number(v))} contentStyle={{background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12}} />
            <Line type="stepAfter" dataKey="price" name="Fiyat" stroke="var(--primary)" strokeWidth={2} dot={{r: 3}} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Block>
  );
}

function CrmBlock({record}: {record: ListingRecord}) {
  const [status, setStatus] = React.useState<string>(record.crm?.status || '');
  const [note, setNote] = React.useState(record.crm?.note || '');
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { setStatus(record.crm?.status || ''); setNote(record.crm?.note || ''); }, [record.id]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save() {
    setBusy(true);
    try { await DB().setCrm(record.id, {status, note}); await refresh(); toast('Takip durumu ve not kaydedildi.'); }
    catch (error) { toast((error as Error).message, true); } finally { setBusy(false); }
  }
  return (
    <Block title="Takip ve not">
      <div className="flex flex-col gap-2.5">
        <NativeSelect value={status} onChange={e => setStatus(e.target.value)} aria-label="Takip durumu" data-testid="crm-status">
          <option value="">Durum seçilmedi</option>
          {Object.entries(Core().CRM_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </NativeSelect>
        <Textarea value={note} maxLength={4000} onChange={e => setNote(e.target.value)} placeholder="Görüşme notu, fiyat pazarlığı, geri arama tarihi…" aria-label="İlan notu" data-testid="crm-note" />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={save} disabled={busy} data-testid="crm-save">Kaydet</Button>
          {record.messagedAt && <Badge variant="info">Mesaj gönderildi: {formatDate(record.messagedAt)}</Badge>}
          {record.crm?.updatedAt && <span className="text-xs text-muted-foreground">Son güncelleme: {formatDate(record.crm.updatedAt)}</span>}
        </div>
      </div>
    </Block>
  );
}

export function DetailSheet() {
  const id = useUi(s => s.detailId);
  const records = useStore(s => s.records);
  const stats = useStore(s => s.stats);
  const sellers = useStore(s => s.sellers);
  const record = id ? records.find(r => r.id === id) : undefined;
  const [category, setCategory] = React.useState<Category>('arsa');
  React.useEffect(() => { if (record) setCategory(record.category === 'belirsiz' ? 'arsa' : record.category); }, [record?.id, record?.category]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (id && records.length && !record) { toast('Bu kayıt artık bulunamıyor.', true); closeDetail(); } }, [id, record, records.length]);

  return (
    <Dialog open={Boolean(record)} onOpenChange={open => { if (!open) closeDetail(); }}>
      {record && (() => {
        const r = record, stat = stats.get(r.id), sellerTotal = Core().sellerListingCount(r, sellers), m = r.monitoring || {}, status = availabilityOf(r);
        const warnings = [...new Set([...(r.quality?.missing || []).map(field => `Eksik alan: ${field}`), ...(r.quality?.warnings || [])])];
        const place = [r.location?.neighborhood, r.location?.district, r.location?.city].filter(Boolean).join(', ');
        const pick = (...keys: string[]) => { for (const key of keys) for (const [k, v] of Object.entries(r.rawDetails || {})) if (k.toLocaleLowerCase('tr-TR').replace(/\s/g, '') === key.toLocaleLowerCase('tr-TR').replace(/\s/g, '') && v) return String(v); return ''; };
        const adaParsel = pick('Ada/Parsel No', 'Ada / Parsel', 'Ada/Parsel') || [pick('Ada No'), pick('Parsel No')].filter(Boolean).join(' / ');
        const url = safeUrl(r.url);
        async function saveCategory() {
          try { await DB().setCategory(r.id, category); await refresh(); toast('Kategori güncellendi. Kayıt ilgili arşive taşındı.'); } catch (error) { toast((error as Error).message, true); }
        }
        async function toggleDeleted() {
          try { await DB().setDeleted(r.id, !isDeleted(r)); await refresh(); closeDetail(); toast(isDeleted(r) ? 'İlan arşive geri alındı.' : 'İlan çöp kutusuna taşındı; buradan geri alabilirsiniz.'); }
          catch (error) { toast((error as Error).message, true); }
        }
        return (
          <SheetContent title="İlan ayrıntıları" data-testid="detail-sheet">
            <div className="flex flex-wrap items-center gap-2"><SourceBadge source={r.source} /><Badge variant="secondary">{CATEGORY_LABELS[r.category] || 'Belirsiz'}</Badge><QualityBadge record={r} /></div>
            <DialogTitle className="mt-3 text-xl leading-snug">{r.title || 'Başlık okunamadı'}</DialogTitle>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-2xl font-semibold tracking-tight text-primary tabular-nums">{money(r)}</span>
              {stat && <span className="text-sm text-muted-foreground tabular-nums">{Core().formatMoney(Math.round(stat.ppa), r.currency || 'TRY')} / m²</span>}
              {stat?.opportunity && stat.ratio !== null && <Badge variant="success">Fırsat −%{Math.round((1 - stat.ratio) * 100)}</Badge>}
            </div>
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground"><MapPin className="size-3.5" />{locationText(r) || 'Konum belirtilmemiş'}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {url && <a href={url} target="_blank" rel="noopener noreferrer" className={buttonVariants({size: 'sm'})}><ExternalLink />Kaynak ilanı aç</a>}
              <Button size="sm" variant="outline" onClick={toggleDeleted}>{isDeleted(r) ? <><Undo2 />Arşive geri al</> : <><Trash2 />Çöp kutusuna taşı</>}</Button>
            </div>
            {(isReview(r) || warnings.length > 0) && (
              <div className="mt-5 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                <p className="flex items-center gap-2 font-medium"><TriangleAlert className="size-4 text-warning" />{isReview(r) ? 'Kategoriyi doğrulayın. Bu kayıt kontrol edilene kadar kategori arşivlerine eklenmez.' : 'Bazı alanlar okunamadı veya ilanda belirtilmemiş.'}</p>
                {warnings.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-5 text-muted-foreground">{warnings.map(w => <li key={w}>{w}</li>)}</ul>}
              </div>
            )}
            <div className="mt-2">
              <Block title="İletişim">
                <dl className="grid grid-cols-2 gap-4">
                  <Field label="İlan sahibi / satıcı">{r.sellerName || '—'}</Field>
                  <Field label="İlan numarası">{r.listingId || r.id}</Field>
                </dl>
                <div className="mt-3 flex flex-col gap-1.5">
                  {(r.phones || []).length ? r.phones.map(phone => (
                    <a key={phone} href={`tel:${phone.replace(/[^\d+]/g, '')}`} className="inline-flex w-fit items-center gap-2 text-base font-medium text-primary tabular-nums hover:underline"><Phone className="size-4" />{formatPhone(phone)}</a>
                  )) : <p className="text-sm text-muted-foreground">Telefon alınamadı veya ilanda görünür değil.</p>}
                  {sellerTotal > 1 && <p className="text-xs text-muted-foreground">Bu satıcının arşivde {sellerTotal} ilanı var (aynı telefon).</p>}
                </div>
              </Block>
              <CrmBlock record={r} />
              <Block title="Yayın durumu ve bildirim">
                <AvailabilityBadge record={r} />
                <dl className="mt-3 grid grid-cols-2 gap-4">
                  <Field label="Son kontrol">{formatDate(m.lastCheckedAt)}</Field>
                  <Field label="Son yayında görülme">{formatDate(m.lastActiveAt)}</Field>
                  <Field label="İlk kaldırılma işareti">{formatDate(m.firstMissingAt)}</Field>
                  <Field label="Kaldırılmanın doğrulandığı zaman">{formatDate(m.removedAt)}</Field>
                </dl>
                {m.lastEvidence && <p className="mt-3 text-xs text-muted-foreground">Kontrol sonucu: {m.lastEvidence}</p>}
                {m.lastError && <p className="mt-1 text-xs text-muted-foreground">Kontrol notu: {m.lastError}</p>}
                <p className="mt-2 text-xs text-muted-foreground">{NOTIFICATION_LABELS[m.notificationStatus || ''] || 'Henüz Telegram bildirimi yok.'}</p>
                {['unknown', 'blocked', 'error'].includes(status) && <p className="mt-1 text-xs text-muted-foreground">Bu durum ilanın kaldırıldığı anlamına gelmez. Sonuç kesinleşince yayın durumu güncellenir.</p>}
              </Block>
              <Block title="Konum ve parsel">
                <div className="flex flex-wrap gap-2">
                  {place && <a className={buttonVariants({variant: 'outline', size: 'sm'})} href={'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(place)} target="_blank" rel="noopener noreferrer"><MapIcon />Haritada göster</a>}
                  <a className={buttonVariants({variant: 'outline', size: 'sm'})} href="https://parselsorgu.tkgm.gov.tr/" target="_blank" rel="noopener noreferrer"><Landmark />TKGM parsel sorgu</a>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{adaParsel ? `Ada / parsel: ${adaParsel}. Parsel sorguda il, ilçe, mahalle ve bu numaraları girerek sınırları görebilirsiniz.` : 'İlanda ada/parsel bilgisi yok. Harita konumu mahalle düzeyindedir; kesin yer değildir.'}</p>
              </Block>
              <PriceHistory record={r} />
              <Block title="İlan bilgileri">
                <dl className="grid grid-cols-2 gap-4">
                  {stat && <Field label="m² fiyatı">{Core().formatMoney(Math.round(stat.ppa), r.currency || 'TRY')} / m²</Field>}
                  {stat && stat.ratio !== null && <Field label="Bölge karşılaştırması">Medyan {Core().formatMoney(Math.round(stat.median || 0), r.currency || 'TRY')} / m² · {stat.sample} ilan · {stat.ratio < 1 ? `%${Math.round((1 - stat.ratio) * 100)} altında` : `%${Math.round((stat.ratio - 1) * 100)} üstünde`}</Field>}
                  {(r.lists || []).length > 0 && <Field label="Listeler">{r.lists!.map(listName).join(', ')}</Field>}
                  {r.area !== null && r.area !== undefined && <Field label="Alan">{Number(r.area).toLocaleString('tr-TR')} m²</Field>}
                  {Object.entries(r.rawDetails || {}).map(([key, value]) => <Field key={key} label={key}>{value}</Field>)}
                </dl>
                {!Object.keys(r.rawDetails || {}).length && !stat && <p className="text-sm text-muted-foreground">Ek ilan alanı kaydedilmemiş.</p>}
              </Block>
              {(r.features || []).length > 0 && <Block title="Özellikler"><div className="flex flex-wrap gap-1.5">{r.features.map(f => <Badge key={f} variant="secondary">{f}</Badge>)}</div></Block>}
              <Block title="İlan açıklaması"><p className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">{r.description || 'Açıklama kaydedilmemiş.'}</p></Block>
              <Block title="Kategori kontrolü">
                {(r.categoryPath || []).length > 0 && <p className="mb-2 text-sm text-muted-foreground">{r.categoryPath!.join(' › ')}</p>}
                <p className="mb-2 text-sm text-muted-foreground">{r.classification?.status === 'manual' ? 'Bu kayıt için kategori elle doğrulandı.' : 'İlanın kategori bilgilerini kontrol ederek gerekirse arşivini değiştirebilirsiniz.'}</p>
                {(r.classification?.evidence || []).length > 0 && <ul className="mb-3 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">{r.classification!.evidence!.slice(0, 12).map((e, i) => <li key={i}>{CATEGORY_LABELS[e.category] || 'Kategori'}: {e.text} ({e.source})</li>)}</ul>}
                <div className="flex gap-2">
                  <NativeSelect value={category} onChange={e => setCategory(e.target.value as Category)} aria-label="İlanın doğru kategorisi" className="flex-1">
                    {(Object.keys(CATEGORY_LABELS) as Category[]).filter(k => k !== 'belirsiz').map(k => <option key={k} value={k}>{CATEGORY_LABELS[k]}</option>)}
                  </NativeSelect>
                  <Button variant="outline" onClick={saveCategory}>Kategoriyi doğrula</Button>
                </div>
              </Block>
              <p className="border-t pt-4 text-xs text-muted-foreground">Kaydedilme: {formatDate(r.capturedAt)} · Arşiv güncellemesi: {formatDate(r.updatedAt)}</p>
            </div>
          </SheetContent>
        );
      })()}
    </Dialog>
  );
}
