import {useMemo, useState} from 'react';
import {createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable, type SortingState} from '@tanstack/react-table';
import {ArrowUpDown, Star, Trash2} from 'lucide-react';
import type {Pin} from '@/lib/api';
import {Input} from './ui/input';
import {Button} from './ui/button';
import {cn} from '@/lib/utils';

const col=createColumnHelper<Pin>();

// CRM'e büyüyecek kayıt listesi: arama + sıralama TanStack Table ile.
export function MarkersTable({markers,onShow,onToggleFavorite,onRemove}:{
 markers:Pin[];onShow:(p:Pin)=>void;onToggleFavorite:(p:Pin)=>void;onRemove:(p:Pin)=>void;
}){
 const [sorting,setSorting]=useState<SortingState>([]);
 const [filter,setFilter]=useState('');
 const columns=useMemo(()=>[
  col.accessor(p=>Boolean(p.favorite),{id:'favorite',header:'★',size:36,
   cell:c=><button aria-label="Favori değiştir" title="Favori değiştir" onClick={()=>onToggleFavorite(c.row.original)}
    className={cn('grid size-7 place-items-center rounded-md transition hover:bg-muted',c.getValue()?'text-amber-500':'text-muted-foreground')}>
    <Star size={15} fill={c.getValue()?'currentColor':'none'}/></button>}),
  col.accessor(p=>p.note||`${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`,{id:'note',header:'Not / konum',
   cell:c=><button title="Haritada göster" onClick={()=>onShow(c.row.original)} className="w-full truncate text-left font-medium text-foreground hover:text-primary hover:underline">{c.getValue()}</button>}),
  col.display({id:'actions',size:36,
   cell:c=><button aria-label="Kaydı sil" title="Kaydı sil" onClick={()=>onRemove(c.row.original)} className="grid size-7 place-items-center rounded-md text-muted-foreground transition hover:bg-parcel/10 hover:text-parcel"><Trash2 size={14}/></button>})
 ],[onShow,onToggleFavorite,onRemove]);
 const table=useReactTable({data:markers,columns,state:{sorting,globalFilter:filter},onSortingChange:setSorting,onGlobalFilterChange:setFilter,
  getCoreRowModel:getCoreRowModel(),getSortedRowModel:getSortedRowModel(),getFilteredRowModel:getFilteredRowModel()});
 if(!markers.length)return <p className="text-sm text-muted-foreground">Henüz kayıtlı işaretçi yok.</p>;
 return <div className="space-y-2">
  <Input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Kayıtlarda ara…" className="h-9"/>
  <div className="overflow-hidden rounded-lg border border-border">
   <table className="w-full table-fixed text-sm">
    <thead className="bg-muted/60 text-xs text-muted-foreground">
     {table.getHeaderGroups().map(g=><tr key={g.id}>{g.headers.map(h=><th key={h.id} style={{width:h.column.columnDef.size!==150?h.column.columnDef.size:undefined}} className="px-2 py-1.5 text-left font-semibold">
      {h.column.getCanSort()&&h.id==='note'
       ?<Button variant="ghost" size="sm" className="-ml-2 h-7 px-2" onClick={h.column.getToggleSortingHandler()}>{flexRender(h.column.columnDef.header,h.getContext())}<ArrowUpDown size={12}/></Button>
       :flexRender(h.column.columnDef.header,h.getContext())}
     </th>)}</tr>)}
    </thead>
    <tbody>
     {table.getRowModel().rows.map(r=><tr key={r.id} className="border-t border-border transition-colors hover:bg-muted/40">
      {r.getVisibleCells().map(c=><td key={c.id} className="px-2 py-1">{flexRender(c.column.columnDef.cell,c.getContext())}</td>)}
     </tr>)}
    </tbody>
   </table>
  </div>
 </div>;
}
