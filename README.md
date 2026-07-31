# ERP + PDV

Sistema ERP com PDV (Ponto de Venda) para pequenos e médios estabelecimentos
brasileiros: mercadinhos, padarias, mercearias, casas de construção, autopeças,
lojas de conveniência, depósitos, açougues e hortifrutis.

**Escopo: varejo — venda de mercadoria.** Prestação de serviços está fora do produto
([ADR-0014](docs/adr/0014-escopo-varejo-apenas.md)).

## Estado atual

| Etapa | Situação |
|---|---|
| Arquitetura | ✅ Definida — [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) |
| Análise de segmentos | ✅ Concluída — [`docs/ANALISE-SEGMENTOS.md`](docs/ANALISE-SEGMENTOS.md) |
| Etapa 0 — Fundação | ✅ Concluída — monorepo, portões de qualidade e CI operantes |
| Etapa 1 — Domínio: objetos de valor | ✅ Concluída |
| **Etapa 2 — Agregados e catálogo** | ✅ **Concluída** — `Produto`, códigos de barras e balança. 448 testes, 100% de cobertura |
| **Etapa 3a — Estoque** | ✅ **Concluída** — movimentos comutativos e custo médio. 535 testes |
| **Etapa 3b — Venda** | ✅ **Concluída** — itens, pagamentos, desconto rateado, crediário. 678 testes |
| **Etapa 3c — Caixa** | ✅ **Concluída** — sangria, suprimento e conferência. 734 testes |
| Etapa 4 — Aplicação (portas e casos de uso) | ⬜ Próxima |

## Requisitos

- **Node.js 22+** (ver `.nvmrc`)
- **pnpm 10+** — `corepack enable && corepack prepare pnpm@latest --activate`
- **Docker** — apenas para o PostgreSQL de desenvolvimento

## Começando

```bash
pnpm install          # instala as dependências do monorepo
pnpm db:up            # sobe o PostgreSQL 17 (porta 55432)
pnpm verify           # roda TODOS os portões de qualidade
```

`pnpm verify` executa, em ordem: formatação → lint → tipagem → **regras de
arquitetura** → testes. É o mesmo conjunto que o CI aplica; se passar localmente,
passa no CI.

### Comandos

| Comando | O que faz |
|---|---|
| `pnpm verify` | Todos os portões de qualidade (use antes de commitar) |
| `pnpm build` | Compila todos os pacotes |
| `pnpm test` | Testes |
| `pnpm test:cov` | Testes com cobertura (mínimo 90% no domínio) |
| `pnpm typecheck` | Verificação de tipos |
| `pnpm lint` | ESLint |
| `pnpm arch` | Valida o grafo de dependências entre camadas |
| `pnpm format` | Formata o código |
| `pnpm db:up` / `db:down` | Sobe / derruba o PostgreSQL de desenvolvimento |

## Estrutura

```
apps/          aplicações executáveis (criadas nas suas etapas)
packages/
  config/      configurações compartilhadas de TS, ESLint e Vitest
  utils/       validadores e formatadores puros (CPF, CNPJ, texto)
  domain/      núcleo de negócio puro — zero dependências de runtime
docs/
  ARQUITETURA.md        arquitetura completa (fonte da verdade técnica)
  ANALISE-SEGMENTOS.md  requisitos por segmento e impacto no domínio
  fiscal/               arquitetura fiscal e análise de custo dos provedores
  adr/                  decisões arquiteturais registradas
CLAUDE.md      diretrizes permanentes: papéis, fluxo e padrões
```

## Arquitetura em uma página

- **Local-first.** Uma máquina hospeda o servidor; as estações acessam pela rede local.
  O PDV continua vendendo sem internet e mesmo sem o servidor.
- **Hexagonal.** `@erp/domain` não conhece banco, HTTP nem UI — e o CI **impede** que
  passe a conhecer.
- **PostgreSQL 17 único**, embarcado no instalador ([ADR-0013](docs/adr/0013-postgresql-unico-embarcado.md)).
- **Fiscal via provedor externo e opcional.** A emissão passa por uma API fiscal
  especializada atrás da porta `ProvedorFiscal` — o ERP nunca conhece o fornecedor, e
  trocá-lo é escrever um adapter ([ADR-0015](docs/adr/0015-emissao-fiscal-via-provedor-externo.md)).
  O módulo pode ser desligado por empresa ([ADR-0016](docs/adr/0016-modulo-fiscal-opcional-por-empresa.md)).
- **Dinheiro em centavos**, sempre inteiro.

Detalhes em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

## Contribuindo

Leia [`CLAUDE.md`](CLAUDE.md) antes. Ele define o fluxo obrigatório de desenvolvimento,
os nove papéis que revisam cada decisão e os portões que bloqueiam merge.
