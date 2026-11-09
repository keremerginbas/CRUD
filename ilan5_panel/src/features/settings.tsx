import * as React from 'react';
import {Upload, Download, ShieldCheck, HardDriveDownload, PanelsTopLeft, Info} from 'lucide-react';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Button, buttonVariants} from '@/components/ui/button';
import {Input, Label, Hint} from '@/components/ui/input';
import {SwitchField} from '@/components/ui/switch';
import {toast} from '@/components/ui/toast';
import {confirmDialog} from '@/components/ui/confirm';
import {PageHeader} from '@/components/common';
import {formatDate, num, runtime, Sites} from '@/lib/ext';
import {applySafetyResult, importArchive, runBackup, setAutoBackup, useStore} from '@/lib/store';

export function ImportButton({icon = <Upload />}: {icon?: React.ReactNode}) {
  const input = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  async function onFile(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      await importArchive(file, () => confirmDialog({
        title: 'Bu yedekte kayıtlı aramalar ve ayarlar da var. Bu bilgisayara aktarılsın mı?',
        description: 'Kayıtlı aramalar takibi kapalı olarak gelir; Kayıtlı aramalar ekranından “Takibi aç” ile başlatırsınız. Telegram tokeni yedekte yoktur, bir kez panelden girmeniz gerekir.',
        confirmLabel: 'Ayarları da aktar',
      }));
    } catch (error) { toast(`Dosya içe aktarılamadı: ${(error as Error).message}`, true); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  }
  return (
    <>
      <input ref={input} type="file" accept=".json,.xlsx,.csv" hidden onChange={e => onFile(e.target.files?.[0])} data-testid="import-file" />
      <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>{icon}İçe aktar</Button>
    </>
  );
}

/** Account-protection settings: separate window, page and phone-button budgets, skip unchanged. */
export function SafetySettings({compact = false}: {compact?: boolean}) {
  const safety = useStore(s => s.safety);
  const s = safety?.safety || {};
  const [daily, setDaily] = React.useState('');
  const [phone, setPhone] = React.useState('');
  React.useEffect(() => { setDaily(String(s.dailyLimit ?? 400)); setPhone(String(s.phoneDailyLimit ?? 150)); }, [s.dailyLimit, s.phoneDailyLimit]);
  async function save(patch: Record<string, unknown>) {
    try { applySafetyResult(await runtime('ILAN_SAFETY_CONFIG', {safety: {...s, ...patch}})); toast('Güvenli tarama ayarı kaydedildi.'); }
    catch (error) { toast((error as Error).message, true); }
  }
  function saveLimit(key: 'dailyLimit' | 'phoneDailyLimit', value: string) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) { toast('Günlük limitler 0 veya pozitif tam sayı olmalı.', true); return; }
    if (n !== Number(s[key])) save({[key]: n});
  }
  return (
    <Card data-testid="safety-settings">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4 text-primary" />Hesabınızı koruyan tarama</CardTitle>
        <CardDescription>Eklenti sitelerin doğrulama ekranını aşmaya çalışmaz; ekran çıkarsa durur ve sizi bekler. Limitler hesabınıza aşırı trafik yüklenmesini önler.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <SwitchField label="Ayrı, küçültülmüş pencerede tara" description={compact ? undefined : 'Normal tarayıcınızda sekme görmezsiniz. Sayfalar geç yüklenirse kapatın.'} checked={s.separateWindow !== false} onCheckedChange={v => save({separateWindow: v})} />
        <SwitchField label="Değişmeyen ilanlara tekrar girme" description={compact ? undefined : 'Fiyatı aynı, bu aramada görülmüş ve son 7 günde okunmuş ilanın detayı açılmaz.'} checked={s.skipKnown !== false} onCheckedChange={v => save({skipKnown: v})} />
        <SwitchField label="Kayıtlı telefonu yeniden kullan" description={compact ? undefined : 'Telefonu arşivde olan ilanda “Telefonu Göster”e basılmaz.'} checked={s.reuseKnownPhone !== false} onCheckedChange={v => save({reuseKnownPhone: v})} />
        <div className="grid grid-cols-2 gap-3 border-t pt-3">
          <Label>Günlük ilan limiti<Input type="number" min={0} value={daily} onChange={e => setDaily(e.target.value)} onBlur={() => saveLimit('dailyLimit', daily)} onKeyDown={e => { if (e.key === 'Enter') saveLimit('dailyLimit', daily); }} data-testid="safety-daily" /></Label>
          <Label>Telefon limiti / site<Input type="number" min={0} value={phone} onChange={e => setPhone(e.target.value)} onBlur={() => saveLimit('phoneDailyLimit', phone)} onKeyDown={e => { if (e.key === 'Enter') saveLimit('phoneDailyLimit', phone); }} data-testid="safety-phone" /></Label>
        </div>
        <Hint>Bugün {num(safety?.todayCount)}{s.dailyLimit ? ` / ${num(s.dailyLimit)}` : ''} ilan açıldı · 0 = sınırsız. Telefon limiti dolunca ilanlar o gün telefonsuz kaydedilir.</Hint>
      </CardContent>
    </Card>
  );
}

export function SettingsView() {
  const backup = useStore(s => s.backup);
  const version = useStore(s => s.version);
  const records = useStore(s => s.records);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Ayarlar" title="Ayarlar ve yedek" description="Tarama güvenliği, yedekleme ve taşıma." />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <SafetySettings />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><HardDriveDownload className="size-4 text-primary" />Yedek ve taşıma</CardTitle>
            <CardDescription>JSON yedeği ilanları, listeleri, notları, fiyat hareketlerini, kayıtlı aramaları ve ayarları içerir. Telegram tokeni yedeğe yazılmaz.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => runBackup(false).catch(error => toast(error.message, true))} disabled={!records.length} data-testid="backup-now"><Download />JSON yedeği indir</Button>
              <ImportButton />
            </div>
            <SwitchField label="Haftalık otomatik yedek" description="Panel açıldığında, son yedekten 7 gün geçtiyse yedek İndirilenler klasörüne iner." checked={backup.auto}
              onCheckedChange={v => setAutoBackup(v).then(() => toast(v ? 'Haftalık otomatik yedek açık.' : 'Otomatik yedek kapatıldı.'))} />
            <p className="text-sm text-muted-foreground" data-testid="last-backup">{backup.lastAt ? `Son yedek: ${formatDate(backup.lastAt)}` : 'Henüz yedek alınmadı.'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Info className="size-4 text-primary" />Hakkında</CardTitle>
            <CardDescription>{version ? `İlan5 sürüm ${version}` : 'Sürüm bilinmiyor'} · Desteklenen siteler: {Sites().namesText()}.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
            <p>Kayıtlar bu Chrome profilinde saklanır. Eklentiyi kaldırmayın; kaldırırsanız Chrome arşivi siler. Güncellerken dosyaları aynı klasörün üzerine kopyalayıp Yenile'ye basın.</p>
            <a href="../archive.html" className={buttonVariants({variant: 'outline', className: 'w-fit'})}><PanelsTopLeft />Klasik panele geç</a>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
