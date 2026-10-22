import * as React from 'react';
import {FolderPlus, FolderInput, Archive} from 'lucide-react';
import {cn} from '@/lib/utils';
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input, Label, NativeSelect} from '@/components/ui/input';
import {allLists, createList, useStore} from '@/lib/store';
import {registerListChoice, type ChoiceRequest} from '@/lib/ui';
import {toast} from '@/components/ui/toast';

type Choice = 'new' | 'existing' | 'none';
const defaultName = (base: string) => {
  const d = new Intl.DateTimeFormat('tr-TR', {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'}).format(new Date());
  return base ? `${base} · ${d}` : `Liste ${d}`;
};

/** Asked before every crawl: new list, add to an existing list, or no list. */
export function ListChoiceHost() {
  const [request, setRequest] = React.useState<ChoiceRequest | null>(null);
  const [choice, setChoice] = React.useState<Choice>('new');
  const [name, setName] = React.useState('');
  const [existing, setExisting] = React.useState('');
  useStore(s => s.lists); useStore(s => s.records);
  const lists = allLists();
  React.useEffect(() => {
    registerListChoice(next => {
      const all = allLists();
      const preferred = all.some(l => l.id === next.preferred) ? next.preferred : '';
      setChoice(preferred ? 'existing' : 'new');
      setExisting(preferred || all[0]?.id || '');
      setName(defaultName(next.defaultName));
      setRequest(next);
    });
    return () => registerListChoice(null);
  }, []);
  const finish = async (ok: boolean) => {
    if (!request) return;
    const resolve = request.resolve;
    setRequest(null);
    if (!ok) { resolve(null); return; }
    if (choice === 'none') { resolve({listId: ''}); return; }
    if (choice === 'existing' && existing) { resolve({listId: existing}); return; }
    try { const list = await createList(name.trim() || defaultName('')); resolve({listId: list.id}); }
    catch (error) { toast('Liste adı kaydedilemedi: ' + (error as Error).message, true); resolve({listId: ''}); }
  };
  const option = (value: Choice, icon: React.ReactNode, title: string, text: string, disabled = false) => (
    <label className={cn('flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors', choice === value ? 'border-primary bg-primary/5' : 'hover:bg-muted/50', disabled && 'cursor-not-allowed opacity-50')}>
      <input type="radio" name="listChoice" value={value} checked={choice === value} disabled={disabled} onChange={() => setChoice(value)} className="mt-1 accent-[var(--primary)]" />
      <span className="mt-0.5 text-muted-foreground [&_svg]:size-4">{icon}</span>
      <span className="flex flex-col gap-0.5"><span className="text-sm font-medium">{title}</span><span className="text-xs text-muted-foreground">{text}</span></span>
    </label>
  );
  return (
    <Dialog open={Boolean(request)} onOpenChange={open => { if (!open) finish(false); }}>
      <DialogContent className="max-w-lg" data-testid="list-choice">
        <DialogHeader>
          <DialogTitle>Çekilen ilanlar nereye kaydedilsin?</DialogTitle>
          <DialogDescription>Yeni liste seçerseniz bu çekim temiz bir listede başlar; eski ilanlar arşivde kalır ama bu listede görünmez.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {option('new', <FolderPlus />, 'Yeni liste oluştur', 'Önceki çekimlerle karışmaz.')}
          {choice === 'new' && <Label className="ml-9">Liste adı<Input value={name} maxLength={80} onChange={e => setName(e.target.value)} data-testid="list-name" /></Label>}
          {option('existing', <FolderInput />, 'Mevcut listenin üstüne ekle', lists.length ? 'Aynı ilan tekrar gelirse güncellenir, iki kez eklenmez.' : 'Henüz oluşturulmuş liste yok.', !lists.length)}
          {choice === 'existing' && (
            <Label className="ml-9">Liste
              <NativeSelect value={existing} onChange={e => setExisting(e.target.value)} data-testid="list-existing">
                {lists.map(l => <option key={l.id} value={l.id}>{l.name} ({l.count.toLocaleString('tr-TR')} ilan)</option>)}
              </NativeSelect>
            </Label>
          )}
          {option('none', <Archive />, 'Listeye koymadan genel arşive ekle', 'Her şey tek arşivde birikir.')}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => finish(false)}>Vazgeç</Button>
          <Button onClick={() => finish(true)} data-testid="list-choice-ok">Başlat</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
