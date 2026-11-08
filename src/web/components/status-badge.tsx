import { Badge } from "@/components/ui/badge";

type Tone = "default" | "secondary" | "destructive" | "outline";

const LABELS: Record<string, [string, Tone]> = {
  // analysis
  queued: ["Na fila", "secondary"],
  ingesting: ["Lendo edital", "secondary"],
  running: ["Analisando", "secondary"],
  done: ["Concluída", "default"],
  failed: ["Falhou", "destructive"],
  // recommendation
  participate: ["Participar", "default"],
  review: ["Revisar", "secondary"],
  skip: ["Não participar", "outline"],
  // bid
  participating: ["Participando", "default"],
  skipped: ["Descartada", "outline"],
  ready: ["Pronta para envio", "default"],
  submitted: ["Enviada", "secondary"],
  cancelled: ["Cancelada", "outline"],
  // pack
  idle: ["Aguardando", "outline"],
  building: ["Gerando pacote", "secondary"],
  // documents
  pending: ["Validando", "secondary"],
  valid: ["Válido", "default"],
  expiring: ["Vencendo", "secondary"],
  expired: ["Vencido", "destructive"],
  invalid: ["Inválido", "destructive"],
  // gaps
  have: ["OK", "default"],
  missing: ["Faltando", "destructive"],
  manual: ["Verificar", "outline"],
  // generated docs
  draft: ["Rascunho", "secondary"],
  approved: ["Aprovado", "default"],
};

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const [label, tone] = LABELS[status ?? ""] ?? [status ?? "—", "outline" as Tone];
  return <Badge variant={tone}>{label}</Badge>;
}
