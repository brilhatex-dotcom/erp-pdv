/**
 * Regras de arquitetura executáveis.
 *
 * O grafo de dependências de docs/ARQUITETURA.md §3.3 é lei. Este arquivo é o
 * que transforma essa lei em portão de CI: qualquer seta que não exista no
 * grafo quebra o build.
 *
 * Sem isto, "o domínio não depende de infraestrutura" é uma intenção que
 * sobrevive até o primeiro prazo apertado.
 */
module.exports = {
  forbidden: [
    // ── Núcleo puro ───────────────────────────────────────────────────────
    {
      name: "dominio-sem-infraestrutura",
      comment:
        "@erp/domain é o núcleo puro: só pode depender de si mesmo e de @erp/utils. " +
        "Nenhum import de Prisma, HTTP, React, fs ou biblioteca de terceiros. " +
        "Ver ARQUITETURA.md §2.3 e CLAUDE.md §4 princípio 2.",
      severity: "error",
      from: { path: "^packages/domain/src" },
      to: {
        pathNot: ["^packages/domain/src", "^packages/utils"],
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "utils-sem-dependencias",
      comment:
        "@erp/utils é folha do grafo: validadores e formatadores puros, sem " +
        "nenhuma dependência do projeto.",
      severity: "error",
      from: { path: "^packages/utils/src" },
      to: {
        pathNot: "^packages/utils/src",
        dependencyTypesNot: ["type-only"],
      },
    },

    // ── Camada de aplicação ───────────────────────────────────────────────
    {
      name: "aplicacao-sem-adapters",
      comment:
        "@erp/application define portas; quem as implementa é a infraestrutura. " +
        "Depender de database/fiscal/printing/ui inverteria a seta do grafo e " +
        "acoplaria caso de uso a detalhe técnico. Ver ARQUITETURA.md §2.3.",
      severity: "error",
      from: { path: "^packages/application/src" },
      to: {
        path: [
          "^packages/database",
          "^packages/fiscal",
          "^packages/printing",
          "^packages/ui",
        ],
      },
    },

    // ── Infraestrutura ────────────────────────────────────────────────────
    {
      name: "adapters-nao-se-conhecem",
      comment:
        "Adapters de infraestrutura são independentes entre si. Se um precisa " +
        "de outro, a coordenação pertence a um caso de uso.",
      severity: "error",
      from: { path: "^packages/(database|fiscal|printing)/src" },
      to: {
        path: "^packages/(database|fiscal|printing)",
        pathNot: "^packages/$1",
      },
    },
    {
      name: "ui-sem-backend",
      comment:
        "@erp/ui é design system: componentes visuais sem acesso a banco, " +
        "regra de negócio ou emissão fiscal.",
      severity: "error",
      from: { path: "^packages/ui/src" },
      to: {
        path: ["^packages/database", "^packages/fiscal", "^packages/application"],
      },
    },

    {
      name: "cliente-api-so-transporte",
      comment:
        "@erp/cliente-api é transporte: fala HTTP e sessão, em DTO. Depender do " +
        "domínio faria a regra de negócio ser avaliada no navegador — onde um " +
        "cliente adulterado a contorna (ARQUITETURA.md §9.5). Depender de " +
        "database ou fiscal seria pior ainda: código de servidor no pacote que " +
        "o PDV embarca.",
      severity: "error",
      from: { path: "^packages/cliente-api/src" },
      to: {
        path: "^packages/(domain|application|database|fiscal|printing|ui)",
      },
    },

    // ── Fronteira pacotes × aplicações ────────────────────────────────────
    {
      name: "pacote-nao-depende-de-app",
      comment:
        "Pacotes são reutilizáveis; aplicações são composição. Um pacote que " +
        "importa de apps/ deixa de ser reutilizável.",
      severity: "error",
      from: { path: "^packages" },
      to: { path: "^apps" },
    },
    {
      name: "app-nao-depende-de-app",
      comment:
        "Aplicações não se conhecem. Código comum entre elas pertence a um pacote.",
      severity: "error",
      from: { path: "^apps/([^/]+)/" },
      to: { path: "^apps/", pathNot: "^apps/$1/" },
    },

    // ── Higiene geral ─────────────────────────────────────────────────────
    {
      name: "sem-ciclos",
      comment:
        "Ciclo de dependência impede raciocinar sobre uma parte isoladamente " +
        "e quebra a ordem de build do Turborepo.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "sem-orfaos",
      comment: "Arquivo que ninguém importa é código morto — remova-o.",
      severity: "warn",
      from: {
        orphan: true,
        pathNot: [
          "\\.(json|md|d\\.ts)$",
          "(^|/)(index|main)\\.ts$",
          "\\.(test|spec)\\.ts$",
          "(^|/)\\.[^/]+\\.(js|cjs|mjs|ts)$",
          // Scripts de linha de comando são ponto de entrada, não módulo
          // importado. Sem esta linha, toda ferramenta de suporte vira aviso.
          "^apps/[^/]+/scripts/",
        ],
      },
      to: {},
    },
    {
      name: "sem-dependencia-nao-declarada",
      comment:
        "Módulo usado sem estar no package.json. Funciona por acidente do " +
        "hoisting e quebra em outra máquina.",
      severity: "error",
      from: {},
      to: { dependencyTypes: ["unknown", "undetermined", "npm-no-pkg", "npm-unknown"] },
    },
    {
      name: "sem-devdep-em-producao",
      comment: "Código de produção não pode depender de devDependency.",
      severity: "error",
      from: {
        path: "^(packages|apps)/[^/]+/src",
        pathNot: "\\.(test|spec)\\.ts$",
      },
      to: { dependencyTypes: ["npm-dev"] },
    },
  ],

  options: {
    doNotFollow: { path: "node_modules" },
    exclude: {
      path: [
        "node_modules",
        "dist",
        "coverage",
        "\\.turbo",
        // Configuração de build não é código de aplicação: o grafo de camadas
        // descreve o que roda em produção, não a ferramenta que o compila.
        "\\.(config|base)\\.(ts|mts|cts|mjs|cjs|js)$",
        // Cliente gerado pelo Prisma. O grafo descreve decisões de arquitetura
        // nossas; código que a ferramenta reescreve a cada migração não é uma.
        "src/gerado",
        // Preparo do Vitest: carregado pela configuração de teste, que já está
        // fora do grafo. Apareceria como órfão sem ser um.
        "src/testes/preparo\\.ts$",
      ],
    },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["module", "main", "types"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
