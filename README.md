# ERP + PDV

Sistema ERP com PDV (Ponto de Venda) para pequenos e médios estabelecimentos
brasileiros: mercadinhos, padarias, mercearias, casas de construção, autopeças,
lojas de conveniência, depósitos, açougues e hortifrutis.

**Escopo: varejo — venda de mercadoria.** Prestação de serviços está fora do produto
([ADR-0014](docs/adr/0014-escopo-varejo-apenas.md)).

## Estado atual

> **Continuando o desenvolvimento? Leia [`ESTADO.md`](ESTADO.md) primeiro.** Ele diz
> onde o trabalho parou, o que vem em seguida e quais armadilhas já foram pagas.
> Todo o código vivo está em `main` — não há trabalho em outra branch.

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
| **Etapa 4 — Aplicação** | ✅ **Concluída** — portas e fluxo de venda ponta a ponta. 772 testes |
| **Etapa 5 — Persistência** | ✅ **Concluída** — Prisma, migrações, repositórios e `UnitOfWork` transacional. 797 testes, 43 deles contra PostgreSQL real |
| **Etapa 6a — Identidade** | ✅ **Concluída** — usuário, papéis, permissões, limites por valor e bloqueio progressivo. 859 testes |
| **Etapa 6b — Servidor HTTP** | ✅ **Concluída** — Fastify, container, login com Argon2id, sessão rotativa e autorização no servidor. 1.121 testes |
| **Etapa 7a — Design system e retaguarda** | ✅ **Concluída** — tokens calibrados para o balcão, primitivos acessíveis, login e consulta de produto. 1.187 testes |
| **Etapa 7b — Rotas de venda** | ✅ **Concluída** — carrinho, pagamento e fechamento pela API, com o operador vindo do token. 1.219 testes |
| **Etapa 7c — `@erp/cliente-api`** | ✅ **Concluída** — cliente HTTP e sessão extraídos de `apps/web` para o PDV reusar. 1.223 testes |
| **Etapa 8 — PDV: tela de venda** | ✅ **Concluída** — bipagem, carrinho, pagamento e troco, a venda inteira sem mouse. 1.243 testes |
| **Etapa 8b — Correções e persistência dos cadastros** | ✅ **Concluída** — login do balcão, abertura de caixa, e categoria/cliente/fornecedor no Postgres. 1.490 testes |
| **Etapa 8c — Cadastros ponta a ponta** | ✅ **Concluída** — rotas HTTP, permissões e tela de clientes na retaguarda. 1.537 testes |
| **Etapa 8d — Fornecedores e categorias** | ✅ **Concluída** — as três telas de cadastro, com abas por permissão. 1.555 testes |
| **Etapa 9a — Cupom, gaveta e casca Electron** | ✅ **Concluída** — `@erp/printing`, ponte de hardware e impressão que nunca trava a venda. 1.647 testes |
| **Etapa 9b — PDV offline** | ✅ **Concluída** — fila durável, catálogo replicado, sincronização idempotente e rota de caixa. 1.714 testes |
| **Etapa 9c — Contingência na tela** | ✅ **Concluída** — indicador, venda pela fila, catálogo replicado e sincronização automática |
| **Ferramentas de impressão sem hardware** | ✅ **Concluídas** — pré-visualização do cupom e impressora virtual na porta 9100 |
| **Etapa 9d — Fechamento de caixa** | ✅ **Concluída** — sangria com alçada, suprimento e conferência às cegas |
| **Etapa 9e — Conferência dos caixas** | ✅ **Concluída** — sessões do período com divergência recalculada, na retaguarda |
| **Estratégia revista em 01/08/2026** | 🧭 Fiscal **fora do caminho crítico** ([ADR-0022](docs/adr/0022-fiscal-fora-do-caminho-critico.md)) · PDV vira **PWA + Agente Local** ([ADR-0023](docs/adr/0023-pdv-como-pwa-com-agente-local.md)) · **uma empresa por instalação** ([ADR-0024](docs/adr/0024-uma-empresa-por-instalacao.md)) |
| Próximo — Empresa e Agente Local | ⬜ Ver [`ESTADO.md`](ESTADO.md) §2.1 |
| Depois — Compras, Financeiro, Dashboard, Backup, Instalador, PWA, drivers por marca | ⬜ Ordem em [`ESTADO.md`](ESTADO.md) §2.2 |
| Por último — Fiscal com provedor real | ⬜ Até lá, `ProvedorFiscalSimulado` |

## Requisitos

- **Node.js 22+** (ver `.nvmrc`)
- **pnpm 10+** — `corepack enable && corepack prepare pnpm@latest --activate`
- **Docker** — apenas para o PostgreSQL de desenvolvimento

## Começando

```bash
pnpm install          # instala as dependências do monorepo
pnpm db:up            # sobe o PostgreSQL 17 (porta 55432)
pnpm db:migrate       # aplica as migrações no banco de desenvolvimento
pnpm verify           # roda TODOS os portões de qualidade
```

O `db:up` cria três bancos: `erp_pdv` para desenvolvimento, `erp_teste` para a
suíte de persistência e `erp_teste_api` para a do servidor. São separados de
propósito — os testes truncam as tabelas entre casos. Um só banco apagaria o
cadastro que você estava usando para conferir algo na tela, e as duas suítes,
que o Turbo roda em paralelo, derrubariam os dados uma da outra.

`pnpm verify` executa, em ordem: formatação → lint → tipagem → **regras de
arquitetura** → testes **com cobertura** → auditoria das dependências de
produção. É o mesmo conjunto que o CI aplica, com os mesmos comandos — se passar
localmente, passa no CI.

> A cobertura faz parte do `verify` de propósito. Rodar `pnpm test` localmente e
> `pnpm test:cov` no CI parece equivalente e não é: o provedor de cobertura tem
> dependências próprias, e já houve uma quebra que só aparecia com `--coverage`.

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
| `pnpm db:migrate` | Cria e aplica migrações a partir do schema Prisma |
| `pnpm db:deploy` | Aplica migrações já existentes (é o que roda na instalação) |
| `pnpm --filter @erp/server start` | Sobe a API (exige `SEGREDO_TOKEN` e `DATABASE_URL`) |
| `pnpm --filter @erp/web dev` | Abre a retaguarda em `localhost:5173` (proxy para a API) |
| `pnpm --filter @erp/pdv dev` | Abre o PDV em `localhost:5174` (proxy para a API) |

## Estrutura

```
packages/
  config/      configurações compartilhadas de TS, ESLint e Vitest
  utils/       validadores e formatadores puros (CPF, CNPJ, texto)
  domain/      núcleo de negócio puro — zero dependências de runtime
  application/ casos de uso e portas — não conhece banco, rede nem UI
  database/    adapter PostgreSQL: schema, migrações e repositórios Prisma
  cliente-api/ cliente HTTP e sessão, usados pela retaguarda e pelo PDV
  ui/          design system: tokens, componentes e estados de tela
  printing/    comandos ESC/POS e layout de cupom — puro, sem hardware
apps/
  server/      API HTTP: composição, autenticação, autorização e rotas
  web/         retaguarda: SPA React + Vite
  pdv/         frente de caixa: venda por teclado (React + Vite)
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
- **Dinheiro em centavos**, sempre inteiro — inclusive na fronteira HTTP, onde
  trafega como **texto**: `number` perde precisão antes do que se imagina.
- **Toda tela tem carregando, vazio e erro.** Não é acabamento: as três situações
  parecem iguais numa tela branca e exigem reações diferentes do operador.
- **Autorização sempre no servidor.** A interface esconde o que o usuário não pode
  fazer — isso é experiência, não segurança. Acima do limite, o sistema **pede
  supervisor** em vez de bloquear, e registra quem pediu e quem autorizou
  ([ADR-0018](docs/adr/0018-um-papel-por-usuario.md), `ARQUITETURA.md` §9).

Detalhes em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

## Contribuindo

Leia [`CLAUDE.md`](CLAUDE.md) antes. Ele define o fluxo obrigatório de desenvolvimento,
os nove papéis que revisam cada decisão e os portões que bloqueiam merge.
