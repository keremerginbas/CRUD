import {Tabs as BaseTabs} from '@base-ui/react/tabs';
import {cn} from '@/lib/utils';

export const Tabs = BaseTabs.Root;
export function TabsList({className, children, ...props}: React.ComponentProps<typeof BaseTabs.List>) {
  return (
    <BaseTabs.List className={cn('relative inline-flex h-9 items-center gap-0.5 rounded-lg bg-muted p-1 text-muted-foreground', className)} {...props}>
      {children}
      <BaseTabs.Indicator className="absolute top-1/2 left-0 -z-0 h-[calc(100%-8px)] w-[var(--active-tab-width)] -translate-y-1/2 translate-x-[var(--active-tab-left)] rounded-md bg-card shadow-sm transition-all duration-200" />
    </BaseTabs.List>
  );
}
export function TabsTab({className, ...props}: React.ComponentProps<typeof BaseTabs.Tab>) {
  return <BaseTabs.Tab className={cn('relative z-10 inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-3 text-[13px] font-medium whitespace-nowrap transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 data-[selected]:text-foreground [&_svg]:size-4', className)} {...props} />;
}
export const TabsPanel = BaseTabs.Panel;
