-- Reversão da migração `balcao_completo`.
--
-- Como usar, numa instalação que precisa voltar à versão anterior:
--
--   1. backup antes de tudo (a tela de backup, ou `pg_dump`);
--   2. `psql -v ON_ERROR_STOP=1 -f reversao.sql` no banco da loja;
--   3. instalar a versão anterior.
--
-- O próprio script tira a migração de `_prisma_migrations`: `prisma migrate
-- resolve --rolled-back` só aceita migração que **falhou**, e esta foi aplicada
-- com sucesso. Sem apagar o registro, a versão anterior acharia que o banco
-- está à frente dela, e a próxima atualização não reaplicaria nada.
--
-- **O que se perde**: as devoluções, a auditoria, as imagens, a configuração da
-- loja e do backup, o histórico de backups, o custo congelado nos itens, a
-- confirmação e a chave dos pagamentos, e o registro de venda guardada e de
-- cancelamento. Vendas, itens, pagamentos, caixa e estoque continuam inteiros —
-- a versão anterior os lê como sempre leu.
--
-- **Quando a reversão recusa**: se já existir movimento de estoque com
-- `ESTORNO_VENDA` ou origem `DEVOLUCAO`. O PostgreSQL não remove valor de enum;
-- refazer o tipo exige que ninguém o use, e apagar movimento de estoque é o que
-- o princípio 5 proíbe. Nesse caso a saída é corrigir para a frente, não voltar.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "movimentos_estoque"
    WHERE "tipo" = 'ESTORNO_VENDA' OR "origem_tipo" = 'DEVOLUCAO'
  ) THEN
    RAISE EXCEPTION
      'Ha movimentos de estoque de cancelamento ou devolucao: a versao anterior nao sabe representa-los. Corrija para a frente em vez de reverter.';
  END IF;
END $$;

-- Permissões que a versão anterior não conhece. O papel da versão anterior
-- recusaria a permissão desconhecida ao ser editado na tela.
DELETE FROM "permissoes_papel"
WHERE "permissao" IN (
  'venda:remover_item',
  'venda:devolver',
  'venda:sem_estoque',
  'backup:executar',
  'auditoria:consultar'
);

DROP TRIGGER IF EXISTS "trg_registros_auditoria_imutavel" ON "registros_auditoria";
DROP TRIGGER IF EXISTS "trg_devolucao_itens_imutavel" ON "devolucao_itens";
DROP TRIGGER IF EXISTS "trg_devolucoes_imutavel" ON "devolucoes";
DROP FUNCTION IF EXISTS impedir_alteracao_de_fato();

DROP TABLE IF EXISTS "execucoes_backup";
DROP TABLE IF EXISTS "configuracao_backup";
DROP TABLE IF EXISTS "registros_auditoria";
DROP TABLE IF EXISTS "devolucao_itens";
DROP TABLE IF EXISTS "devolucoes";
DROP TABLE IF EXISTS "configuracao_loja";

DROP INDEX IF EXISTS "idx_vendas_abertas_estacao";
DROP INDEX IF EXISTS "idx_produtos_botao_rapido";
DROP INDEX IF EXISTS "idx_produtos_categoria";

ALTER TABLE "produtos"
  DROP CONSTRAINT IF EXISTS "ck_produtos_estoque_minimo_nao_negativo",
  DROP CONSTRAINT IF EXISTS "produtos_fornecedor_id_fkey",
  DROP CONSTRAINT IF EXISTS "produtos_imagem_id_fkey",
  DROP COLUMN IF EXISTS "estoque_minimo",
  DROP COLUMN IF EXISTS "fornecedor_id",
  DROP COLUMN IF EXISTS "imagem_id",
  DROP COLUMN IF EXISTS "botao_rapido";

ALTER TABLE "categorias"
  DROP CONSTRAINT IF EXISTS "categorias_imagem_id_fkey",
  DROP COLUMN IF EXISTS "icone",
  DROP COLUMN IF EXISTS "imagem_id";

DROP TABLE IF EXISTS "imagens";

ALTER TABLE "sessoes_caixa"
  DROP CONSTRAINT IF EXISTS "ck_sessoes_acumuladores_nao_negativos",
  DROP CONSTRAINT IF EXISTS "sessoes_caixa_operador_id_fkey",
  DROP COLUMN IF EXISTS "descontos_concedidos",
  DROP COLUMN IF EXISTS "quantidade_cancelamentos",
  DROP COLUMN IF EXISTS "total_cancelado",
  DROP COLUMN IF EXISTS "quantidade_devolucoes",
  DROP COLUMN IF EXISTS "total_devolvido",
  DROP COLUMN IF EXISTS "devolvido_em_dinheiro";

ALTER TABLE "vendas"
  DROP CONSTRAINT IF EXISTS "ck_vendas_suspensa_aberta",
  DROP CONSTRAINT IF EXISTS "ck_vendas_cancelamento_coerente",
  DROP CONSTRAINT IF EXISTS "vendas_cancelada_por_id_fkey",
  DROP CONSTRAINT IF EXISTS "vendas_cancelamento_autorizado_por_id_fkey",
  DROP COLUMN IF EXISTS "suspensa_em",
  DROP COLUMN IF EXISTS "rotulo_suspensao",
  DROP COLUMN IF EXISTS "cancelada_em",
  DROP COLUMN IF EXISTS "motivo_cancelamento",
  DROP COLUMN IF EXISTS "cancelada_por_id",
  DROP COLUMN IF EXISTS "cancelamento_autorizado_por_id";

ALTER TABLE "venda_itens"
  DROP CONSTRAINT IF EXISTS "ck_venda_itens_custo_nao_negativo",
  DROP COLUMN IF EXISTS "custo_unitario";

DROP INDEX IF EXISTS "uq_pagamentos_venda_chave";

ALTER TABLE "pagamentos"
  DROP CONSTRAINT IF EXISTS "ck_pagamentos_confirmacao",
  DROP COLUMN IF EXISTS "confirmacao",
  DROP COLUMN IF EXISTS "chave";

-- Os enums voltam ao que eram. Renomear e recriar, porque o PostgreSQL não
-- tem `DROP VALUE`; a conferência no topo garante que nenhuma linha usa os
-- valores que somem. `ALTER COLUMN ... TYPE` reescreve a tabela sem disparar o
-- gatilho de imutabilidade, que é de linha.
ALTER TYPE "TipoMovimentoEstoque" RENAME TO "TipoMovimentoEstoque_balcao";
CREATE TYPE "TipoMovimentoEstoque" AS ENUM (
  'ENTRADA',
  'DEVOLUCAO_CLIENTE',
  'AJUSTE_POSITIVO',
  'TRANSFERENCIA_ENTRADA',
  'SAIDA',
  'PERDA',
  'DEVOLUCAO_FORNECEDOR',
  'AJUSTE_NEGATIVO',
  'TRANSFERENCIA_SAIDA'
);
ALTER TABLE "movimentos_estoque"
  ALTER COLUMN "tipo" TYPE "TipoMovimentoEstoque"
  USING "tipo"::TEXT::"TipoMovimentoEstoque";
DROP TYPE "TipoMovimentoEstoque_balcao";

ALTER TYPE "OrigemMovimentoEstoque" RENAME TO "OrigemMovimentoEstoque_balcao";
CREATE TYPE "OrigemMovimentoEstoque" AS ENUM (
  'VENDA',
  'COMPRA',
  'INVENTARIO',
  'TRANSFERENCIA',
  'MANUAL'
);
ALTER TABLE "movimentos_estoque"
  ALTER COLUMN "origem_tipo" TYPE "OrigemMovimentoEstoque"
  USING "origem_tipo"::TEXT::"OrigemMovimentoEstoque";
DROP TYPE "OrigemMovimentoEstoque_balcao";

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261016150000_balcao_completo';

COMMIT;
