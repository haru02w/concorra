{ pkgs, config, ... }:

{
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_24;
    pnpm.enable = true;
  };

  # Keep the pnpm store on the same filesystem as the repo (hard links).
  env.npm_config_store_dir = "${config.devenv.root}/.devenv/pnpm-store";

  # Prisma has no prebuilt engines for NixOS; use the nixpkgs schema engine.
  env.PRISMA_SCHEMA_ENGINE_BINARY = "${pkgs.prisma-engines_7}/bin/schema-engine";

  # Load .env into the shell.
  dotenv.enable = true;

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
