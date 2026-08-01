# ESTADO — onde o projeto está agora

> **Leia este arquivo primeiro.** Ele existe para que qualquer sessão nova de
> desenvolvimento continue de onde a anterior parou, sem reimplementar o que já existe.
>
> Última atualização: **01/08/2026** · Ramo de referência: **`main`**
>
> ✅ **Não há trabalho fora de `main`.** Uma única branch remota existe: `main`.

---

## 0. Regra de ouro para quem chega agora

**Tudo o que existe está em `main`.** Não há trabalho vivo em outra branch.

Se você é uma sessão nova:

```bash
git fetch origin main
git checkout -B claude/<nome-do-trabalho> origin/main
```

E ao terminar: commit → push → PR → merge em `main` → **apaga a branch**.

**Por que essa regra existe:** em 31/07/2026 duas sessões trabalharam em paralelo sem
saber uma da outra, porque `main` estava vazia e cada sessão criou sua própria branch.
As duas implementaram autenticação — o mesmo módulo, duas vezes, com modelos diferentes.
A unificação custou uma tarde. `main` sempre atualizada é o que impede a repetição.

---

## 1. O que já funciona

| Área | Situação | Onde está |
|---|---|---|
| Monorepo, CI, portões de qualidade | ✅ Completo | `turbo.json`, `.github/workflows/ci.yml` |
| Domínio — produto, estoque, venda, caixa | ✅ Completo | `packages/domain/src/` |
| Domínio — acesso (usuário, papel, permissão) | ✅ Completo | `packages/domain/src/acesso/` |
| Casos de uso | ✅ Completo | `packages/application/src/` |
| Persistência PostgreSQL + `UnitOfWork` | ✅ Completo | `packages/database/src/` |
| API HTTP (Fastify) com autenticação | ✅ Completo | `apps/server/src/rotas/` |
| Retaguarda web (React) | ✅ Completo | `apps/web/src/` |
| Design system | ✅ Completo | `packages/ui/src/` |
| Cliente HTTP + sessão compartilhados | ✅ Completo | `packages/cliente-api/src/` |
| **PDV — balcão, do primeiro bipe ao troco** | ✅ Completo | `apps/pdv/src/` |
| Cadastros — categoria, cliente, fornecedor | ✅ Completo, ponta a ponta | domínio → banco → API → telas |
| Cupom ESC/POS e gaveta | ✅ Completo, sem hardware nativo | `packages/printing/src/` |
| Pré-visualização e impressora virtual | ✅ Conferir o cupom sem impressora | `packages/printing/src/previsualizacao.ts`, `apps/pdv/src/ferramentas/` |
| Catálogo replicado na estação | ✅ `GET /api/catalogo/replica` → arquivo local | `packages/database/src/consultas/` |
| Casca Electron e ponte de hardware | ✅ Completo | `apps/pdv/` |
| **Contingência offline do PDV** | ✅ Completa, da fila à tela | `apps/pdv/src/principal/`, `vendaComQueda.ts` |
| **Caixa — abertura, sangria, suprimento e fechamento** | ✅ Completo, com contagem às cegas | `casos-de-uso/caixa/`, `rotas/caixa.ts`, `telas/Fechamento.tsx` |

**1.848 testes passando.** Todos os portões do `CLAUDE.md` §7 verdes (17 tarefas).

Verificação completa em um comando:

```bash
pnpm verify     # format:check + lint + typecheck + arch + test:cov + audit --prod
```

> Exige o PostgreSQL de teste no ar: `pnpm db:up`.

---

## 2. O que falta — em ordem de risco crescente

### 2.1 ⬅️ PRÓXIMO — retaguarda do caixa e relatório do dia

O caixa fecha, mas **ninguém consegue olhar o resultado depois**. Falta:

- **Consulta de sessões fechadas** na retaguarda: quem fechou, quando, e com que
  diferença. Hoje a conferência aparece uma vez na tela do PDV e some.
- **Relatório do dia**: vendas por forma de pagamento, sangrias e suprimentos.
- **Reabertura de caixa** (`caixa:reabrir` já existe como permissão, sem rota).

Nada disso é bloqueante para a loja operar — é o que o gerente precisa para
conferir o que aconteceu.

### 2.2 Fiscal — risco médio

Motor tributário e Outbox, testáveis contra um `ProvedorFiscal` falso, sem SEFAZ.
Muita regra de negócio, mas 100% verificável em máquina de desenvolvimento.
**Exige 100% de cobertura no motor tributário** (`CLAUDE.md` §7, sem exceção).
Ler antes: ADR-0015, ADR-0016 e `docs/fiscal/ARQUITETURA-FISCAL.md`.

### 2.3 Hardware — risco alto

Casca Electron, cupom ESC/POS e gaveta **já estão prontos** e testados por comparação
de bytes, sem depender de equipamento. Falta:

- **Balança** — protocolo por porta serial, e cada fabricante fala o seu.
- **Validação com equipamento real.** Nenhum cupom foi impresso em impressora física
  até hoje. Alinhamento de coluna e acentuação em CP860 só se confirmam no papel.

Não encerrar esta etapa sem uma impressora na mesa: o teste de bytes prova que o
comando está certo, não que a impressora daquele modelo o entende.

### 2.4 Instalador e operação — etapa 10

Instalador Windows com PostgreSQL embarcado, auto-update com rollback, backup
automático e verificação de saúde. É o que separa "roda aqui" de "o lojista instala".

---

## 3. Armadilhas já pagas — não caia de novo

Cada item abaixo custou tempo real. Estão aqui para não custar duas vezes.

| Armadilha | Como se manifesta | Regra |
|---|---|---|
| **Cobertura que não vê o arquivo** | Relatório verde, arquivo nunca medido | Todo `vitest.config.ts` precisa de `include: ["src/**/*.{ts,tsx}"]`. Ocorreu **três vezes** |
| **Helper de teste barrando o merge** | Cobertura reprova em `src/testes/**` | Excluir `src/testes/**` do `coverage` — helper com `VAR ?? padrão` tem ramo que só executa em outra máquina |
| **Turborepo apaga variável de ambiente** | Prisma falha com `self-signed certificate` | Modo estrito: variável não declarada não chega à tarefa. Suíte nova com banco próprio **declara a variável dela** em `turbo.json` |
| **`verify` divergir do CI** | Passa local, quebra no CI | `verify` roda exatamente o que o CI roda. Se o CI usa `test:cov`, `verify` também |
| **Dinheiro virando `double`** | Centavo somindo no fechamento | Dinheiro trafega como **texto** de inteiro (ADR-0019). `JSON.parse` transforma número em `double` |
| **CI rodando duas vezes** | 4 checks por push | Gatilho é `push:` puro. `push` + `pull_request` na mesma branch duplica |
| **Aviso de commit "Unverified"** | Hook aponta `8ba140f` | Falso positivo: é o merge commit do próprio GitHub. **Não reescrever** — está em `main` e exigiria force-push |
| **Dublê guarda referência, não cópia** | Teste de unicidade passa quando deveria falhar | O repositório em memória devolve a **mesma instância** que o caso de uso acabou de alterar. Verificação de duplicidade tem de vir **antes** da mutação — o que também é o certo contra o banco de verdade |
| **`unbound-method` em fábrica de objeto de valor** | Lint reprova `interpretarOpcional(x, Telefone.criar, erros)` | Passar método estático solto desassocia o `this`. Embrulhe: `(valor) => Telefone.criar(valor)` |
| **`/* v8 ignore next */` cobre uma linha só** | Guarda inalcançável de 3 linhas reprova a cobertura | Use `/* v8 ignore next 3 */` quando o `if` inalcançável tem corpo |
| **`.env` sumido em ambiente novo** | `P1012: Environment variable not found: DATABASE_URL` | O `.env` é ignorado pelo git e não sobrevive a um contêiner novo. Recrie: `cp packages/database/.env.example packages/database/.env` |
| **`prisma migrate dev` trava sem saída** | Comando fica parado; matá-lo deixa `P1002: timed out acquiring advisory lock` | `migrate dev` é **interativo** (pede nome da migração). Em sessão automatizada use `pnpm db:deploy`. Se já travou, mate o processo e derrube a conexão presa: `pg_terminate_backend` no banco |
| **`as CodigoUnidade` num dado de disco** | `Cannot read properties of undefined (reading 'fracionavel')` no meio da bipada | O domínio procura a unidade numa tabela. Afirmar o tipo sem checar troca recusa clara por tela branca — use `ehCodigoUnidade` antes |
| **`BigInt(texto)` de arquivo externo** | Exceção não tratada em vez de recusa | `BigInt("abc")` **lança**. Todo centavo lido de disco ou rede passa por `/^\d+$/` antes |
| **Variável de cancelamento em laço com `await`** | Lint acusa "value is always falsy" na segunda verificação | O compilador analisa a função de parada antes de ela existir. Leia por função (`const foiCancelado = () => cancelado`) |
| **Só o teste do pacote conta para a cobertura dele** | Consulta exercitada pelo servidor reprova em `packages/database` | Cobertura é medida por pacote. Código novo em `packages/` precisa de teste **naquele** pacote |
| **Docker morre no reinício do contêiner** | `P1001: Can't reach database server` e testes pulados em silêncio | `nohup dockerd > /tmp/dockerd.log 2>&1 &` e `docker compose up -d`. Suíte que não alcança o banco é **pulada**, não reprovada — verde enganoso |
| **`corpos[0]` capturando a chamada errada** | Teste "não chamou nada" falha sem motivo aparente | `ProvedorSessao` consulta `/api/acesso/eu` ao montar. Filtre o dublê de `fetch` pela rota que interessa |
| **403 confundido com 401** | Cliente tenta renovar token e joga o operador no login | Sem token é **401**; sem alçada é **403**. Trocar faz o operador achar que a sessão caiu |

---

## 4. Decisões que não se reabrem sem ADR

Resumo; a fonte é `CLAUDE.md` §5 e `docs/adr/`.

- PostgreSQL 17 único, embarcado no instalador — **sem SQLite como sistema de registro**
  (ADR-0013). A contingência do PDV é **arquivo append-only, não SQLite** (ADR-0021).
- `@erp/cliente-api` é compartilhado entre retaguarda e PDV (ADR-0020).
- Fiscal via **provedor externo** atrás da porta `ProvedorFiscal`; o ERP nunca fala com
  SEFAZ nem conhece o fornecedor (ADR-0015).
- Módulo fiscal **opcional por empresa**, via Null Object. O domínio não tem
  `if (fiscalHabilitado)` (ADR-0016).
- Escopo é **varejo apenas**. Serviços, Ordem de Serviço e NFS-e estão **fora**
  (ADR-0014). Emite só NFC-e (65) e NF-e (55).
- Um papel por usuário (ADR-0018). PIN no PDV, senha forte na retaguarda (ADR-0011).
- **Sem a permissão base, limite não se discute**: o operador de caixa não sangra
  a gaveta nem com supervisor ao lado — ele **chama** o supervisor, que executa com
  a própria conta. A escalação por supervisor só vale para quem tem a permissão e
  estoura o teto de valor (`PoliticaAutorizacao`).
- **A contagem do fechamento é às cegas.** Nem a tela nem a API entregam o esperado
  em dinheiro antes de o operador contar — conferência com a resposta à vista não
  detecta falta nenhuma.
- Dinheiro em centavos `bigint` (ADR-0009). Quantidade em milésimos. Percentual em
  centésimos de por cento — 5% é `500`.

---

## 5. Ambiente de desenvolvimento

```bash
pnpm install
cp packages/database/.env.example packages/database/.env   # não vem do git
pnpm db:up          # PostgreSQL 17 na porta 55432 (três bancos)
pnpm db:deploy      # aplica migrações; `db:migrate` é interativo, ver §3
pnpm verify         # suíte completa

pnpm --filter @erp/server dev   # API   → 3000
pnpm --filter @erp/web dev      # web   → 5173
pnpm --filter @erp/pdv dev      # PDV   → 5174
```

**Se o Docker estiver morto** (acontece após reinício do contêiner):

```bash
nohup dockerd > /tmp/dockerd.log 2>&1 &
sleep 5 && docker compose up -d
```

**Se o `docker compose up` não conseguir baixar a imagem** (aconteceu em 31/07/2026:
o proxy de saída recusou `production.cloudfront.docker.com` com 403), há um PostgreSQL
instalado no próprio contêiner. Serve para rodar a suíte, com a ressalva de ser a
versão **16**, e não a 17 do ADR-0013 — divergência aceitável para desenvolvimento,
nunca para validar migração antes de release:

```bash
pg_ctlcluster 16 main start
su postgres -c "psql -c \"ALTER SYSTEM SET port = 55432;\""
pg_ctlcluster 16 main restart
su postgres -c "psql -p 55432 -c \"CREATE USER erp WITH PASSWORD 'erp_dev_only' SUPERUSER;\""
su postgres -c "psql -p 55432 -c 'CREATE DATABASE erp_pdv OWNER erp;' \
  -c 'CREATE DATABASE erp_teste OWNER erp;' -c 'CREATE DATABASE erp_teste_api OWNER erp;'"
DATABASE_URL="postgresql://erp:erp_dev_only@localhost:55432/erp_pdv" pnpm db:deploy
```

---

## 6. Ordem de leitura para entrar no projeto

1. `CLAUDE.md` — diretrizes permanentes. **Prevalece sobre qualquer outra coisa.**
2. Este arquivo — onde o trabalho parou.
3. `docs/ARQUITETURA.md` — fonte da verdade técnica.
4. `docs/adr/README.md` — por que cada decisão foi tomada.

> **Manter este arquivo atualizado é parte da etapa 9 do fluxo** (`CLAUDE.md` §3:
> "Documentar a etapa"). Uma sessão que avança e não atualiza o `ESTADO.md` recria
> exatamente o problema que ele existe para evitar.

### Isto já aconteceu — atualize ao final de cada etapa, não só ao parar

Em 31/07 uma sessão escreveu aqui "trabalho em andamento na branch X, 1.296 testes" e
seguiu por mais oito commits sem voltar. No dia seguinte a branch não existia mais, eram
1.714 testes, e três itens listados como pendentes já estavam prontos — persistência, API
e telas dos cadastros. Quem lesse refaria trabalho concluído.

**Documento desatualizado engana com a autoridade de estar no lugar certo.** O `README.md`
sobreviveu porque foi atualizado a cada etapa; este arquivo não foi. A regra prática:
o commit que conclui uma etapa é o mesmo commit que atualiza o `ESTADO.md`.
