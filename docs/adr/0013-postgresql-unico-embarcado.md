# ADR-0013 — PostgreSQL único, embarcado no instalador

| Campo | Valor |
|---|---|
| **Status** | Aceito — supersede o ADR-0002 |
| **Data** | 30/07/2026 |
| **Decisores** | DBA PostgreSQL · QA · DevOps · Segurança · Analista de Negócios · Arquiteto |

## Contexto

O ADR-0002 estabeleceu SQLite como banco padrão, com PostgreSQL disponível como
caminho de crescimento. A justificativa era dimensional e **continua correta**:

- 2.000 vendas/dia equivalem a ~0,03 escritas por segundo de pico real
- Base projetada em 5 anos: ~4 GB
- 1 a 3 clientes concorrentes

Ou seja: o SQLite aguenta a carga com folga. O problema não é capacidade.

Na revisão conjunta com o comitê completo (`CLAUDE.md` §1), ficou claro que a
**pergunta usada para decidir estava errada**. A pergunta relevante não é *"o SQLite
aguenta?"*, e sim *"qual banco entrega o menor custo total na vida de um produto
comercial vendido para muitos clientes?"*.

Com a pergunta corrigida, três papéis apresentaram veto bloqueante.

## Decisão

**PostgreSQL 17 é o único banco de dados do sistema**, embarcado no instalador e
executado como serviço local autoconfigurado. Não há suporte a SQLite como sistema
de registro.

O SQLite permanece no projeto **apenas** como cache de contingência do PDV (catálogo
replicado e fila de vendas offline), que não é sistema de registro, é descartável e
reconstruível a partir do servidor, e não compartilha migrations com o domínio.

## Alternativas consideradas

### A. Manter SQLite como padrão, Postgres opcional (ADR-0002) — rejeitada

| Papel | Objeção |
|---|---|
| **QA** | A suíte de testes rodaria em SQLite enquanto o cliente usa Postgres. Diferenças de tipo, tratamento de `NULL` em índice único, ordenação e nível de isolamento geram defeito que **só aparece em produção** — a categoria de bug mais cara que existe |
| **DevOps** | Dois bancos exigem duas históricas de migration no Prisma e matriz dupla de CI. O drift entre elas é questão de tempo, e cada divergência é silenciosa até falhar |
| **Negócios** | Migrar depois custa **por cliente**, multiplicado pela base instalada, e cada migração é uma janela de risco de perda de dados |
| **Segurança** | Arquivo único, copiável integralmente por qualquer processo com acesso ao disco |
| **DBA** | Sem roles, sem PITR, `ALTER TABLE` limitado — o Prisma contorna reconstruindo a tabela inteira, o que é arriscado em base grande |

### B. SQLite definitivo, sem Postgres — rejeitada

Fecharia o caminho para multi-loja e nuvem sem migração futura, contrariando o
objetivo declarado de crescer sem reescrita.

### C. PostgreSQL exigindo instalação separada pelo cliente — rejeitada

Transferiria ao usuário final — sem equipe de TI — a instalação de um serviço, a
configuração de `pg_hba.conf` e a gestão de usuários. Cada um desses passos é um
chamado de suporte, e o custo de suporte é o critério econômico dominante
(`CLAUDE.md` §2).

## Consequências

### Positivas

- **Paridade exata entre desenvolvimento, teste e produção.** Elimina a classe de bug
  que só aparece no cliente.
- **Uma única história de migration.** Sem drift, sem matriz dupla de CI.
- **PITR (Point-in-Time Recovery)** por WAL archiving contínuo: o RPO cai de 15 minutos
  para **próximo de zero**. É possível restaurar para as 14h59 se algo for apagado às
  15h, sem perder o movimento da manhã. Este ganho não estava previsto e é significativo.
- **Segurança real de acesso:** usuário dedicado com permissão mínima, sem superusuário
  para a aplicação.
- **Migrar para nuvem passa a ser trocar a string de conexão.**
- Ferramental maduro de diagnóstico (`EXPLAIN`, `pg_stat_statements`) para suporte remoto.

### Negativas — custos aceitos conscientemente

- **Instalador ~200 MB maior** e instalação ~3 minutos mais longa.
- **Um processo a mais** rodando na máquina do cliente (~150 MB de RAM com o perfil
  conservador definido).
- **Engenharia adicional no instalador**: embarcar binários, criar o serviço, gerar
  configuração e senha. Custo pago **uma vez**, não por cliente.
- Requer manutenção de banco (autovacuum, monitoramento de bloat) — automatizada em
  `ManutencaoBanco.job`, invisível ao usuário.

### Neutras

- Prisma continua sendo o ORM; muda o `provider`.
- O domínio, os casos de uso e a UI não são afetados — a arquitetura hexagonal isolou
  a mudança na camada de infraestrutura, exatamente como previsto.

## Como reverter

Esta decisão só deveria ser revista se o perfil do produto mudar radicalmente — por
exemplo, se passar a ser distribuído como aplicativo mono-usuário sem servidor, em
hardware muito restrito. Nesse cenário, a reversão exigiria: novo provider Prisma,
história de migration separada e reavaliação completa da estratégia de backup, já que
o PITR deixaria de existir.
