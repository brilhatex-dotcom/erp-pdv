# ESTADO — onde o projeto está agora

> **Leia este arquivo primeiro.** Ele existe para que qualquer sessão nova de
> desenvolvimento continue de onde a anterior parou, sem reimplementar o que já existe.
>
> Última atualização: **31/07/2026** · Ramo de referência: **`main`**
>
> ⚠️ **Há trabalho em andamento fora de `main`**: branch
> `claude/sessao-recomendacao-continuacao-tsx6ew`. Ver §2.0 antes de qualquer coisa.

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

**1.296 testes passando.** Todos os portões do `CLAUDE.md` §7 verdes.

Verificação completa em um comando:

```bash
pnpm verify     # format:check + lint + typecheck + arch + test:cov + audit --prod
```

> Exige o PostgreSQL de teste no ar: `pnpm db:up`.

---

## 2. O que falta — em ordem de risco crescente

### 2.0 ⏸️ EM ANDAMENTO — cadastros de categoria, cliente e fornecedor

**Branch: `claude/sessao-recomendacao-continuacao-tsx6ew`.** A sessão parou por limite de
uso, não por problema técnico. **Continue nesta branch**, não recomece do zero.

#### O que já está pronto e commitado (commit `745042b`)

| Camada | Situação | Onde |
|---|---|---|
| Objetos de valor: `Documento`, `Endereco`, `Telefone`, `Email`, `InscricaoEstadual`, `UF` | ✅ 100% de cobertura | `packages/domain/src/valores/` |
| Agregados `Categoria`, `Cliente`, `Fornecedor` | ✅ 100% de cobertura | `packages/domain/src/cadastros/` |
| Portas `CategoriaRepository`, `ClienteRepository`, `FornecedorRepository` | ✅ | `packages/application/src/portas/repositorios/RepositoriosCadastros.ts` |
| 6 casos de uso (Cadastrar/Alterar × 3) | ✅ 100% de cobertura | `packages/application/src/casos-de-uso/cadastros/` |
| `agregarErros` — leva a lista de campos errados até a fronteira | ✅ | `packages/application/src/erros/agregarErros.ts` |
| Dublês em memória dos três repositórios | ✅ | `packages/application/src/testes/dubles.ts` |
| `textoOpcional` em `@erp/utils` | ✅ | `packages/utils/src/texto.ts` |

Testes: **1.296 passando** (domínio 1.020 · aplicação 126 · demais inalterados).
`lint`, `typecheck` e `format` verdes nos pacotes tocados.

#### O que falta — nesta ordem

1. **Persistência** (`packages/database/`) — é o próximo passo, e o trabalho estava
   parado exatamente aqui:
   - Modelos Prisma `Categoria`, `Cliente`, `Fornecedor` no `schema.prisma`.
     Endereço **achatado** nas colunas do cliente/fornecedor (1:1, sempre lido junto —
     tabela separada só custaria um join).
   - `nome_busca` da categoria com **índice único**: é a garantia real contra
     "Bebidas" e "bebidas" virarem duas linhas no relatório. A verificação no caso de
     uso existe só para dar a mensagem certa; duas telas simultâneas passariam por ela.
   - Documento do cliente e do fornecedor com índice único (nulo permitido no cliente).
   - **Duas FKs que hoje faltam** (veto do DBA já identificado):
     `produtos.categoria_id → categorias.id` e `vendas.cliente_id → clientes.id`.
     ⚠️ Ao fechar a FK de vendas, `packages/database/src/testes/Persistencia.test.ts`
     (linha ~335) quebra: ele grava uma venda com `clienteId` que não existe em lugar
     nenhum. Cadastrar o cliente antes é a correção — não afrouxar a FK.
   - Mapeadores e repositórios Prisma, no padrão de `produtoMapeador.ts`.
   - Registrar os três em `montarRepositorios` (`UnitOfWorkPrisma.ts`) — sem isso
     o `Repositorios` não compila, porque a interface já os exige.
   - Acrescentar `categorias`, `clientes` e `fornecedores` ao `TRUNCATE` dos **dois**
     helpers de teste: `packages/database/src/testes/banco.ts` e
     `apps/server/src/testes/apoio.ts`.
2. **API** (`apps/server/src/rotas/cadastros.ts`) — GET de busca/listagem, POST e PATCH
   para os três. Exige permissões novas em `packages/domain/src/identidade/Permissao.ts`
   (`cliente:ver/criar/editar`, `fornecedor:ver/criar/editar`, `categoria:gerenciar`) e a
   distribuição delas em `papeisPadrao.ts`. Registrar em `servidor.ts`.
   Acrescentar `"erros"` à lista `DETALHES_PUBLICOS` de `apps/server/src/http/erros.ts`
   — sem isso o `DADOS_INVALIDOS` chega ao navegador sem os campos, e o formulário não
   tem o que destacar.
3. **Retaguarda** (`apps/web/src/telas/`) — lista + formulário para os três, mais
   navegação no `App.tsx` (hoje ele mostra só a consulta de produto). Atenção ao portão:
   a cobertura de `apps/web` mede `.tsx` **por arquivo**, mínimo de 90%.

#### Decisões desta etapa (já tomadas, não reabrir sem motivo novo)

- **Cliente e fornecedor são agregados separados**, não uma `Pessoa` com dois papéis.
  Divergem no que importa (limite de crédito × documento obrigatório); o que é comum vai
  para objetos de valor compartilhados, não para herança.
- **Categoria é plana.** Hierarquia é aditiva depois (coluna anulável) — decisão
  reversível pelo lado barato.
- **Fornecedor exige documento; cliente não.** Fornecedor sustenta entrada de mercadoria,
  e toda nota traz o CNPJ do emitente. No cliente, a LGPD pede minimização.
- **`AlterarX` recebe o estado completo**, não campos parciais. Caso de uso que trata
  ausente como "não mexer" torna impossível limpar um campo.
- **Unicidade de documento é verificada antes de mexer no agregado.** Verificar depois
  consulta um repositório onde o registro já carrega o documento novo, e ele encontra a
  si mesmo — passando batido justamente no caso que a regra existe para pegar.
- **Tipo de pessoa não muda** na alteração: invalidaria documento gravado e notas já
  emitidas. O caminho é desativar e cadastrar de novo.

### 2.1 Cadastros faltantes — risco baixo

Coberto por §2.0 acima, em andamento.

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
| **Dublê guarda referência, não cópia** | Teste de unicidade passa quando deveria falhar | O repositório em memória devolve a **mesma instância** que o caso de uso acabou de alterar. Verificação de duplicidade tem de vir **antes** da mutação — o que também é o certo contra o banco de verdade |
| **`unbound-method` em fábrica de objeto de valor** | Lint reprova `interpretarOpcional(x, Telefone.criar, erros)` | Passar método estático solto desassocia o `this`. Embrulhe: `(valor) => Telefone.criar(valor)` |
| **`/* v8 ignore next */` cobre uma linha só** | Guarda inalcançável de 3 linhas reprova a cobertura | Use `/* v8 ignore next 3 */` quando o `if` inalcançável tem corpo |

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
