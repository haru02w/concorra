"use client";

import { useTransition } from "react";
import Link from "next/link";
import { ChevronsUpDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { switchOrganization } from "@/modules/organizations/organizations.actions";

export function OrgSwitcher({
  current,
  organizations,
  disabled,
}: {
  current: string;
  organizations: { id: string; name: string }[];
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  const active = organizations.find((o) => o.id === current);
  if (disabled || organizations.length < 1) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" disabled={pending} />}>
        <span className="max-w-40 truncate">{active?.name ?? "Organização"}</span>
        <ChevronsUpDownIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {organizations.map((o) => (
          <DropdownMenuItem key={o.id} disabled={o.id === current} onClick={() => start(() => switchOrganization(o.id))}>
            {o.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/onboarding" />}>Nova organização</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
