import * as React from 'react';
import {Tooltip as BaseTooltip} from '@base-ui/react/tooltip';

export const TooltipProvider = BaseTooltip.Provider;

/** Short helper text on hover/focus. The trigger keeps its own accessible name. */
export function Tooltip({content, children}: {content: React.ReactNode; children: React.ReactElement}) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner sideOffset={6} className="z-[60]">
          <BaseTooltip.Popup className="max-w-xs rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background shadow-md transition-opacity duration-100 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
