"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BuildingIcon, CreditCardIcon, FileCheckIcon, FilterIcon, GavelIcon, RadarIcon, SettingsIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/radar", label: "Radar", icon: RadarIcon },
  { href: "/rules", label: "Regras", icon: FilterIcon },
  { href: "/bids", label: "Licitações", icon: GavelIcon },
  { href: "/documents", label: "Documentos", icon: FileCheckIcon },
  { href: "/company", label: "Empresa", icon: BuildingIcon },
  { href: "/billing", label: "Plano", icon: CreditCardIcon },
  { href: "/settings", label: "Configurações", icon: SettingsIcon },
];

export function NavLinks({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  return (
    <nav className={cn(compact ? "flex gap-1 overflow-x-auto" : "flex flex-col gap-1")}>
      {LINKS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted",
              active && "bg-muted font-medium",
            )}
          >
            <Icon className="size-4" />
            <span className={cn(compact && "sr-only")}>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
