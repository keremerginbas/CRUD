import * as React from 'react';
import {Play, Power, Trash2, ExternalLink, Plus, BookmarkX} from 'lucide-react';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Input, Label, NativeSelect, Hint} from '@/components/ui/input';
import {Switch} from '@/components/ui/switch';
import {toast} from '@/components/ui/toast';
import {confirmDialog} from '@/components/ui/confirm';
import {EmptyState, PageHeader, SourceBadge} from '@/components/common';
import {CATEGORY_LABELS, Sites, formatDate, safeUrl, runtime, type Category} from '@/lib/ext';
import {listName, setJob, setSearches, syncSearches, useStore, type SavedSearch} from '@/lib/store';
import {chooseList, setFilters} from '@/lib/ui';
import {collectUrl} from './collect';
import {cn} from '@/lib/utils';

const STATUS: Record<string, string> = {idle: 'Hazır', running: 'Taranıyor', queued: 'Tarama sırada', starting: 'Başlatılıyor', completed: 'Tarama tamamlandı', done: 'Tarama tamamlandı', incomplete: 'Tarama kısmi kaldı', error: 'Tarama hatası', blocked: 'Tarayıcıda kontrol bekleniyor', paused: 'Duraklatıldı', waiting: 'Sonraki tur bekleniyor', stopped: 'Durduruldu', interrupted: 'Yarıda kaldı'};

export function Searches() {
  const searches = useStore(s => s.searches);
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({url: '', name: '', category: 'all', interval: '60', enabled: true});
  const [open, setOpen] = React.useState(false);

  async function action(type: string, config: Record<string, unknown>, success: string) {
    if (busy) return null; setBusy(true);
    try {
      const result = await runtime(type, config);
      if (Array.isArray(result.searches)) setSearches(result.searches);
      if (result.job) setJob(result.job);
      toast(result.message || success); await syncSearches(); return result;
    } catch (error) { toast((error as Error).message, true); return null; } finally { setBusy(false); }
  }
  async function run(search: SavedSearch) {
    const target = await chooseList(search.listId || '', search.name);
    if (!target) return;
    if (target.listId) setFilters({list: target.listId});
    await action('ILAN_SEARCH_RUN', {id: search.id, listId: target.listId}, 'Arama için tarama isteği alındı.');
  }
  async function remove(search: SavedSearch) {
    if (!await confirmDialog({title: `“${search.name}” takipten çıkarılsın mı?`, description: 'Yalnızca düzenli takip kaldırılır; arşiv ve hareket kayıtları korunur.', confirmLabel: 'Takipten çıkar', destructive: true})) return;
    await action('ILAN_SEARCH_REMOVE', {id: search.id}, 'Arama takipten çıkarıldı. Arşiv ve hareket kayıtları korundu.');
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const interval = Number(form.interval);
    if (!Number.isInteger(interval) || interval < 15) { toast('Tarama aralığı en az 15 dakika olmalı.', true); return; }
    const result = await action('ILAN_SEARCH_SAVE', {searchUrl: form.url.trim(), name: form.name.trim(), category: form.category, intervalMinutes: interval, enabled: form.enabled, revealPhone: true, delayMs: 4000}, 'Arama düzenli takibe kaydedildi.');
    if (result) { setOpen(false); setForm({url: '', name: '', category: 'all', interval: '60', enabled: true}); }
  }
  const onUrl = (url: string) => {
    const parsed = collectUrl(url.trim()), fixed = parsed ? Sites().get(parsed.source)?.category : undefined;
    setForm(f => ({...f, url, category: fixed && !['all', fixed].includes(f.category) ? fixed : f.category}));
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Düzenli tarama" title="Kayıtlı aramalar" description="Bu aramalar belirlediğiniz aralıklarla, sırayla taranır. Chrome açık olmalıdır."
        actions={<Button onClick={() => setOpen(v => !v)} aria-expanded={open}><Plus />İzlenecek arama ekle</Button>} />
      {open && (
        <Card>
          <CardHeader><CardTitle>Yeni kayıtlı arama</CardTitle><CardDescription>İlk eksiksiz tarama başlangıç kaydını oluşturur; sonraki turlarda yeni ilanlar ve fiyat değişimleri işaretlenir.</CardDescription></CardHeader>
          <CardContent>
            <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
              <Label className="md:col-span-2">Arama sonuçları bağlantısı<Input type="url" required value={form.url} onChange={e => onUrl(e.target.value)} placeholder="https://www.sahibinden.com/…" data-testid="saved-url" /></Label>
              <Label>Arama adı<Input value={form.name} maxLength={120} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="Örn. Ankara müstakil arsalar" /></Label>
              <Label>Toplanacak kategori<NativeSelect value={form.category} onChange={e => setForm(f => ({...f, category: e.target.value}))} data-testid="saved-category">
                <option value="all">Tüm kategoriler</option>{(['arsa', 'arac', 'konut', 'isyeri', 'diger'] as Category[]).map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
              </NativeSelect></Label>
              <Label>Tarama aralığı (dakika)<Input type="number" min={15} max={43200} value={form.interval} onChange={e => setForm(f => ({...f, interval: e.target.value}))} /><Hint>En az 15 dakika</Hint></Label>
              <label className="flex items-center gap-3 self-end pb-2 text-sm"><Switch checked={form.enabled} onCheckedChange={v => setForm(f => ({...f, enabled: v}))} label="Düzenli takip açık" />Düzenli takip açık</label>
              <div className="flex gap-2 md:col-span-2"><Button type="submit" disabled={busy}>Aramayı kaydet</Button><Button variant="ghost" onClick={() => setOpen(false)}>Vazgeç</Button></div>
            </form>
          </CardContent>
        </Card>
      )}
      {searches.length ? (
        <div className="grid gap-4 lg:grid-cols-2" data-testid="search-list">
          {searches.map(search => {
            const source = Sites().sourceFor(search.searchUrl), url = safeUrl(search.searchUrl), failed = ['error', 'blocked', 'incomplete'].includes(search.lastStatus || '');
            return (
              <Card key={search.id} data-search={search.id}>
                <CardHeader className="flex-row items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="flex items-center gap-2"><span className={cn('size-2 shrink-0 rounded-full', search.enabled ? 'bg-success' : 'bg-muted-foreground/40')} /><span className="truncate">{search.name || 'İzlenen arama'}</span></CardTitle>
                    <CardDescription className="mt-1 flex flex-wrap items-center gap-2">{source && <SourceBadge source={source} />}{search.category === 'all' ? 'Tüm kategoriler' : CATEGORY_LABELS[search.category as Category] || 'Diğer'} · {search.intervalMinutes} dakikada bir</CardDescription>
                  </div>
                  <Badge variant={failed ? 'danger' : search.enabled ? 'success' : 'muted'}>{STATUS[search.lastStatus || ''] || 'İlk tarama bekleniyor'}</Badge>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-sm">
                  {search.lastMessage && <p className="text-muted-foreground">{search.lastMessage}</p>}
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <span>Son tarama: {formatDate(search.lastRunAt)}</span><span>Sonraki: {search.enabled ? formatDate(search.nextRunAt) : 'Takip kapalı'}</span>
                    <span>{search.hasBaseline ? 'Başlangıç kaydı oluşturuldu.' : 'İlk eksiksiz taramada başlangıç kaydı oluşturulacak.'}</span>
                    {search.listId && <span>Kaydedildiği liste: {listName(search.listId)}</span>}
                  </div>
                  <div className="flex flex-wrap gap-2 border-t pt-3">
                    <Button size="sm" disabled={busy} onClick={() => run(search)} data-testid="search-run"><Play />Şimdi tara</Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => action('ILAN_SEARCH_TOGGLE', {id: search.id, enabled: !search.enabled}, search.enabled ? 'Düzenli takip kapatıldı.' : 'Düzenli takip açıldı.')}><Power />{search.enabled ? 'Takibi durdur' : 'Takibi aç'}</Button>
                    <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => remove(search)}><Trash2 />Takipten çıkar</Button>
                    {url && <a href={url} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline">Arama sayfası<ExternalLink className="size-3" /></a>}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card><EmptyState icon={<BookmarkX />} title="Henüz kayıtlı arama yok" description="Veri çek ekranında “Bu aramayı düzenli takip et” seçeneğiyle veya yukarıdaki düğmeyle arama ekleyin." /></Card>
      )}
    </div>
  );
}
