import * as React from 'react';
import {cn} from '@/lib/utils';

export const inputClass='h-10 w-full min-w-0 rounded-xl border border-input bg-white/[.04] px-3.5 text-sm text-foreground shadow-xs outline-none transition-[border,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:bg-white/[.02] disabled:opacity-50';

export function Input({className,...props}:React.ComponentProps<'input'>){
 return <input data-slot="input" className={cn(inputClass,className)} {...props}/>;
}
export function Textarea({className,...props}:React.ComponentProps<'textarea'>){
 return <textarea data-slot="textarea" className={cn(inputClass,'h-auto min-h-24 resize-y py-2',className)} {...props}/>;
}
export function Label({className,...props}:React.ComponentProps<'label'>){
 return <label className={cn('flex items-center gap-1.5 text-xs font-semibold text-muted-foreground',className)} {...props}/>;
}
