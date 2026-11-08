"use client";

import { SubmitButton } from "@/web/components/submit-button";

/** Submit button that asks for confirmation first. */
export function ConfirmSubmit({ message, ...props }: React.ComponentProps<typeof SubmitButton> & { message: string }) {
  return (
    <SubmitButton
      {...props}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    />
  );
}
