import { Loader2Icon } from "lucide-react";

import { cn } from "@/lib/utils";

// Inline loading spinner (OE-P1 §4). Use inside buttons, tables, etc.
export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin text-muted-foreground", className)}
    />
  );
}
