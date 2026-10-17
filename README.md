# ERP + PDV

Sistema ERP com PDV (Ponto de Venda) para pequenos e médios estabelecimentos
brasileiros: mercadinhos, padarias, mercearias, casas de construção, autopeças,
lojas de conveniência, depósitos, açougues e hortifrutis.

**Escopo: varejo — venda de mercadoria.** Prestação de serviços está fora do produto
([ADR-0014](docs/adr/0014-escopo-varejo-apenas.md)).

## Estado atual

> **Continuando o desenvolvimento? Leia [`ESTADO.md`](ESTADO.md) primeiro.** Ele diz
> onde o trabalho parou, o que vem em seguida, quais armadilhas já foram pagas — e,
> na §0.1, se há trabalho vivo fora de `main`.

**A V1 do balcão está pronta** para padaria, mercadinho, frutaria e loja mista: venda
por unidade e por peso (com a etiqueta da balança), pagamento misto, troco, fiado,
desconto com liberação do supervisor, cancelamento e devolução, abertura e fechamento
de caixa às cegas, venda sem servidor, cópias de segurança provadas por restauração e
um modo treinamento num banco separado. Os detalhes — o que foi entregue, **como foi
testado**, o que depende de integração externa e as limitações conhecidas — estão em
[`docs/ENTREGA-V1.md`](docs/ENTREGA-V1.md).

| Área | Situação |
|---|---|
| Balcão (PDV), caixa, pagamentos | ✅ Pronto — a venda inteira pelo teclado |
| Cadastros, estoque, compras, financeiro (fiado e despesas) | ✅ Pronto |
| Cópias de segurança e restauração | ✅ Pronto ([ADR-0027](docs/adr/0027-copias-de-seguranca-da-v1.md)) |
| Modo treinamento | ✅ Pronto ([ADR-0026](docs/adr/0026-modo-treinamento-em-banco-separado.md)) |
| Instalador Windows | ⚠️ Gera o `.exe` no CI; ainda não instalado numa máquina Windows |
| Relatórios de vendas e painel | ⬜ Só a conferência dos caixas |
| Fiscal (NFC-e) | ⬜ Provedor simulado ([ADR-0022](docs/adr/0022-fiscal-fora-do-caminho-critico.md)) — **não serve para a loja operar legalmente** |

### Para quem vai usar

| Para | Leia |
|---|---|
| Instalar na loja | [`docs/operacao/INSTALACAO.md`](docs/operacao/INSTALACAO.md) |
| Configurar a loja depois de instalar | [`docs/operacao/PRIMEIROS-PASSOS.md`](docs/operacao/PRIMEIROS-PASSOS.md) |
| Operar o caixa | [`docs/operacao/MANUAL-DO-OPERADOR.md`](docs/operacao/MANUAL-DO-OPERADOR.md) |
| Cópias de segurança e restauração | [`docs/operacao/BACKUP.md`](docs/operacao/BACKUP.md) |
| Testar a tela com um operador novo | [`docs/operacao/ROTEIRO-DE-USABILIDADE.md`](docs/operacao/ROTEIRO-DE-USABILIDADE.md) |

## Requisitos

- **Node.js 22+** (ver `.nvmrc`)
- **pnpm 10+** — `corepack enable && corepack prepare pnpm@latest --activate`
- **Docker** — apenas para o PostgreSQL de desenvolvimento

## Começando

```bash
pnpm install          # instala as dependências do monorepo
cp packages/database/.env.example packages/database/.env   # não vem do git
pnpm db:up            # sobe o PostgreSQL 17 (porta 55432)
pnpm db:deploy        # aplica as migrações no banco de desenvolvimento
pnpm verify           # roda TODOS os portões de qualidade
```

### Usar o sistema na sua máquina

```bash
# O banco do treino: o mesmo PostgreSQL, outro banco (o `deploy` o cria).
DATABASE_URL=postgresql://erp:erp_dev_only@localhost:55432/erp_pdv_treino pnpm db:deploy

pnpm build            # servidor, PDV e retaguarda

DATABASE_URL=postgresql://erp:erp_dev_only@localhost:55432/erp_pdv \
DATABASE_URL_TREINAMENTO=postgresql://erp:erp_dev_only@localhost:55432/erp_pdv_treino \
SEGREDO_TOKEN=$(openssl rand -hex 32) \
PASTA_PDV=$PWD/apps/pdv/dist PASTA_RETAGUARDA=$PWD/apps/web/dist \
pnpm --filter @erp/server start
```

Abra a retaguarda em `http://localhost:3000/retaguarda/` — o primeiro acesso cria o
administrador — e o caixa em `http://localhost:3000/`. O caminho dali em diante está
em [`docs/operacao/PRIMEIROS-PASSOS.md`](docs/operacao/PRIMEIROS-PASSOS.md); para só
experimentar o caixa, use **Treinar, sem valer de verdade** na entrada dele: a loja de
demonstração vem pronta.

Para mexer na tela com recarga a quente, suba o servidor sem as `PASTA_*` e use
`pnpm --filter @erp/pdv dev` (`localhost:5174`) e `pnpm --filter @erp/web dev`
(`localhost:5173`): os dois repassam a API para a porta 3000.

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
| `pnpm e2e` | O caixa no Chromium, contra o servidor e o banco de verdade |
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
  agente-contrato/ contrato HTTP entre a tela do PDV e o Agente Local
apps/
  server/      API HTTP: composição, autenticação, autorização e rotas
  web/         retaguarda: SPA React + Vite
  pdv/         frente de caixa: PWA, venda por teclado (React + Vite)
  agente/      Agente Local da estação: impressão, fila offline e catálogo
  quiosque/    casca Electron opcional, tela cheia, sem lógica
  instalador/  instalador Windows: segredos, banco, migrações e verificação
  e2e/         o caixa no navegador de verdade (Playwright)
docs/
  ARQUITETURA.md        arquitetura completa (fonte da verdade técnica)
  ANALISE-SEGMENTOS.md  requisitos por segmento e impacto no domínio
  ENTREGA-V1.md         o que a V1 entrega, como foi testado e o que falta
  operacao/             instalação, primeiros passos, manual, backup, usabilidade
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
