/**
 * Seeds the fictitious demo company (Hack Brasil 6.9: no real third-party data).
 * Idempotent: re-running refreshes the demo org's documents and notice.
 */
import "dotenv/config";
import { embedProfile } from "@/application/use-cases/organizations";
import { storeBytes } from "@/application/use-cases/context";
import { EMPTY_FILTERS } from "@/domain/rules/rule";
import { formatCnpj } from "@/domain/shared/cnpj";
import { addDays } from "@/domain/shared/dates";
import { chunkText } from "@/domain/shared/text";
import { l2normalize } from "@/domain/shared/vector";
import { noticeSearchText } from "@/domain/notice/notice";
import { createContainer } from "@/infrastructure/container";

const DEMO_CNPJ = process.env.DEMO_ORG_CNPJ || "99000000000159";

const EDITAL_PAGES = [
  `PREFEITURA MUNICIPAL DE SANTA AURORA DO SUL (ENTE FICTÍCIO PARA DEMONSTRAÇÃO)
EDITAL DE PREGÃO ELETRÔNICO Nº 90012/2026 — PROCESSO ADMINISTRATIVO Nº 4521/2026
OBJETO: Registro de preços para aquisição de material de limpeza e higiene para as unidades escolares da rede municipal.
A licitação é exclusiva para microempresas e empresas de pequeno porte, nos termos do art. 48, I, da Lei Complementar nº 123/2006.
A sessão pública será realizada no sistema Compras.gov.br no dia 27/11/2026, às 09h00 (horário de Brasília).`,
  `DOS PEDIDOS DE ESCLARECIMENTO E IMPUGNAÇÃO
Qualquer pessoa poderá solicitar esclarecimentos ou impugnar o edital até 3 (três) dias úteis antes da data da abertura da sessão pública, ou seja, até 24/11/2026.
DO ENVIO DA PROPOSTA
Os licitantes encaminharão, exclusivamente por meio do sistema, a proposta com a descrição do objeto ofertado e o preço, até a data e o horário estabelecidos para abertura da sessão pública.`,
  `DA HABILITAÇÃO
Para a habilitação, o licitante deverá apresentar:
a) ato constitutivo, estatuto ou contrato social em vigor;
b) prova de regularidade fiscal perante a Fazenda Nacional (Certidão Conjunta RFB/PGFN);
c) prova de regularidade relativa ao Fundo de Garantia por Tempo de Serviço (Certificado de Regularidade do FGTS — CRF);
d) prova de inexistência de débitos inadimplidos perante a Justiça do Trabalho (CNDT);
e) certidão negativa de falência expedida pelo distribuidor da sede do licitante;
f) atestado de capacidade técnica que comprove o fornecimento de materiais de limpeza compatíveis com o objeto.`,
  `DAS DECLARAÇÕES
O licitante deverá declarar, em campo próprio do sistema ou por documento anexo:
I — que não emprega menor de 18 anos em trabalho noturno, perigoso ou insalubre e não emprega menor de 16 anos, salvo na condição de aprendiz;
II — que cumpre os requisitos de habilitação e que as declarações informadas são verídicas;
III — que se enquadra como microempresa ou empresa de pequeno porte, quando for o caso.`,
  `DAS SANÇÕES
O licitante que deixar de entregar a documentação exigida ficará sujeito a multa de 10% (dez por cento) sobre o valor estimado da contratação e impedimento de licitar e contratar pelo prazo de até 3 (três) anos.
DA GARANTIA
Não será exigida garantia contratual.
Santa Aurora do Sul, 6 de novembro de 2026. Agente de contratação: [nome omitido].`,
];

const ITEMS = [
  { numeroItem: 1, descricao: "Detergente líquido neutro, frasco 500 ml", quantidade: 3000, unidade: "UN", valorUnitario: 2.35, valorTotal: 7050 },
  { numeroItem: 2, descricao: "Água sanitária 2% a 2,5% de cloro ativo, frasco 1 litro", quantidade: 2500, unidade: "UN", valorUnitario: 3.1, valorTotal: 7750 },
  { numeroItem: 3, descricao: "Papel higiênico folha dupla, pacote com 4 rolos de 30 m", quantidade: 4000, unidade: "PCT", valorUnitario: 6.4, valorTotal: 25600 },
  { numeroItem: 4, descricao: "Sabonete líquido para mãos, galão 5 litros", quantidade: 300, unidade: "GL", valorUnitario: 28.9, valorTotal: 8670 },
];

const CERTIDOES = [
  { kind: "cnd_federal" as const, title: "CERTIDÃO NEGATIVA DE DÉBITOS RELATIVOS AOS TRIBUTOS FEDERAIS E À DÍVIDA ATIVA DA UNIÃO", issuer: "Receita Federal do Brasil (simulação)", days: 150 },
  { kind: "crf_fgts" as const, title: "CERTIFICADO DE REGULARIDADE DO FGTS — CRF", issuer: "Caixa Econômica Federal (simulação)", days: 10 },
  { kind: "cndt" as const, title: "CERTIDÃO NEGATIVA DE DÉBITOS TRABALHISTAS", issuer: "Tribunal Superior do Trabalho (simulação)", days: 170 },
  { kind: "contrato_social" as const, title: "CONTRATO SOCIAL CONSOLIDADO", issuer: "Junta Comercial (simulação)", days: null },
];

async function main() {
  const { deps, storage, db, env } = createContainer("worker");
  await storage.ensureBucket();
  const now = new Date();

  let org = await deps.organizations.findByCnpj(DEMO_CNPJ);
  const profile = {
    razaoSocial: "LIMPA BEM COMÉRCIO DE PRODUTOS DE LIMPEZA LTDA (FICTÍCIA)",
    nomeFantasia: "Limpa Bem (demo)",
    porte: "EPP" as const,
    cnaePrincipal: "4649-4/08 - Comércio atacadista de produtos de higiene, limpeza e conservação domiciliar",
    cnaesSecundarios: ["4686-9/02 - Comércio atacadista de embalagens", "4772-5/00 - Comércio varejista de cosméticos e produtos de higiene pessoal"],
    endereco: "Rua das Acácias, 100 - Centro, Vitória/ES (endereço fictício)",
    municipio: "Vitória",
    uf: "ES",
    representante: "Maria Exemplo da Silva (fictícia)",
    ufs: ["ES", "MG", "RJ"],
    municipios: [],
    valueMin: 5000,
    valueMax: 800000,
    expertiseText:
      "Fornecimento de material de limpeza, higiene pessoal e descartáveis para órgãos públicos, escolas e hospitais: detergentes, desinfetantes, água sanitária, papel higiênico, papel toalha, sabonete líquido e sacos de lixo.",
  };
  org = org
    ? await deps.organizations.update(org.id, { ...profile, planId: "pro" })
    : await deps.organizations.create({ ...profile, cnpj: DEMO_CNPJ, workosOrgId: "demo_org", planId: "pro" });

  const user = await deps.users.upsert({ workosUserId: "demo_user", email: "demo@concorra.local", name: "Usuária Demo" });
  await deps.memberships.upsert(org.id, user.id, "owner");
  await deps.subscriptions.upsert({ organizationId: org.id, planId: "pro", pendingPlanId: null, status: "active", customerRef: null, checkoutRef: null, subscriptionRef: "demo_subscription", currentPeriodEnd: addDays(now, 30) });

  // Reset demo-owned rows so re-seeding stays clean.
  await db.experience.deleteMany({ where: { organizationId: org.id } });
  await db.rule.deleteMany({ where: { organizationId: org.id } });
  await db.document.deleteMany({ where: { organizationId: org.id } });

  for (const e of [
    { object: "Fornecimento de material de limpeza para 42 escolas municipais", issuer: "Município fictício de Serra Azul", quantities: "180.000 itens/ano" },
    { object: "Fornecimento de papel higiênico e sabonete líquido para rede hospitalar", issuer: "Consórcio de saúde fictício", quantities: "60.000 pacotes" },
  ]) {
    await deps.experiences.create({ organizationId: org.id, fileId: null, issuer: e.issuer, object: e.object, quantities: e.quantities, periodStart: new Date("2025-01-01"), periodEnd: new Date("2025-12-31") });
  }

  await deps.rules.create({
    organizationId: org.id,
    name: "Limpeza e higiene — Sudeste",
    filters: { ...EMPTY_FILTERS, keywordsInclude: ["limpeza", "higiene", "papel higiênico", "detergente"], ufs: ["ES", "MG", "RJ", "SP"] },
    semanticThreshold: null,
    minScore: null,
    channels: ["email", "inapp"],
    frequency: "immediate",
    active: true,
  });
  await deps.rules.create({
    organizationId: org.id,
    name: "Afinidade com o perfil (semântica)",
    filters: { ...EMPTY_FILTERS, valueMax: 800000 },
    semanticThreshold: 0.72,
    minScore: 60,
    channels: ["inapp"],
    frequency: "daily",
    active: true,
  });

  for (const c of CERTIDOES) {
    const validUntil = c.days === null ? null : addDays(now, c.days);
    const markdown = `# ${c.title}\n\n**DOCUMENTO FICTÍCIO PARA DEMONSTRAÇÃO — SEM VALOR LEGAL**\n\nNome: ${profile.razaoSocial}\n\nCNPJ: ${formatCnpj(DEMO_CNPJ)}\n\nEmitida em ${now.toLocaleDateString("pt-BR")}${validUntil ? `. Válida até ${validUntil.toLocaleDateString("pt-BR")}.` : "."}\n\nEmissor: ${c.issuer}\n`;
    const pdf = await deps.renderer.toPdf(markdown);
    const file = await storeBytes(deps, org.id, { name: `${c.kind}.pdf`, mime: "application/pdf", bytes: pdf });
    await deps.documents.create({
      organizationId: org.id,
      kind: c.kind,
      fileId: file.id,
      issuer: c.issuer,
      cnpj: DEMO_CNPJ,
      issuedAt: now,
      validUntil,
      status: c.days !== null && c.days < 15 ? "expiring" : "valid",
      checks: [
        { key: "cnpj", ok: true, message: "CNPJ confere com a empresa" },
        { key: "validity", ok: true, message: validUntil ? `Válido até ${validUntil.toISOString().slice(0, 10)}` : "Sem data de validade" },
      ],
    });
  }

  // Fictitious notice with its edital text already ingested (works even if PNCP is down).
  const encerramento = addDays(now, 19);
  const { notice } = await deps.notices.upsert({
    numeroControlePNCP: "99000001000101-1-000012/2026",
    orgaoCnpj: "99000001000101",
    orgaoNome: "PREFEITURA MUNICIPAL DE SANTA AURORA DO SUL (FICTÍCIA)",
    ano: 2026,
    sequencial: 12,
    numeroCompra: "90012/2026",
    processo: "4521/2026",
    objeto: "Registro de preços para aquisição de material de limpeza e higiene para as unidades escolares da rede municipal",
    informacaoComplementar: "Licitação exclusiva para ME/EPP. Demonstração com dados fictícios.",
    modalidadeId: 6,
    modalidadeNome: "Pregão - Eletrônico",
    modoDisputa: "Aberto",
    situacao: "Divulgada no PNCP",
    valorEstimado: 49070,
    uf: "ES",
    municipioIbge: "3205309",
    municipioNome: "Santa Aurora do Sul",
    unidadeNome: "Secretaria Municipal de Educação",
    dataPublicacao: addDays(now, -2),
    dataAbertura: addDays(now, -1),
    dataEncerramento: encerramento,
    linkSistemaOrigem: "https://www.gov.br/compras/pt-br",
    linkProcessoEletronico: null,
    updatedAtPncp: addDays(now, -2),
    raw: { demo: true },
  });
  const [file] = await deps.noticeFiles.upsertMany(notice.id, [{ sequencialDocumento: 1, titulo: "Edital (fictício)", tipo: "Edital", url: "https://example.org/edital-ficticio.pdf" }]);
  await deps.noticeFiles.savePages(file.id, EDITAL_PAGES);
  await deps.noticeFiles.update(file.id, { pageCount: EDITAL_PAGES.length, ocr: false });

  if (env.GEMINI_API_KEY) {
    await deps.notices.replaceItems(notice.id, ITEMS, (await deps.ai.embed(ITEMS.map((i) => i.descricao), "document")).map(l2normalize));
    const [noticeEmbedding] = await deps.ai.embed([noticeSearchText(notice, ITEMS)], "document");
    await deps.notices.setEmbedding(notice.id, l2normalize(noticeEmbedding));
    const chunks = EDITAL_PAGES.flatMap((text, i) => chunkText(text).map((t) => ({ page: i + 1, text: t })));
    const embeddings = (await deps.ai.embed(chunks.map((c) => c.text), "document")).map(l2normalize);
    await deps.noticeFiles.saveChunks(file.id, chunks.map((c, i) => ({ ...c, embedding: embeddings[i] })));
    await embedProfile(deps, { organizationId: org.id });
  } else {
    await deps.notices.replaceItems(notice.id, ITEMS, null);
    console.warn("[seed] GEMINI_API_KEY not set: skipped embeddings (semantic matching/ranking disabled)");
  }
  await deps.notices.markFilesIngested(notice.id, now);

  console.log(`[seed] demo org ${org.id} (${org.razaoSocial}), user ${user.email}, notice ${notice.id}`);
  await db.$disconnect();
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
