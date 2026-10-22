import * as React from 'react';
import {RefreshCw, Pause, Play, Send, ShieldCheck, RotateCcw, BellRing, Sunrise} from 'lucide-react';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Input, Label, Hint} from '@/components/ui/input';
import {Switch, SwitchField} from '@/components/ui/switch';
import {toast} from '@/components/ui/toast';
import {PageHeader} from '@/components/common';
import {formatDate, num, runtime} from '@/lib/ext';
import {applySafetyResult, refresh, setMonitor, setTelegram, syncMonitoring, useStore} from '@/lib/store';

const MONITOR_STATES: Record<string, string> = {idle: 'Kontrol için hazır', running: 'Arşiv kontrol ediliyor', waiting: 'Sonraki kontrol bekleniyor', waiting_crawler: 'İlan taramasının bitmesi bekleniyor', blocked: 'Tarayıcıda erişim kontrolü bekleniyor', paused: 'Kontroller duraklatıldı'};

function MonitorCard() {
  const monitor = useStore(s => s.monitor);
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({enabled: true, interval: '360', confirmation: '15'});
  const [dirty, setDirty] = React.useState(false);
  React.useEffect(() => { if (monitor && !dirty) setForm({enabled: monitor.enabled !== false, interval: String(monitor.intervalMinutes ?? 360), confirmation: String(monitor.confirmationMinutes ?? 15)}); }, [monitor, dirty]);
  const status = monitor?.status || monitor?.phase || 'idle', enabled = monitor?.enabled !== false;
  async function action(type: string, config: Record<string, unknown> = {}, success = 'İşlem tamamlandı.') {
    if (busy) return; setBusy(true);
    try { const r = await runtime(type, config); if (type === 'ILAN_MONITOR_CONFIG') setDirty(false); if (r.monitor) setMonitor(r.monitor); toast(success); await refresh(); }
    catch (error) { toast((error as Error).message, true); } finally { setBusy(false); }
  }
  function save(e: React.FormEvent) {
    e.preventDefault();
    const interval = Number(form.interval), confirmation = Number(form.confirmation);
    if (!Number.isInteger(interval) || interval < 15 || !Number.isInteger(confirmation) || confirmation < 10) { toast('Kontrol aralığı en az 15, doğrulama aralığı en az 10 dakika olmalı.', true); return; }
    action('ILAN_MONITOR_CONFIG', {enabled: form.enabled, intervalMinutes: interval, confirmationMinutes: confirmation}, 'Kontrol ayarları kaydedildi.');
  }
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div><CardTitle>Otomatik ilan kontrolü</CardTitle><CardDescription>Sahibinden ve Hepsiemlak bağlantıları düzenli kontrol edilir; kaldırılma iki ayrı kontrolle doğrulanır.</CardDescription></div>
        <Badge variant={!enabled || ['paused', 'blocked'].includes(status) ? 'warning' : 'success'}>{!enabled ? 'Otomatik kontrol kapalı' : status === 'paused' ? 'Duraklatıldı' : status === 'blocked' ? 'Kontrol bekleniyor' : 'Otomatik takip açık'}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="rounded-lg bg-muted/50 p-3 text-sm">
          <div className="font-medium">{MONITOR_STATES[status] || 'Durum kontrol ediliyor'}</div>
          {monitor?.message && <p className="mt-1 text-muted-foreground">{monitor.message}</p>}
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground"><span>Son kontrol: {formatDate(monitor?.lastRun)}</span><span>Sonraki: {enabled ? formatDate(monitor?.nextDue) : 'Otomatik kontrol kapalı'}</span></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => action('ILAN_MONITOR_RUN', {}, 'Kontrol isteği sıraya alındı; ilan taraması sürüyorsa tamamlanınca başlayacak.')} disabled={busy || status === 'running'}><RefreshCw />Şimdi kontrol et</Button>
          <Button size="sm" variant="outline" onClick={() => action('ILAN_MONITOR_PAUSE', {}, 'Arşiv kontrolleri duraklatıldı.')} disabled={busy || !enabled || status === 'paused'}><Pause />Duraklat</Button>
          <Button size="sm" variant="outline" onClick={() => action('ILAN_MONITOR_RESUME', {}, 'Arşiv kontrolleri devam ediyor.')} disabled={busy || (enabled && !['paused', 'blocked'].includes(status))}><Play />Devam et</Button>
        </div>
        <form onSubmit={save} onInput={() => setDirty(true)} className="flex flex-col gap-3 border-t pt-4">
          <SwitchField label="Arşivdeki ilanları düzenli kontrol et" checked={form.enabled} onCheckedChange={v => { setDirty(true); setForm(f => ({...f, enabled: v})); }} />
          <div className="grid grid-cols-2 gap-3">
            <Label>Kontrol aralığı (dakika)<Input type="number" min={15} value={form.interval} onChange={e => setForm(f => ({...f, interval: e.target.value}))} /><Hint>En az 15</Hint></Label>
            <Label>Kaldırılma doğrulaması (dakika)<Input type="number" min={10} value={form.confirmation} onChange={e => setForm(f => ({...f, confirmation: e.target.value}))} /><Hint>İkinci kontrol için en az 10</Hint></Label>
          </div>
          <div><Button type="submit" variant="outline" disabled={busy}>Kontrol ayarlarını kaydet</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}

function TelegramCard() {
  const telegram = useStore(s => s.telegram);
  const [busy, setBusy] = React.useState(false);
  const [token, setToken] = React.useState('');
  const [chatId, setChatId] = React.useState('');
  const [dirty, setDirty] = React.useState(false);
  const [retryUncertain, setRetryUncertain] = React.useState(false);
  React.useEffect(() => { if (!dirty) setChatId(telegram?.chatId || '-5103130278'); }, [telegram?.chatId, dirty]);
  const counts = telegram?.counts || {};
  async function action(type: string, config: Record<string, unknown> = {}, success = 'İşlem tamamlandı.') {
    if (busy) return; setBusy(true);
    try { const r = await runtime(type, config); if (type === 'ILAN_TELEGRAM_CONFIG') { setDirty(false); setToken(''); } if (r.telegram) setTelegram(r.telegram); toast(r.message || success); await syncMonitoring(); }
    catch (error) { toast((error as Error).message, true); } finally { setBusy(false); }
  }
  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!chatId.trim()) { toast('Telegram grup kimliğini girin.', true); return; }
    action('ILAN_TELEGRAM_CONFIG', {chatId: chatId.trim(), ...(token.trim() ? {token: token.trim()} : {})}, 'Telegram ayarları kaydedildi.');
  }
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div><CardTitle>Telegram grup bildirimleri</CardTitle><CardDescription>{[telegram?.chatTitle, telegram?.botUsername ? '@' + telegram.botUsername.replace(/^@/, '') : '', telegram?.chatId].filter(Boolean).join(' · ') || 'Grup ve bot bilgileri doğrulamayla gösterilir.'}</CardDescription></div>
        <Badge variant={telegram?.verified ? 'success' : 'warning'}>{telegram?.verified ? 'Bağlantı doğrulandı' : telegram?.configured ? 'Doğrulama gerekli' : 'Bot ayarlanmamış'}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {telegram?.lastError && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{telegram.lastError}</p>}
        <form onSubmit={save} className="flex flex-col gap-3">
          <Label>Bot tokeni<Input type="password" value={token} onChange={e => { setToken(e.target.value); setDirty(true); }} placeholder="Yeni token girin veya kayıtlı olanı korumak için boş bırakın" autoComplete="off" spellCheck={false} />
            <Hint>{telegram?.configured ? 'Bir bot tokeni kayıtlı. Değiştirmeyecekseniz bu alanı boş bırakın.' : 'Bot tokeni henüz kaydedilmemiş.'}</Hint></Label>
          <Label>Grup kimliği<Input value={chatId} onChange={e => { setChatId(e.target.value); setDirty(true); }} placeholder="-100…" autoComplete="off" spellCheck={false} /></Label>
          <div><Button type="submit" variant="outline" disabled={busy}>Telegram ayarlarını kaydet</Button></div>
        </form>
        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button size="sm" variant="outline" onClick={() => action('ILAN_TELEGRAM_VERIFY', {}, 'Bot ve grup bağlantısı doğrulandı.')} disabled={busy || !telegram?.configured || dirty}><ShieldCheck />Bağlantıyı doğrula</Button>
          <Button size="sm" variant="outline" onClick={() => action('ILAN_TELEGRAM_TEST', {}, 'Test mesajı gönderme işlemi tamamlandı.')} disabled={busy || !telegram?.verified || dirty}><Send />Test mesajı gönder</Button>
        </div>
        <div className="grid grid-cols-4 gap-2 text-center">
          {[['Bekleyen', (counts.queued || 0) + (counts.sending || 0)], ['Gönderilen', counts.sent], ['Hatalı', counts.failed], ['Belirsiz', counts.uncertain]].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg bg-muted/50 py-2"><div className="font-semibold tabular-nums">{num(value)}</div><div className="text-xs text-muted-foreground">{label}</div></div>
          ))}
        </div>
        {Boolean(counts.uncertain) && <label className="flex items-center gap-3 text-sm"><Switch checked={retryUncertain} onCheckedChange={setRetryUncertain} label="Teslimi belirsiz mesajları da yeniden gönder" />Teslimi belirsiz mesajları da yeniden gönder (tekrar bildirim oluşabilir)</label>}
        <div><Button size="sm" variant="ghost" onClick={() => action('ILAN_TELEGRAM_RETRY', {includeUncertain: retryUncertain}, 'Seçilen bildirimler yeniden gönderim için işlendi.')} disabled={busy || !telegram?.verified || dirty || !(counts.failed || (counts.uncertain && retryUncertain))}><RotateCcw />{retryUncertain ? 'Hatalı ve belirsiz gönderimleri tekrar dene' : 'Hatalı gönderimleri tekrar dene'}</Button></div>
      </CardContent>
    </Card>
  );
}

function AlertsCard() {
  const safety = useStore(s => s.safety);
  const a = safety?.alerts || {};
  const [minDrop, setMinDrop] = React.useState('5');
  const [time, setTime] = React.useState('08:30');
  React.useEffect(() => { setMinDrop(String(a.minDropPercent ?? 5)); setTime(a.summaryTime || '08:30'); }, [a.minDropPercent, a.summaryTime]);
  async function save(patch: Record<string, unknown>) {
    try { applySafetyResult(await runtime('ILAN_ALERTS_CONFIG', {alerts: {...a, ...patch}})); toast('Bildirim ayarları kaydedildi.'); } catch (error) { toast((error as Error).message, true); }
  }
  function savePercent() {
    const n = Number(minDrop);
    if (!Number.isFinite(n) || n < 0 || n > 90) { toast('Fiyat düşüş eşiği 0–90 arasında olmalı.', true); return; }
    if (n !== a.minDropPercent) save({minDropPercent: n});
  }
  async function summaryNow() {
    try { await runtime('ILAN_ALERTS_SUMMARY_NOW'); toast('Günlük özet Telegram kuyruğuna alındı. Telegram bağlantısı doğrulanmamışsa gönderilmez.'); } catch (error) { toast((error as Error).message, true); }
  }
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><BellRing className="size-4 text-primary" />Ek bildirimler</CardTitle><CardDescription>Yayından kaldırılan ilanlara ek olarak gönderilecek Telegram mesajları.</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-2">
        <SwitchField label="Fiyatı düşen ilanlar" checked={a.priceDrop !== false} onCheckedChange={v => save({priceDrop: v})} />
        <Label className="ml-0 max-w-48">En az düşüş (%)<Input type="number" min={0} max={90} step={0.5} value={minDrop} onChange={e => setMinDrop(e.target.value)} onBlur={savePercent} /></Label>
        <SwitchField label="Takipteki aramalarda yeni ilan" checked={a.newListing !== false} onCheckedChange={v => save({newListing: v})} />
        <SwitchField label="“Site sayfa yapısı değişmiş olabilir” uyarısı" description="Art arda eksik alan okunursa bir kez uyarır." checked={a.health !== false} onCheckedChange={v => save({health: v})} />
        <div className="mt-2 flex flex-col gap-3 border-t pt-3">
          <SwitchField label="Her sabah günlük özet" description="Yeni ilan, fiyat düşüşü, kaldırılan, fırsat ve görüşülecekler tek mesajda." checked={a.summary !== false} onCheckedChange={v => save({summary: v})} />
          <div className="flex flex-wrap items-end gap-3">
            <Label className="w-32">Özet saati<Input type="time" value={time} onChange={e => setTime(e.target.value)} onBlur={() => time !== a.summaryTime && save({summaryTime: time || '08:30'})} /></Label>
            <Button size="sm" variant="outline" onClick={summaryNow}><Sunrise />Özeti şimdi gönder</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function Monitor() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Arşiv takibi" title="Takip ve Telegram" description="İlanların yayında olup olmadığını kontrol edin ve Telegram bildirimlerini yönetin." />
      <div className="grid items-start gap-6 xl:grid-cols-3"><MonitorCard /><TelegramCard /><AlertsCard /></div>
    </div>
  );
}
