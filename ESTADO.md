# ESTADO — onde o projeto está agora

> **Leia este arquivo primeiro.** Ele existe para que qualquer sessão nova de
> desenvolvimento continue de onde a anterior parou, sem reimplementar o que já existe.
>
> Última atualização: **31/07/2026** · Ramo de referência: **`main`**

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
| **PDV — balcão, do primeiro bipe ao troco** | ✅ Completo (navegador) | `apps/pdv/src/` |

**1.243 testes passando.** Todos os portões do `CLAUDE.md` §7 verdes.

Verificação completa em um comando:

```bash
pnpm verify     # format:check + lint + typecheck + arch + test:cov + audit --prod
```

> Exige o PostgreSQL de teste no ar: `pnpm db:up`.

---

## 2. O que falta — em ordem de risco crescente

### 2.1 Cadastros faltantes — risco baixo (recomendado como próximo passo)

Cliente, fornecedor e categoria. Mesmo padrão dos cadastros que já funcionam; nenhuma
dependência externa. É a última peça para a loja operar de ponta a ponta sem nota fiscal.

### 2.2 Fiscal — risco médio

Motor tributário e Outbox, testáveis contra um `ProvedorFiscal` falso, sem SEFAZ.
Muita regra de negócio, mas 100% verificável em máquina de desenvolvimento.
**Exige 100% de cobertura no motor tributário** (`CLAUDE.md` §7, sem exceção).
Ler antes: ADR-0015, ADR-0016 e `docs/fiscal/ARQUITETURA-FISCAL.md`.

### 2.3 Hardware — risco alto

Electron, impressão ESC/POS, gaveta e balança. É a etapa com mais incógnitas: só se
valida de verdade com equipamento real na mesa. Não começar sem hardware disponível.

### 2.4 Pendências fora do código

Estas dependem de ação humana no navegador, não de desenvolvimento:

- [ ] Apagar as branches `claude/*` já mescladas em `main`.
- [ ] Proteger `main`: **Settings → Branches → Add rule**, marcar
      *Require status checks to pass* e escolher **Segurança** e **Qualidade**.
      Sem isso, código quebrado consegue entrar em `main`.

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

---

## 4. Decisões que não se reabrem sem ADR

Resumo; a fonte é `CLAUDE.md` §5 e `docs/adr/`.

- PostgreSQL 17 único, embarcado no instalador — **sem SQLite como sistema de registro**
  (ADR-0013). SQLite existe apenas como cache de contingência do PDV.
- Fiscal via **provedor externo** atrás da porta `ProvedorFiscal`; o ERP nunca fala com
  SEFAZ nem conhece o fornecedor (ADR-0015).
- Módulo fiscal **opcional por empresa**, via Null Object. O domínio não tem
  `if (fiscalHabilitado)` (ADR-0016).
- Escopo é **varejo apenas**. Serviços, Ordem de Serviço e NFS-e estão **fora**
  (ADR-0014). Emite só NFC-e (65) e NF-e (55).
- Um papel por usuário (ADR-0018). PIN no PDV, senha forte na retaguarda (ADR-0011).
- Dinheiro em centavos `bigint` (ADR-0009). Quantidade em milésimos. Percentual em
  centésimos de por cento — 5% é `500`.

---

## 5. Ambiente de desenvolvimento

```bash
pnpm install
pnpm db:up          # PostgreSQL 17 na porta 55432 (três bancos)
pnpm db:migrate
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

---

## 6. Ordem de leitura para entrar no projeto

1. `CLAUDE.md` — diretrizes permanentes. **Prevalece sobre qualquer outra coisa.**
2. Este arquivo — onde o trabalho parou.
3. `docs/ARQUITETURA.md` — fonte da verdade técnica.
4. `docs/adr/README.md` — por que cada decisão foi tomada.

> **Manter este arquivo atualizado é parte da etapa 9 do fluxo** (`CLAUDE.md` §3:
> "Documentar a etapa"). Uma sessão que avança e não atualiza o `ESTADO.md` recria
> exatamente o problema que ele existe para evitar.
