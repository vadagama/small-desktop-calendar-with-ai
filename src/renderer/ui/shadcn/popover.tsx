import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ComponentProps } from "react";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({
  container,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content> & {
  container: HTMLElement;
}) {
  return (
    <PopoverPrimitive.Portal container={container}>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align="start"
        sideOffset={4}
        collisionPadding={8}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
