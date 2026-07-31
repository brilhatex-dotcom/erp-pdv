# ADR-0021 — Contingência do PDV em arquivo, não em SQLite

| Campo | Valor |
|---|---|
| **Status** | Aceito |
| **Data** | 31/07/2026 |
| **Decisores** | Responsável pelo produto · Arquiteto · DevOps · DBA PostgreSQL · Dev Sênior |
| **Supersede** | A linha "Cache de contingência do PDV → SQLite embarcado no Electron" de `CLAUDE.md` §5 e de `ARQUITETURA.md` §12.2 |

## Contexto

O PDV precisa continuar vendendo com o servidor da loja fora do ar. Para isso a
estação guarda localmente o catálogo replicado, a fila de vendas pendentes e as
últimas vendas para reimpressão (`ARQUITETURA.md` §12.2).

A escolha original foi SQLite embarcado. Ela foi tomada antes de a Etapa 9a
estabelecer um critério que a contradiz.

Na 9a, ao escolher como falar com a impressora, o produto recusou biblioteca
nativa com o argumento de que **instalador que compila na máquina do cliente é
instalador que falha na máquina do cliente**, e que cada falha vira um chamado
multiplicado pela base instalada — o custo de suporte é o critério econômico
dominante (`CLAUDE.md` §2).

SQLite no Electron cai exatamente nesse caso. `better-sqlite3` é módulo nativo e
precisa ser recompilado para a ABI do Electron (`electron-rebuild`) a cada
atualização do runtime. O `node:sqlite` embutido resolveria, mas exige Node 22.5
ou superior, e o Electron 33 embarca Node 20.

## A conta, com os volumes reais

| Necessidade | Volume (§12.2) | O que SQLite dá | O que arquivo dá |
|---|---|---|---|
| Fila de vendas pendentes | dezenas | Transação ACID | Append-only com `fsync` — durável, e legível por qualquer pessoa no suporte |
| Catálogo replicado | ~50 mil SKUs | Consulta indexada | `Map` por código e por SKU: O(1), ~15 MB de memória, carga abaixo de 1 s |
| Últimas 500 vendas | 500 registros | Consulta | Leitura direta |

SQLite ganharia com centenas de milhares de SKUs, consulta com junção ou
concorrência de escrita entre processos. **Nenhum dos três é o caso**: uma
estação de PDV tem um processo, um catálogo que cabe na memória e uma fila que
raramente passa de dezenas de itens.

## Decisão

A contingência do PDV usa **arquivos no diretório de dados da estação**:

- **Fila de vendas** — arquivo append-only, uma venda por linha (NDJSON), gravado
  com `fsync` antes de o operador receber a confirmação. Append-only é o mesmo
  princípio do estoque e do caixa (`CLAUDE.md` §4, princípio 5): a venda gravada
  é fato, e a confirmação de sincronização é outro fato, não uma sobrescrita.
- **Catálogo replicado** — arquivo JSON, carregado para um índice em memória na
  abertura do caixa e atualizado incrementalmente.
- **Últimas vendas** — derivadas da fila e do que já sincronizou.

## Consequências

**A favor**

- Zero dependência nativa no PDV. O instalador copia arquivos e pronto — não
  compila, não depende de toolchain, não quebra quando o Electron sobe de versão.
- Arquivo de fila legível em qualquer editor. No suporte remoto, isso é a
  diferença entre "me manda o arquivo" e "instala uma ferramenta para abrir o
  banco".
- Corrupção fica contida: uma linha ilegível na fila descarta aquela linha, e não
  o arquivo. Banco corrompido costuma perder tudo.

**Contra**

- Consulta ao catálogo é por índice em memória; consulta que não estava prevista
  exige escrever o índice. Aceito: as consultas do balcão são por código de
  barras, SKU e prefixo de descrição, e as três estão previstas.
- O catálogo inteiro fica em memória (~15 MB). Irrelevante para uma estação de
  balcão, e explicitamente reavaliável se algum cliente passar de 200 mil SKUs.
- A leitura da fila é sequencial. Com dezenas de itens é instantâneo; se a fila
  crescer para milhares, vira O(n) na abertura. **Gatilho de revisão desta ADR:**
  fila que passe de 5.000 vendas pendentes ou catálogo acima de 200 mil SKUs.

**Neutras**

- O PostgreSQL do servidor continua sendo o único sistema de registro (ADR-0013).
  Nada aqui muda isso: a estação guarda cópia e fila, nunca a verdade.

## Alternativas consideradas

| Alternativa | Por que não |
|---|---|
| `better-sqlite3` | Módulo nativo recompilado por ABI. Reintroduz no instalador o risco que a Etapa 9a removeu da impressora |
| Subir para Electron 38+ e usar `node:sqlite` | Resolve a dependência nativa, mas troca um risco conhecido por outro: módulo marcado como experimental e salto de cinco versões maiores do runtime, sem necessidade que o justifique |
| IndexedDB no renderizador | Lento com 50 mil registros (§5.2.2), e põe dado durável do lado que não deveria ter acesso durável |
| Não ter contingência | O PDV pararia junto com o servidor. Viola o princípio 1 |

## Como reverter

Voltar a SQLite exige: uma migração que leia os arquivos existentes e os importe,
e a volta do `electron-rebuild` ao processo de empacotamento. O gatilho que
justificaria isso está declarado acima — volume, não preferência.
