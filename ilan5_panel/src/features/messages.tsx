import * as React from 'react';
import {Send, SkipForward, CheckCheck, Eraser, ListPlus, Save, MessageSquareDashed, Trash2, Wand2} from 'lucide-react';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Input, Label, NativeSelect, Textarea, Hint} from '@/components/ui/input';
import {Switch} from '@/components/ui/switch';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {toast} from '@/components/ui/toast';
import {confirmDialog} from '@/components/ui/confirm';
import {EmptyState, PageHeader, StatCard} from '@/components/common';
import {num, runtime} from '@/lib/ext';
import {refresh, syncMessages, useStore} from '@/lib/store';

const STATUS: Record<string, [string, 'muted' | 'info' | 'warning' | 'success' | 'danger']> = {
  queued: ['Bekliyor', 'muted'], opening: ['Açılıyor', 'info'], prepared: ['Hazırlandı', 'warning'], sent: ['Gönderildi', 'success'], skipped: ['Atlandı', 'muted'], error: ['Hata', 'danger'],
};

export function Messages() {
  const {queue, templates} = useStore(s => s.messages);
  const [busy, setBusy] = React.useState(false);
  const [name, setName] = React.useState('');
  const [body, setBody] = React.useState('');
  const [category, setCategory] = React.useState('arsa');
  const [limit, setLimit] = React.useState('0');
  const [skipSeller, setSkipSeller] = React.useState(true);
  const template = templates[0];
  React.useEffect(() => { if (template) { setName(template.name || ''); setBody(template.body || ''); } }, [template?.id, template?.body]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = {queued: 0, prepared: 0, sent: 0, skipped: 0, error: 0} as Record<string, number>;
  for (const item of queue) if (item.status in counts) counts[item.status]++;
  const rows = queue.slice().sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt))).slice(0, 100);

  async function act(fn: () => Promise<void>) {
    if (busy) return; setBusy(true);
    try { await fn(); await syncMessages(); await refresh(); } catch (error) { toast((error as Error).message, true); } finally { setBusy(false); }
  }
  const saveTemplate = (e: React.FormEvent) => { e.preventDefault(); act(async () => { await runtime('ILAN_MESSAGE_TEMPLATE', {template: {id: template?.id || 'default-arsa', name, body}}); toast('Mesaj şablonu kaydedildi.'); }); };
  const createQueue = (e: React.FormEvent) => { e.preventDefault(); act(async () => {
    const r = await runtime('ILAN_MESSAGE_QUEUE', {category, limit: Number(limit || 0), skipSameSeller: skipSeller, templateId: template?.id});
    toast(`${num(r.created)} mesaj kuyruğa eklendi.${r.skippedContacted ? ` Daha önce yazılan veya kuyrukta olan satıcıya ait ${num(r.skippedContacted)} ilan atlandı.` : ''}`);
  }); };
  const prepareNext = () => act(async () => { const r = await runtime('ILAN_MESSAGE_PREPARE_NEXT'); toast(r.message || 'Mesaj hazırlandı; Sahibinden sekmesini kontrol edin.'); });
  const markSent = () => act(async () => { const item = queue.find(r => r.status === 'prepared'); if (!item) throw new Error('Gönderildi işaretlenecek hazırlanmış mesaj yok.'); await runtime('ILAN_MESSAGE_MARK_SENT', {id: item.id}); toast('Hazırlanan mesaj gönderildi olarak işaretlendi.'); });
  const sentAndNext = () => act(async () => {
    const item = queue.find(r => r.status === 'prepared'); if (!item) throw new Error('Önce bir mesaj hazırlayın, Sahibinden’de gönderin, sonra bu düğmeye basın.');
    await runtime('ILAN_MESSAGE_MARK_SENT', {id: item.id});
    const next = queue.find(r => r.status === 'queued' && r.id !== item.id);
    if (!next) { toast('Gönderildi olarak işaretlendi. Kuyrukta sıradaki mesaj yok.'); return; }
    const r = await runtime('ILAN_MESSAGE_PREPARE_NEXT', {id: next.id}); toast(r.message || 'Gönderildi kaydedildi; sıradaki mesaj hazırlandı.');
  });
  const clearQueue = async () => {
    if (!await confirmDialog({title: 'Mesaj kuyruğu temizlensin mi?', description: 'İlan arşiviniz, şablonunuz ve “mesaj gönderildi” bilgileri korunur.', confirmLabel: 'Kuyruğu temizle', destructive: true})) return;
    act(async () => { const r = await runtime('ILAN_MESSAGE_CLEAR'); toast(`${num(r.deleted)} mesaj kaydı silindi.${r.protectedCount ? ` ${r.protectedCount} hazırlanmakta olan kayıt korundu.` : ''}`); });
  };
  const rowAction = (id: string, kind: 'prepare' | 'sent' | 'skip' | 'delete') => act(async () => {
    if (kind === 'prepare') { const r = await runtime('ILAN_MESSAGE_PREPARE_NEXT', {id}); toast(r.message || 'Mesaj hazırlandı.'); }
    if (kind === 'sent') { await runtime('ILAN_MESSAGE_MARK_SENT', {id}); toast('Mesaj gönderildi olarak işaretlendi.'); }
    if (kind === 'skip') { await runtime('ILAN_MESSAGE_SKIP', {id, reason: 'Panelden atlandı'}); toast('Mesaj atlandı.'); }
    if (kind === 'delete') {
      if (!await confirmDialog({title: 'Bu mesaj kaydı silinsin mi?', description: 'İlan arşivinde değişiklik yapılmaz.', confirmLabel: 'Sil', destructive: true})) return;
      await runtime('ILAN_MESSAGE_DELETE', {id}); toast('Mesaj kaydı silindi.');
    }
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Sahibinden mesaj kampanyası" title="Filtrele, kuyruğa al, mesajı hazırla" description="Eklenti ilanı açar ve mesajı kutuya yazar; gönderim kararını siz verirsiniz. Aynı satıcıya ikinci kez mesaj kuyruğa alınmaz."
        actions={<>
          <Button onClick={prepareNext} disabled={busy || !counts.queued}><Wand2 />Sıradaki mesajı hazırla</Button>
          <Button variant="outline" onClick={sentAndNext} disabled={busy || !counts.prepared}><Send />Gönderdim, sıradakine geç</Button>
        </>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Bekleyen" value={num(counts.queued)} />
        <StatCard label="Hazırlanmış" value={num(counts.prepared)} tone={counts.prepared ? 'warning' : 'default'} />
        <StatCard label="Gönderildi" value={num(counts.sent)} tone="success" />
        <StatCard label="Atlandı" value={num(counts.skipped)} />
        <StatCard label="Hata" value={num(counts.error)} tone={counts.error ? 'danger' : 'default'} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Mesaj şablonu</CardTitle><CardDescription>Kullanılabilir alanlar: {'{ad_soyad}, {ilan_basligi}, {ilan_no}, {il}, {ilce}, {mahalle}, {fiyat}, {url}'}</CardDescription></CardHeader>
          <CardContent>
            <form onSubmit={saveTemplate} className="flex flex-col gap-3">
              <Label>Şablon adı<Input value={name} onChange={e => setName(e.target.value)} /></Label>
              <Label>Mesaj metni<Textarea rows={5} value={body} onChange={e => setBody(e.target.value)} required /></Label>
              <div><Button type="submit" variant="outline" disabled={busy}><Save />Şablonu kaydet</Button></div>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Hedef liste oluştur</CardTitle><CardDescription>Arşivdeki Sahibinden ilanlarından mesaj kuyruğu oluşturur.</CardDescription></CardHeader>
          <CardContent>
            <form onSubmit={createQueue} className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <Label>Kategori<NativeSelect value={category} onChange={e => setCategory(e.target.value)}>
                  <option value="arsa">Arsa</option><option value="all">Tüm Sahibinden ilanları</option><option value="konut">Konut</option><option value="isyeri">İşyeri</option><option value="arac">Araç</option><option value="diger">Diğer</option>
                </NativeSelect></Label>
                <Label>Liste sınırı<Input type="number" min={0} value={limit} onChange={e => setLimit(e.target.value)} /><Hint>0 = sınır yok</Hint></Label>
              </div>
              <label className="flex items-center gap-3 text-sm"><Switch checked={skipSeller} onCheckedChange={setSkipSeller} label="Aynı satıcıya tekrar kuyruk oluşturma" />Aynı satıcıya tekrar kuyruk oluşturma</label>
              <div><Button type="submit" disabled={busy}><ListPlus />Kuyruk oluştur</Button></div>
            </form>
          </CardContent>
        </Card>
      </div>
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <span className="text-sm font-medium">Mesaj işlemleri</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={markSent} disabled={busy || !counts.prepared}><CheckCheck />Hazırlananı gönderildi işaretle</Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={clearQueue} disabled={busy || !queue.length}><Eraser />Kuyruğu temizle</Button>
          </div>
        </div>
        {rows.length ? (
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Durum</TableHead><TableHead>İlan</TableHead><TableHead>Satıcı</TableHead><TableHead>Mesaj</TableHead><TableHead className="text-right">İşlem</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map(item => {
                const [label, variant] = STATUS[item.status] || [item.status, 'muted'];
                return (
                  <TableRow key={item.id}>
                    <TableCell><Badge variant={variant}>{label}</Badge>{item.lastError && <div className="mt-1 max-w-48 text-xs text-destructive">{item.lastError}</div>}</TableCell>
                    <TableCell><div className="max-w-72 font-medium">{item.title || 'Başlık yok'}</div><div className="text-xs text-muted-foreground">{item.listingId}</div></TableCell>
                    <TableCell className="whitespace-nowrap">{item.sellerName || 'Satıcı okunmadı'}</TableCell>
                    <TableCell><p className="line-clamp-2 max-w-md text-xs text-muted-foreground">{item.message}</p></TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => rowAction(item.id, 'prepare')}>Hazırla</Button>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => rowAction(item.id, 'sent')}>Gönderildi</Button>
                        <Button size="icon-sm" variant="ghost" disabled={busy} onClick={() => rowAction(item.id, 'skip')} aria-label="Atla"><SkipForward /></Button>
                        <Button size="icon-sm" variant="ghost" disabled={busy} onClick={() => rowAction(item.id, 'delete')} aria-label="Mesaj kaydını sil"><Trash2 /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : <EmptyState icon={<MessageSquareDashed />} title="Henüz mesaj kuyruğu yok" description="Önce Sahibinden ilanlarını arşive alın, sonra bu bölümden hedef liste oluşturun." />}
      </Card>
    </div>
  );
}
