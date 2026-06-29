import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-[46px] w-full min-w-0 rounded-field border border-line-strong bg-surface-2 px-3.5 py-1 text-[14.5px] font-medium text-ink transition-[color,background-color,border-color,box-shadow] outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-ink placeholder:font-normal placeholder:text-ink-muted hover:border-ink-muted focus-visible:border-accent focus-visible:bg-surface focus-visible:ring-4 focus-visible:ring-[var(--accent-ring)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-4 aria-invalid:ring-destructive/20",
        className
      )}
      {...props}
    />
  )
}

export { Input }
