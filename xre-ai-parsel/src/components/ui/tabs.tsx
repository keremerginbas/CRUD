import * as React from 'react';
import {Tabs as BaseTabs} from '@base-ui/react/tabs';
import {cn} from '@/lib/utils';

export const Tabs=BaseTabs.Root;
export function TabsList({className,children,...props}:React.ComponentProps<typeof BaseTabs.List>){
 return <BaseTabs.List className={cn('relative z-0 flex border-b border-border',className)} {...props}>
  {children}
  <BaseTabs.Indicator className="absolute bottom-0 left-0 -z-10 h-0.5 w-(--active-tab-width) translate-x-(--active-tab-left) bg-primary transition-[translate,width] duration-200 ease-out"/>
 </BaseTabs.List>;
}
export function TabsTab({className,...props}:React.ComponentProps<typeof BaseTabs.Tab>){
 return <BaseTabs.Tab className={cn('flex h-11 flex-1 items-center justify-center gap-1.5 px-2 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:bg-muted data-active:text-primary',className)} {...props}/>;
}
export function TabsPanel({className,...props}:React.ComponentProps<typeof BaseTabs.Panel>){
 return <BaseTabs.Panel className={cn('outline-none',className)} {...props}/>;
}
