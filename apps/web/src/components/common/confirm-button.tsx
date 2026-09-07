"use client";

import { useTransition, type ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";

/** Runs a server action after a confirmation dialog. */
export function ConfirmButton({
  action,
  confirmText,
  children,
  ...props
}: Omit<ButtonProps, "onClick" | "type"> & {
  action: () => Promise<void>;
  confirmText?: string;
  children: ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      loading={pending}
      onClick={() => {
        if (confirmText && !window.confirm(confirmText)) return;
        startTransition(async () => {
          await action();
        });
      }}
      {...props}
    >
      {children}
    </Button>
  );
}
