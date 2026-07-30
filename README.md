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
| **Etapa 1 — Domínio** | ✅ **Concluída** — objetos de valor, 255 testes, 100% de cobertura |
| Etapa 2 — Agregados e schema | ⬜ Próxima |

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
  adr/                  decisões arquiteturais registradas
CLAUDE.md      diretrizes permanentes: papéis, fluxo e padrões
```

## Arquitetura em uma página

- **Local-first.** Uma máquina hospeda o servidor; as estações acessam pela rede local.
  O PDV continua vendendo sem internet e mesmo sem o servidor.
- **Hexagonal.** `@erp/domain` não conhece banco, HTTP nem UI — e o CI **impede** que
  passe a conhecer.
- **PostgreSQL 17 único**, embarcado no instalador ([ADR-0013](docs/adr/0013-postgresql-unico-embarcado.md)).
- **Fiscal desacoplado.** NFC-e e NF-e entram como adapters, com contingência automática
  e preparação para a Reforma Tributária (CBS/IBS/IS).
- **Dinheiro em centavos**, sempre inteiro.

Detalhes em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

## Contribuindo

Leia [`CLAUDE.md`](CLAUDE.md) antes. Ele define o fluxo obrigatório de desenvolvimento,
os nove papéis que revisam cada decisão e os portões que bloqueiam merge.
