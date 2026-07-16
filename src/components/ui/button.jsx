import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
    "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-label-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
    {
        variants: {
            variant: {
                default: "bg-primary text-on-primary hover:opacity-90 active:scale-95 shadow-sm",
                destructive: "bg-error text-on-error hover:opacity-90 active:scale-95 shadow-sm",
                outline: "border border-outline-variant bg-surface-container-lowest hover:bg-surface-container-low text-on-surface",
                secondary: "bg-secondary text-on-secondary hover:opacity-90 active:scale-95 shadow-sm",
                ghost: "hover:bg-surface-container text-on-surface",
                link: "text-primary underline-offset-4 hover:underline",
            },
            size: {
                default: "h-10 px-lg py-sm",
                sm: "h-9 rounded-md px-md py-xs",
                lg: "h-11 rounded-lg px-xl py-sm",
                icon: "h-10 w-10",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    },
)

const Button = React.forwardRef(
    ({ className, variant, size, asChild = false, ...props }, ref) => {
        const Comp = asChild ? Slot : "button"
        return (
            <Comp
                className={cn(buttonVariants({ variant, size, className }))}
                ref={ref}
                {...props}
            />
        )
    },
)
Button.displayName = "Button"

export { Button, buttonVariants }
