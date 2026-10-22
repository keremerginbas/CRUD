import * as React from 'react';
import {Link2, ListOrdered, Pause, Play, Square, Save, Rocket, CircleCheck, CircleAlert, ScrollText} from 'lucide-react';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Input, Label, NativeSelect, Textarea, Hint} from '@/components/ui/input';
import {Switch} from '@/components/ui/switch';
import {Tabs, TabsList, TabsTab} from '@/components/ui/tabs';
import {Progress} from '@/components/ui/progress';
import {toast} from '@/components/ui/toast';
import {PageHeader, SourceBadge} from '@/components/common';
import {CATEGORY_LABELS, Sites, formatDate, num, runtime} from '@/lib/ext';
import {refresh, setJob, setSearches, syncSearches, useStore, type Job} from '@/lib/store';
import {chooseList, setFilters} from '@/lib/ui';
import {SafetySettings} from './settings';
import {cn} from '@/lib/utils';

const JOB_STATES: Record<string, string> = {idle: 'Hazır', starting: 'Başlatılıyor', running: 'Tarama sürüyor', collecting: 'Bağlantılar toplanıyor', paused: 'Tarama duraklatıldı', blocked: 'Tarayıcıda kontrol bekleniyor', stopping: 'Durduruluyor', stopped: 'Tarama durduruldu', completed: 'Tarama tamamlandı', incomplete: 'Tarama kısmen tamamlandı', done: 'Tarama tamamlandı', error: 'Tarama hatası'};
const ATTENTION: Record<string, string> = {
  blocked: 'Tarama doğrulama veya giriş bekliyor. Tarama penceresini kontrol ettikten sonra Devam et seçeneğini kullanın. Bu durum ilanların silindiği anlamına gelmez.',
  paused: 'Tarama duraklatıldı. Kaydedilen ilanlar ve kalan sıra korunuyor.',
  stopped: 'Tarama durduruldu. Arşiv kayıtları korunuyor; kalan sıraya devam edebilirsiniz.',
  incomplete: 'Tüm sonuçların tarandığı doğrulanamadı. Son hareketleri kontrol edin; bu tarama tam olarak işaretlenmedi.',
  error: 'Tarama tamamlanamadı. Son hareketlerde hata ayrıntısını inceleyin.',
};
const ACTIVE = ['starting', 'running', 'collecting', 'stopping'];

export function collectUrl(value: string) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    const site = Sites().forHost(url.hostname);
    if (!site || url.hostname.toLowerCase().replace(/^(?:www|m)\./, '') !== site.domain) return null;
    return {source: site.id, isListing: Boolean(Sites().listingId(url.href)), url: url.href};
  } catch { return null; }
}

function validate(mode: 'search' | 'links', raw: string) {
  const direct = mode === 'links', urls = [...new Set(raw.split(/\r?\n/).map(v => v.trim()).filter(Boolean))];
  if (!urls.length) return {valid: false, empty: true, label: 'Bağlantı ekleyin', message: '', source: ''};
  const parsed = urls.map(collectUrl), invalid = parsed.findIndex(v => !v);
  if (invalid !== -1) return {valid: false, label: 'Bağlantıyı kontrol edin', message: `${direct ? `${invalid + 1}. bağlantı: ` : ''}Desteklenen bir site adresi girin: ${Sites().namesText()}.`, source: ''};
  if (!direct && (urls.length !== 1 || parsed[0]!.isListing)) return {valid: false, label: 'Arama bağlantısı gerekli', message: 'Bu alan sonuç listesinin adresi içindir. Tek ilan için İlan bağlantıları sekmesini seçin.', source: ''};
  if (direct && parsed.some(v => !v!.isListing)) return {valid: false, label: 'İlan bağlantısı gerekli', message: 'Her satıra bir ilan detay bağlantısı girin. Sonuç listesi için Arama bağlantısı sekmesini seçin.', source: ''};
  if (new Set(parsed.map(v => v!.source)).size > 1) return {valid: false, label: 'Kaynaklar farklı', message: 'Farklı sitelerin bağlantılarını ayrı taramalarda ekleyin.', source: ''};
  return {valid: true, urls, label: `${Sites().name(parsed[0]!.source)} · Tarama hazır`, message: direct ? `${urls.length.toLocaleString('tr-TR')} tekil ilan bağlantısı hazır.` : 'Bağlantı biçimi geçerli. Tarama başlatıldığında sayfaya erişim kontrol edilir.', source: parsed[0]!.source};
}

function JobPanel({job, busy, onAction}: {job: Job; busy: boolean; onAction: (type: string) => void}) {
  const status = job.status || 'idle', active = ACTIVE.includes(status), counts = job.counts || {}, p = job.pageProgress;
  const determinate = p && p.stage !== 'list' && Number(p.pageFound) > 0 && Number.isFinite(Number(p.pageProcessed));
  const percent = determinate ? Math.max(0, Math.min(100, Math.round(Number(p!.pageProcessed) / Number(p!.pageFound) * 100))) : null;
  const queued = Array.isArray(job.listingQueue) ? Math.max(0, job.listingQueue.length - Number(job.detailIndex || 0)) : 0;
  const finite = (v: unknown) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  const tiles: [string, unknown, string?][] = [['Bulunan', counts.discovered], ['İşlenen', counts.processed], ['Kaydedilen', counts.saved], ['Değişmeyen (atlandı)', counts.unchanged, 'Fiyatı ve bilgileri değişmediği için detay sayfası açılmadı'], ['Sırada', queued], ['Kategori dışı', counts.skipped], ['İnceleme', counts.review], ['Hata', counts.errors]];
  return (
    <Card data-testid="job-panel" data-status={status}>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', status === 'running' ? 'animate-pulse bg-success' : ['paused', 'blocked'].includes(status) ? 'bg-warning' : status === 'error' ? 'bg-destructive' : 'bg-muted-foreground/50')} />
          <div>
            <CardTitle className="flex items-center gap-2">{JOB_STATES[status] || 'Tarama durumu'}{job.source && <SourceBadge source={job.source} />}</CardTitle>
            <CardDescription className="mt-1 break-all">{job.message || job.currentUrl || ''}</CardDescription>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={busy || !active || status === 'stopping'} onClick={() => onAction('ILAN_PAUSE')}><Pause />Duraklat</Button>
          <Button size="sm" variant="outline" disabled={busy || !['paused', 'blocked', 'stopped'].includes(status)} onClick={() => onAction('ILAN_RESUME')} data-testid="job-resume"><Play />Devam et</Button>
          <Button size="sm" variant="outline" className="text-destructive" disabled={busy || !['starting', 'running', 'collecting', 'paused', 'blocked', 'error'].includes(status)} onClick={() => onAction('ILAN_STOP')}><Square />Durdur</Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {p && (
          <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium">{finite(p.currentPage) ? `Sayfa ${num(p.currentPage)}${finite(p.totalPages) && Number(p.totalPages) > 0 ? ' / ' + num(p.totalPages) : ' · toplam henüz bilinmiyor'}` : 'Sayfa bilgisi bekleniyor'}</span>
              <span className="text-muted-foreground">{finite(p.pageProcessed) && finite(p.pageFound) ? `Bu sayfada ${num(p.pageProcessed)} / ${num(p.pageFound)} ilan` : ''}{finite(p.totalProcessed) ? ` · Toplam ${num(p.totalProcessed)}${finite(p.totalExpected) && Number(p.totalExpected) > 0 ? ' / ' + num(p.totalExpected) : ''}` : ''}</span>
            </div>
            <Progress value={active ? percent : percent ?? 0} label="Geçerli sayfanın ilan işleme ilerlemesi" />
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {tiles.map(([label, value, title]) => (
            <div key={label} title={title} className="rounded-lg border px-3 py-2"><div className="text-lg font-semibold tabular-nums">{num(value)}</div><div className="text-xs text-muted-foreground">{label}</div></div>
          ))}
        </div>
        {job.waitingUntil && <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">Günlük güvenli limit doldu. Tarama {formatDate(job.waitingUntil)} itibarıyla kendiliğinden devam edecek.</p>}
        {ATTENTION[status] && <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">{ATTENTION[status]}</p>}
        <details className="group text-sm">
          <summary className="flex w-fit cursor-pointer items-center gap-2 text-muted-foreground hover:text-foreground"><ScrollText className="size-4" />Son hareketleri göster</summary>
          <ol className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
            {(job.logs || []).slice(-30).reverse().map((entry, i) => <li key={i}>{typeof entry === 'string' ? entry : `${entry.at ? formatDate(entry.at) + ' · ' : ''}${entry.message || ''}`}</li>)}
            {!(job.logs || []).length && <li>Henüz hareket yok.</li>}
          </ol>
        </details>
      </CardContent>
    </Card>
  );
}

export function Collect() {
  const job = useStore(s => s.job);
  const [mode, setMode] = React.useState<'search' | 'links'>('search');
  const [searchUrl, setSearchUrl] = React.useState('');
  const [directUrls, setDirectUrls] = React.useState('');
  const [category, setCategory] = React.useState('arsa');
  const [maxListings, setMaxListings] = React.useState('0');
  const [delay, setDelay] = React.useState('4');
  const [track, setTrack] = React.useState(true);
  const [trackName, setTrackName] = React.useState('');
  const [interval, setIntervalValue] = React.useState('60');
  const [revealPhone, setRevealPhone] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const check = validate(mode, mode === 'links' ? directUrls : searchUrl);
  const status = job?.status || 'idle';
  const jobBlocks = ['starting', 'running', 'collecting', 'stopping', 'paused', 'blocked'].includes(status);
  const lines = directUrls.split(/\r?\n/).map(v => v.trim()).filter(Boolean), unique = new Set(lines).size;

  // arabam.com only lists vehicles: a land-only target would skip every listing.
  React.useEffect(() => {
    if (!check.valid) return;
    const fixed = Sites().get(check.source)?.category;
    if (fixed && !['all', fixed].includes(category)) { setCategory(fixed); toast(`${Sites().name(check.source)} bağlantısı için toplanacak kategori “${CATEGORY_LABELS[fixed]}” yapıldı.`); }
  }, [check.valid, check.source]); // eslint-disable-line react-hooks/exhaustive-deps

  async function jobAction(type: string, config: Record<string, unknown> = {}) {
    if (busy) return; setBusy(true);
    try {
      const result = await runtime(type, config);
      if (result.job) setJob(result.job);
      const messages: Record<string, string> = {ILAN_START_LINKS: 'Eklenen ilan bağlantılarının taraması başlatıldı.', ILAN_START: 'Tarama başlatıldı.', ILAN_PAUSE: 'Duraklatma istendi.', ILAN_RESUME: 'Tarama devam ediyor.', ILAN_STOP: 'Durdurma istendi. Kaydedilen ilanlar korunur.'};
      toast(type === 'ILAN_CAPTURE_TAB' ? (result.skipped ? 'Hedef kategoriyle uyuşmadığı için ilan arşive eklenmedi.' : result.review ? 'İlan, kategori kontrolü için İnceleme gerekli alanına kaydedildi.' : 'İlan arşive kaydedildi.') : messages[type] || 'İşlem tamamlandı.');
      await refresh();
    } catch (error) { toast((error as Error).message, true); } finally { setBusy(false); }
  }
  const showList = (listId: string) => { if (listId) setFilters({list: listId}); };

  async function start(event: React.FormEvent) {
    event.preventDefault();
    if (!check.valid) { toast(check.message || 'Önce bir bağlantı ekleyin.', true); return; }
    const delaySeconds = Number(delay), max = Number(maxListings), minutes = Number(interval);
    if (!Number.isFinite(delaySeconds) || delaySeconds < 3) { toast('İlanlar arasındaki bekleme en az 3 saniye olmalı.', true); return; }
    if (mode === 'links') {
      const target = await chooseList('', ''); if (!target) return; showList(target.listId);
      await jobAction('ILAN_START_LINKS', {urls: lines, listId: target.listId, category, maxListings: 0, delayMs: delaySeconds * 1000, revealPhone});
      return;
    }
    if (!Number.isInteger(max) || max < 0) { toast('İlan sınırı 0 veya pozitif tam sayı olmalı.', true); return; }
    if (track && (!Number.isInteger(minutes) || minutes < 15)) { toast('Düzenli tarama aralığı en az 15 dakika olmalı.', true); return; }
    const target = await chooseList('', trackName.trim()); if (!target) return; showList(target.listId);
    const config = {listId: target.listId, searchUrl: searchUrl.trim(), category, maxListings: max, maxPages: 0, delayMs: delaySeconds * 1000, revealPhone};
    if (!track) { await jobAction('ILAN_START', config); return; }
    setBusy(true); let saved = false;
    try {
      const result = await runtime('ILAN_SEARCH_SAVE', {listId: config.listId, searchUrl: config.searchUrl, name: trackName.trim(), category, intervalMinutes: minutes, enabled: true, revealPhone, delayMs: config.delayMs});
      saved = true; if (Array.isArray(result.searches)) setSearches(result.searches);
      if (!result.search?.id) throw new Error('Kaydedilen aramanın kimliği alınamadı.');
      const run = await runtime('ILAN_SEARCH_RUN', {id: result.search.id, maxListings: max, maxPages: 0});
      if (run.job) setJob(run.job);
      toast('Arama düzenli takibe alındı ve tarama isteği iletildi.');
      await syncSearches();
    } catch (error) { toast(`${saved ? 'Arama kaydedildi; tarama başlatılamadı. ' : ''}${(error as Error).message}`, true); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Veri çekme" title="Yeni tarama" description={`${Sites().namesText()} arama sonuçlarından veya tek tek ilan bağlantılarından ilan toplayın.`} />
      {job && <JobPanel job={job} busy={busy} onAction={type => jobAction(type)} />}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <form onSubmit={start}>
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
            <Tabs value={mode} onValueChange={value => setMode(value as 'search' | 'links')}>
              <TabsList>
                <TabsTab value="search" data-testid="mode-search"><Link2 />Arama bağlantısı</TabsTab>
                <TabsTab value="links" data-testid="mode-links"><ListOrdered />İlan bağlantıları</TabsTab>
              </TabsList>
            </Tabs>
            <Badge variant={check.valid ? 'success' : check.empty ? 'muted' : 'warning'} data-testid="collect-ready">{check.valid ? <CircleCheck /> : check.empty ? null : <CircleAlert />}{check.label}</Badge>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {mode === 'search' ? (
              <Label>Arama sonuçları sayfasının adresi
                <Input type="url" value={searchUrl} onChange={e => setSearchUrl(e.target.value)} placeholder="https://www.emlakjet.com/satilik-arsa/ankara" autoComplete="off" aria-invalid={!check.valid && !check.empty} data-testid="search-url" />
                <Hint>Sitede filtrelerinizi seçin; ilan listesinin adres çubuğundaki bağlantıyı buraya yapıştırın.</Hint>
              </Label>
            ) : (
              <Label>İlan detay bağlantıları (her satıra bir tane)
                <Textarea value={directUrls} onChange={e => setDirectUrls(e.target.value)} rows={6} placeholder={'https://www.sahibinden.com/ilan/…/detay\nhttps://www.arabam.com/ilan/…/44985286'} aria-invalid={!check.valid && !check.empty} data-testid="direct-urls" />
                <Hint>{unique.toLocaleString('tr-TR')} bağlantı{lines.length !== unique ? ' · yinelenen satırlar birleştirilir' : ''}</Hint>
              </Label>
            )}
            {check.message && <p className={cn('text-sm', check.valid ? 'text-muted-foreground' : 'text-destructive')} data-testid="collect-message">{check.message}</p>}
            <div className="grid gap-4 sm:grid-cols-3">
              <Label>Toplanacak kategori
                <NativeSelect value={category} onChange={e => setCategory(e.target.value)} data-testid="collect-category">
                  <option value="arsa">Arsa</option><option value="all">Tüm kategoriler</option><option value="arac">Araç</option><option value="konut">Konut</option><option value="isyeri">İşyeri</option><option value="diger">Diğer</option>
                </NativeSelect>
              </Label>
              {mode === 'search' && <Label>En fazla ilan<Input type="number" min={0} step={1} value={maxListings} onChange={e => setMaxListings(e.target.value)} /><Hint>0 = sınır yok</Hint></Label>}
              <Label>Bekleme (saniye)<Input type="number" min={3} max={3600} value={delay} onChange={e => setDelay(e.target.value)} /><Hint>İlanlar arasında, en az 3</Hint></Label>
            </div>
            {mode === 'search' && (
              <div className="flex flex-col gap-3 rounded-lg border p-4">
                <label className="flex cursor-pointer items-center justify-between gap-3">
                  <span><span className="text-sm font-medium">Bu aramayı düzenli takip et</span><span className="block text-xs text-muted-foreground">İlan sınırı yalnız bu deneme turuna uygulanır; düzenli tarama tüm sayfaları kapsar.</span></span>
                  <Switch checked={track} onCheckedChange={setTrack} label="Bu aramayı düzenli takip et" />
                </label>
                {track && (
                  <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
                    <Label>Arama adı<Input value={trackName} maxLength={120} onChange={e => setTrackName(e.target.value)} placeholder="Örn. Ankara arsa takibi" /></Label>
                    <Label>Tarama aralığı (dakika)<Input type="number" min={15} max={43200} value={interval} onChange={e => setIntervalValue(e.target.value)} /><Hint>Chrome açıkken, en az 15</Hint></Label>
                  </div>
                )}
              </div>
            )}
            <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              <label className="flex cursor-pointer items-center gap-2 text-sm"><Switch checked={revealPhone} onCheckedChange={setRevealPhone} label="Telefonu Göster düğmesine bas" />“Telefonu Göster” düğmesine bas</label>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={busy || ACTIVE.includes(status)} onClick={() => jobAction('ILAN_CAPTURE_TAB', {category, revealPhone, listId: ''})} title="Başka bir sekmede açık olan son etkin ilan sayfasını kaydeder"><Save />Açık ilandan kaydet</Button>
                <Button type="submit" disabled={busy || !check.valid || jobBlocks} data-testid="start-collect"><Rocket />{mode === 'links' ? 'İlanları getir' : 'Taramayı başlat'}</Button>
              </div>
            </div>
          </CardContent>
        </Card>
        </form>
        <SafetySettings compact />
      </div>
    </div>
  );
}
