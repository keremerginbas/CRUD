import * as React from 'react';
import {Combobox} from '@base-ui/react/combobox';
import {Check, ChevronDown, Loader2, X} from 'lucide-react';
import type {Region} from '@/lib/api';
import {cn} from '@/lib/utils';
import {inputClass} from './input';

type Item={value:string;label:string};

// TKGM listeleri (ör. bir ilçenin 60+ mahallesi) için yazarak filtrelenebilen seçici.
export function RegionCombobox({label,placeholder,items,value,onChange,disabled,loading,step}:{
 label:string;placeholder:string;items:Region[];value:string;onChange:(id:string)=>void;
 disabled?:boolean;loading?:boolean;step:number;
}){
 const id=React.useId();
 const options=React.useMemo<Item[]>(()=>items.map(r=>({value:String(r.id),label:r.name})),[items]);
 const selected=options.find(o=>o.value===value)??null;
 return <Combobox.Root items={options} value={selected} locale="tr-TR" autoHighlight disabled={disabled}
  onValueChange={(item:Item|null)=>onChange(item?.value??'')}>
  <div className="flex flex-col gap-1.5">
   <label htmlFor={id} className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
    <span className={cn('grid size-5 place-items-center rounded-full text-[10px] font-bold',
     selected?'bg-primary text-primary-foreground':'bg-muted text-muted-foreground')}>{selected?<Check size={11} strokeWidth={3}/>:step}</span>
    {label}
    {loading&&<Loader2 size={13} className="ml-auto animate-spin text-primary" aria-label="Yükleniyor"/>}
   </label>
   <Combobox.InputGroup className="relative">
    <Combobox.Input id={id} placeholder={loading?'Yükleniyor…':placeholder} className={cn(inputClass,'pr-16')}/>
    <div className="absolute inset-y-0 right-1 flex items-center text-muted-foreground">
     {selected&&!disabled&&<Combobox.Clear aria-label={`${label} seçimini temizle`} className="grid size-7 place-items-center rounded-md hover:bg-muted hover:text-foreground"><X size={14}/></Combobox.Clear>}
     <Combobox.Trigger aria-label={`${label} listesini aç`} className="grid size-7 place-items-center rounded-md hover:bg-muted hover:text-foreground"><ChevronDown size={16}/></Combobox.Trigger>
    </div>
   </Combobox.InputGroup>
  </div>
  <Combobox.Portal>
   <Combobox.Positioner sideOffset={4} className="z-[1200] outline-none">
    <Combobox.Popup className="w-(--anchor-width) max-w-(--available-width) origin-(--transform-origin) overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg transition-[scale,opacity] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
     <Combobox.Empty><div className="px-3 py-4 text-sm text-muted-foreground">Eşleşen kayıt yok.</div></Combobox.Empty>
     <Combobox.List className="max-h-[min(20rem,var(--available-height))] scroll-py-1 overflow-y-auto overscroll-contain p-1 data-empty:p-0">
      {(item:Item)=><Combobox.Item key={item.value} value={item}
       className="grid cursor-default grid-cols-[1rem_1fr] items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-primary data-highlighted:text-primary-foreground">
       <Combobox.ItemIndicator className="col-start-1"><Check size={14}/></Combobox.ItemIndicator>
       <span className="col-start-2">{item.label}</span>
      </Combobox.Item>}
     </Combobox.List>
    </Combobox.Popup>
   </Combobox.Positioner>
  </Combobox.Portal>
 </Combobox.Root>;
}
