import * as React from 'react';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input, Label, NativeSelect, Hint} from '@/components/ui/input';
import {confirmDialog} from '@/components/ui/confirm';
import {toast} from '@/components/ui/toast';
import {DB} from '@/lib/ext';
import {allLists, getState, listName, refresh, saveLists} from '@/lib/store';
import {setFilters} from '@/lib/ui';

/** Rename, merge or remove a list. Listings are never deleted; only their list label changes. */
export function ListManageDialog({open, onOpenChange, listId}: {open: boolean; onOpenChange: (open: boolean) => void; listId: string}) {
  const list = allLists().find(l => l.id === listId);
  const others = allLists().filter(l => l.id !== listId);
  const [name, setName] = React.useState('');
  const [target, setTarget] = React.useState('');
  React.useEffect(() => { if (open) { setName(list?.name || ''); setTarget(others[0]?.id || ''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function rename() {
    const value = name.trim().slice(0, 80);
    if (!value) { toast('Liste adı boş olamaz.', true); return; }
    const lists = getState().lists.slice(), known = lists.find(l => l.id === listId);
    if (known) known.name = value; else lists.push({id: listId, name: value, createdAt: new Date().toISOString()});
    await saveLists(lists.map(l => ({...l})));
    toast('Liste adı güncellendi.');
  }
  async function relabel(toId: string) {
    const from = listName(listId), to = toId ? listName(toId) : '';
    const ok = await confirmDialog(toId
      ? {title: `“${from}” listesindeki ilanlar “${to}” listesine taşınsın mı?`, confirmLabel: 'Birleştir'}
      : {title: `“${from}” listesi kaldırılsın mı?`, description: 'İlanlar arşivde kalır; yalnız liste etiketi kaldırılır.', confirmLabel: 'Listeyi kaldır', destructive: true});
    if (!ok) return;
    try {
      const result = await DB().relabelList(listId, toId);
      await saveLists(getState().lists.filter(l => l.id !== listId));
      onOpenChange(false);
      await refresh();
      setFilters({list: toId || 'all'});
      toast(toId ? `${result.changed} ilan “${to}” listesine taşındı.` : `Liste kaldırıldı; ${result.changed} ilan arşivde kalmaya devam ediyor.`);
    } catch (error) { toast((error as Error).message, true); }
  }
  return (
    <Dialog open={open && Boolean(list)} onOpenChange={onOpenChange}>
      <DialogContent data-testid="list-manage-dialog">
        <DialogHeader>
          <DialogTitle>{list?.name}</DialogTitle>
          <DialogDescription>{(list?.count || 0).toLocaleString('tr-TR')} ilan bu listede. Kaldırma veya birleştirme ilanları silmez.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label>Liste adı<Input value={name} maxLength={80} onChange={e => setName(e.target.value)} data-testid="list-rename" /></Label>
          <div><Button variant="outline" size="sm" onClick={rename} data-testid="list-rename-save">Adı kaydet</Button></div>
        </div>
        <div className="flex flex-col gap-2 border-t pt-4">
          <Label>Başka listeyle birleştir
            <NativeSelect value={target} onChange={e => setTarget(e.target.value)} disabled={!others.length} data-testid="list-merge-target">
              {others.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </NativeSelect>
            <Hint>Bu listedeki ilanlar seçilen listeye taşınır ve bu liste kaldırılır.</Hint>
          </Label>
          <div><Button variant="outline" size="sm" disabled={!others.length || !target} onClick={() => relabel(target)} data-testid="list-merge">Birleştir</Button></div>
        </div>
        <div className="flex justify-between gap-2 border-t pt-4">
          <Button variant="ghost" className="text-destructive" onClick={() => relabel('')} data-testid="list-delete">Listeyi kaldır</Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Kapat</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
