{ pkgs, ... }:

{
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_24;
    pnpm.enable = true;
  };

  packages = with pkgs; [
    git
    openssl # Prisma engines
    pandoc # Markdown -> DOCX/PDF
    texliveMedium # LaTeX engine for pandoc PDF output
  ];

  # Postgres (pgvector) + RustFS run via Docker Compose (docker-compose.yml).
  processes.services.exec = "docker compose up";

  enterShell = ''
    echo "node $(node --version) · pnpm $(pnpm --version) · $(pandoc --version | head -1)"
  '';
}
