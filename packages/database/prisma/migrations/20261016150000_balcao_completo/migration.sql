-- Balcão completo: configuração da loja, venda guardada e cancelada com
-- responsável, custo congelado no item, confirmação do pagamento, devolução,
-- auditoria, imagens e backup.
--
-- **Puramente aditiva (expand).** Nenhuma coluna existente muda de tipo ou
-- some; toda coluna nova é anulável ou tem padrão, então a versão anterior do
-- servidor continua lendo e gravando enquanto a nova não sobe. A reversão está
-- em `reversao.sql`, ao lado.
--
-- Os valores enumerados novos ficam em texto com CHECK, e não em enum do
-- PostgreSQL: `ALTER TYPE ... ADD VALUE` não tem volta numa reversão. As duas
-- exceções abaixo (`ESTORNO_VENDA` e `DEVOLUCAO`) entram em enums que já
-- existiam — criar tipos paralelos seria pior do que estendê-los.

-- AlterEnum
ALTER TYPE "OrigemMovimentoEstoque" ADD VALUE 'DEVOLUCAO';

-- AlterEnum
ALTER TYPE "TipoMovimentoEstoque" ADD VALUE 'ESTORNO_VENDA';

-- AlterTable
ALTER TABLE "categorias" ADD COLUMN     "icone" VARCHAR(16),
ADD COLUMN     "imagem_id" UUID;

-- AlterTable
ALTER TABLE "pagamentos" ADD COLUMN     "chave" VARCHAR(64),
ADD COLUMN     "confirmacao" VARCHAR(12) NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE "produtos" ADD COLUMN     "botao_rapido" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "estoque_minimo" BIGINT,
ADD COLUMN     "fornecedor_id" UUID,
ADD COLUMN     "imagem_id" UUID;

-- AlterTable
ALTER TABLE "sessoes_caixa" ADD COLUMN     "descontos_concedidos" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "devolvido_em_dinheiro" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "quantidade_cancelamentos" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "quantidade_devolucoes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "total_cancelado" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "total_devolvido" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "venda_itens" ADD COLUMN     "custo_unitario" BIGINT;

-- AlterTable
ALTER TABLE "vendas" ADD COLUMN     "cancelada_em" TIMESTAMPTZ(3),
ADD COLUMN     "cancelada_por_id" UUID,
ADD COLUMN     "cancelamento_autorizado_por_id" UUID,
ADD COLUMN     "motivo_cancelamento" VARCHAR(200),
ADD COLUMN     "rotulo_suspensao" VARCHAR(40),
ADD COLUMN     "suspensa_em" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "configuracao_loja" (
    "id" UUID NOT NULL,
    "segmento" VARCHAR(12) NOT NULL,
    "recursos" TEXT[],
    "venda_sem_estoque" VARCHAR(10) NOT NULL DEFAULT 'PERMITIR',
    "largura_cupom" INTEGER NOT NULL DEFAULT 80,
    "impressao_comprovante" VARCHAR(10) NOT NULL DEFAULT 'SEMPRE',
    "balanca_prefixos" TEXT[] DEFAULT ARRAY['2']::TEXT[],
    "balanca_tamanho_codigo" INTEGER NOT NULL DEFAULT 6,
    "balanca_conteudo" VARCHAR(5) NOT NULL DEFAULT 'PESO',
    "balanca_casas_decimais" INTEGER NOT NULL DEFAULT 3,
    "unica" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "configuracao_loja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devolucoes" (
    "id" UUID NOT NULL,
    "venda_id" UUID NOT NULL,
    "numero_venda" INTEGER NOT NULL,
    "forma_reembolso" VARCHAR(12) NOT NULL,
    "motivo" VARCHAR(200) NOT NULL,
    "usuario_id" UUID NOT NULL,
    "autorizado_por_id" UUID,
    "sessao_caixa_id" UUID,
    "ocorrida_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "devolucoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devolucao_itens" (
    "devolucao_id" UUID NOT NULL,
    "numero_item" INTEGER NOT NULL,
    "produto_id" UUID NOT NULL,
    "descricao" VARCHAR(120) NOT NULL,
    "quantidade" BIGINT NOT NULL,
    "unidade" VARCHAR(6) NOT NULL,
    "valor" BIGINT NOT NULL,
    "destino" VARCHAR(8) NOT NULL,

    CONSTRAINT "devolucao_itens_pkey" PRIMARY KEY ("devolucao_id","numero_item")
);

-- CreateTable
CREATE TABLE "registros_auditoria" (
    "id" UUID NOT NULL,
    "ocorrido_em" TIMESTAMPTZ(3) NOT NULL,
    "acao" VARCHAR(40) NOT NULL,
    "usuario_id" UUID,
    "autorizado_por_id" UUID,
    "descricao" VARCHAR(300) NOT NULL,
    "entidade" VARCHAR(30),
    "entidade_id" UUID,
    "dados" JSONB,

    CONSTRAINT "registros_auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imagens" (
    "id" UUID NOT NULL,
    "tipo" VARCHAR(20) NOT NULL,
    "conteudo" BYTEA NOT NULL,
    "bytes" INTEGER NOT NULL,
    "hash" VARCHAR(64) NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "imagens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracao_backup" (
    "id" UUID NOT NULL,
    "pasta" VARCHAR(260),
    "intervalo_horas" INTEGER NOT NULL DEFAULT 24,
    "ao_fechar_caixa" BOOLEAN NOT NULL DEFAULT true,
    "manter_ultimos" INTEGER NOT NULL DEFAULT 30,
    "unica" BOOLEAN NOT NULL DEFAULT true,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "configuracao_backup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execucoes_backup" (
    "id" UUID NOT NULL,
    "operacao" VARCHAR(12) NOT NULL,
    "origem" VARCHAR(12) NOT NULL,
    "situacao" VARCHAR(14) NOT NULL,
    "arquivo" VARCHAR(260),
    "bytes" BIGINT,
    "hash" VARCHAR(64),
    "erro" VARCHAR(500),
    "usuario_id" UUID,
    "iniciada_em" TIMESTAMPTZ(3) NOT NULL,
    "concluida_em" TIMESTAMPTZ(3),

    CONSTRAINT "execucoes_backup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "configuracao_loja_unica_key" ON "configuracao_loja"("unica");

-- CreateIndex
CREATE INDEX "idx_devolucoes_venda" ON "devolucoes"("venda_id");

-- CreateIndex
CREATE INDEX "idx_devolucoes_sessao" ON "devolucoes"("sessao_caixa_id");

-- CreateIndex
CREATE INDEX "idx_devolucoes_data" ON "devolucoes"("ocorrida_em");

-- CreateIndex
CREATE INDEX "idx_devolucao_itens_produto" ON "devolucao_itens"("produto_id");

-- CreateIndex
CREATE INDEX "idx_auditoria_data" ON "registros_auditoria"("ocorrido_em");

-- CreateIndex
CREATE INDEX "idx_auditoria_acao_data" ON "registros_auditoria"("acao", "ocorrido_em");

-- CreateIndex
CREATE INDEX "idx_auditoria_usuario_data" ON "registros_auditoria"("usuario_id", "ocorrido_em");

-- CreateIndex
CREATE INDEX "idx_auditoria_entidade" ON "registros_auditoria"("entidade_id");

-- CreateIndex
CREATE UNIQUE INDEX "imagens_hash_key" ON "imagens"("hash");

-- CreateIndex
CREATE UNIQUE INDEX "configuracao_backup_unica_key" ON "configuracao_backup"("unica");

-- CreateIndex
CREATE INDEX "idx_execucoes_backup_data" ON "execucoes_backup"("iniciada_em");

-- CreateIndex
CREATE UNIQUE INDEX "uq_pagamentos_venda_chave" ON "pagamentos"("venda_id", "chave");

-- CreateIndex
CREATE INDEX "idx_produtos_fornecedor" ON "produtos"("fornecedor_id");

-- AddForeignKey
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_fornecedor_id_fkey" FOREIGN KEY ("fornecedor_id") REFERENCES "fornecedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_imagem_id_fkey" FOREIGN KEY ("imagem_id") REFERENCES "imagens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
-- `NOT VALID`: a chave vale para toda sessão aberta daqui em diante, sem
-- reprovar a atualização de uma loja por uma linha antiga que ninguém consegue
-- corrigir no balcão. Era a dívida nomeada no ESTADO.md §2.4 ("Fazer junto com
-- a próxima migração de caixa"). O `VALIDATE CONSTRAINT` fica para a migração
-- de contração, depois de uma versão no ar sem violação registrada.
ALTER TABLE "sessoes_caixa" ADD CONSTRAINT "sessoes_caixa_operador_id_fkey" FOREIGN KEY ("operador_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_cancelada_por_id_fkey" FOREIGN KEY ("cancelada_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_cancelamento_autorizado_por_id_fkey" FOREIGN KEY ("cancelamento_autorizado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorias" ADD CONSTRAINT "categorias_imagem_id_fkey" FOREIGN KEY ("imagem_id") REFERENCES "imagens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devolucoes" ADD CONSTRAINT "devolucoes_venda_id_fkey" FOREIGN KEY ("venda_id") REFERENCES "vendas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devolucoes" ADD CONSTRAINT "devolucoes_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devolucoes" ADD CONSTRAINT "devolucoes_autorizado_por_id_fkey" FOREIGN KEY ("autorizado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devolucoes" ADD CONSTRAINT "devolucoes_sessao_caixa_id_fkey" FOREIGN KEY ("sessao_caixa_id") REFERENCES "sessoes_caixa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devolucao_itens" ADD CONSTRAINT "devolucao_itens_devolucao_id_fkey" FOREIGN KEY ("devolucao_id") REFERENCES "devolucoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devolucao_itens" ADD CONSTRAINT "devolucao_itens_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registros_auditoria" ADD CONSTRAINT "registros_auditoria_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registros_auditoria" ADD CONSTRAINT "registros_auditoria_autorizado_por_id_fkey" FOREIGN KEY ("autorizado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execucoes_backup" ADD CONSTRAINT "execucoes_backup_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────
-- Invariantes que o domínio já garante, repetidas no banco
-- ─────────────────────────────────────────────────────────────────────────
--
-- O domínio protege o fluxo normal; o banco protege contra todo o resto — o
-- script de suporte, a importação, o defeito de amanhã.

ALTER TABLE "configuracao_loja"
  ADD CONSTRAINT "ck_configuracao_segmento"
    CHECK ("segmento" IN ('PADARIA', 'MERCADINHO', 'FRUTARIA', 'MISTO')),
  ADD CONSTRAINT "ck_configuracao_recursos"
    CHECK ("recursos" IS NOT NULL
      AND "recursos" <@ ARRAY['VENDA_POR_PESO', 'FIADO', 'BOTOES_RAPIDOS']::TEXT[]),
  ADD CONSTRAINT "ck_configuracao_venda_sem_estoque"
    CHECK ("venda_sem_estoque" IN ('PERMITIR', 'AUTORIZAR', 'BLOQUEAR')),
  ADD CONSTRAINT "ck_configuracao_largura_cupom" CHECK ("largura_cupom" IN (58, 80)),
  ADD CONSTRAINT "ck_configuracao_impressao"
    CHECK ("impressao_comprovante" IN ('SEMPRE', 'SOB_PEDIDO')),
  ADD CONSTRAINT "ck_configuracao_balanca"
    CHECK ("balanca_prefixos" IS NOT NULL
      AND cardinality("balanca_prefixos") BETWEEN 1 AND 5
      AND "balanca_conteudo" IN ('PESO', 'PRECO')
      AND "balanca_tamanho_codigo" BETWEEN 4 AND 6
      AND "balanca_casas_decimais" BETWEEN 0 AND 3);

ALTER TABLE "pagamentos"
  ADD CONSTRAINT "ck_pagamentos_confirmacao"
    CHECK ("confirmacao" IN ('MANUAL', 'INTEGRACAO', 'SIMULADA'));

ALTER TABLE "venda_itens"
  ADD CONSTRAINT "ck_venda_itens_custo_nao_negativo"
    CHECK ("custo_unitario" IS NULL OR "custo_unitario" >= 0);

-- Venda guardada só existe enquanto aberta; dados de cancelamento, só em venda
-- cancelada. As duas direções seguras para as linhas antigas, que têm as
-- colunas novas nulas.
ALTER TABLE "vendas"
  ADD CONSTRAINT "ck_vendas_suspensa_aberta"
    CHECK ("suspensa_em" IS NULL OR "status" = 'ABERTA'),
  ADD CONSTRAINT "ck_vendas_cancelamento_coerente"
    CHECK ("cancelada_em" IS NULL
      OR ("status" = 'CANCELADA' AND "motivo_cancelamento" IS NOT NULL
        AND "cancelada_por_id" IS NOT NULL));

ALTER TABLE "sessoes_caixa"
  ADD CONSTRAINT "ck_sessoes_acumuladores_nao_negativos"
    CHECK ("descontos_concedidos" >= 0 AND "quantidade_cancelamentos" >= 0
      AND "total_cancelado" >= 0 AND "quantidade_devolucoes" >= 0
      AND "total_devolvido" >= 0 AND "devolvido_em_dinheiro" >= 0
      AND "devolvido_em_dinheiro" <= "total_devolvido");

ALTER TABLE "produtos"
  ADD CONSTRAINT "ck_produtos_estoque_minimo_nao_negativo"
    CHECK ("estoque_minimo" IS NULL OR "estoque_minimo" >= 0);

-- Reembolso em dinheiro sai de uma gaveta: sem caixa, o dinheiro não tem de
-- onde ter saído, e o fechamento não teria como enxergá-lo.
ALTER TABLE "devolucoes"
  ADD CONSTRAINT "ck_devolucoes_forma"
    CHECK ("forma_reembolso" IN ('DINHEIRO', 'PIX', 'CARTAO', 'ABATER_FIADO')),
  ADD CONSTRAINT "ck_devolucoes_dinheiro_tem_caixa"
    CHECK ("forma_reembolso" <> 'DINHEIRO' OR "sessao_caixa_id" IS NOT NULL);

ALTER TABLE "devolucao_itens"
  ADD CONSTRAINT "ck_devolucao_itens_quantidade_positiva" CHECK ("quantidade" > 0),
  ADD CONSTRAINT "ck_devolucao_itens_valor_nao_negativo" CHECK ("valor" >= 0),
  ADD CONSTRAINT "ck_devolucao_itens_destino" CHECK ("destino" IN ('ESTOQUE', 'PERDA'));

-- O limite de tamanho existe também aqui: a imagem viaja dentro de cada
-- backup, e uma foto de 8 MB tirada do celular multiplicaria o arquivo.
ALTER TABLE "imagens"
  ADD CONSTRAINT "ck_imagens_tipo" CHECK ("tipo" IN ('image/png', 'image/jpeg', 'image/webp')),
  ADD CONSTRAINT "ck_imagens_tamanho" CHECK ("bytes" > 0 AND "bytes" <= 524288);

ALTER TABLE "configuracao_backup"
  ADD CONSTRAINT "ck_backup_intervalo" CHECK ("intervalo_horas" BETWEEN 0 AND 168),
  ADD CONSTRAINT "ck_backup_retencao" CHECK ("manter_ultimos" BETWEEN 1 AND 365);

ALTER TABLE "execucoes_backup"
  ADD CONSTRAINT "ck_execucoes_operacao" CHECK ("operacao" IN ('BACKUP', 'RESTAURACAO')),
  ADD CONSTRAINT "ck_execucoes_origem" CHECK ("origem" IN ('MANUAL', 'AGENDADO', 'FECHAMENTO')),
  ADD CONSTRAINT "ck_execucoes_situacao"
    CHECK ("situacao" IN ('EM_ANDAMENTO', 'CONCLUIDO', 'FALHOU'));

-- ─────────────────────────────────────────────────────────────────────────
-- Índices parciais — o Prisma não os declara no esquema
-- ─────────────────────────────────────────────────────────────────────────

-- "Vendas guardadas desta estação": só as abertas, que são uma dúzia no
-- máximo entre milhares de finalizadas. O índice inteiro sobre `vendas`
-- cresceria com o histórico; este fica do tamanho do balcão.
CREATE INDEX "idx_vendas_abertas_estacao"
  ON "vendas" ("estacao_id", "aberta_em")
  WHERE "status" = 'ABERTA';

-- Os botões do caixa, carregados a cada abertura da tela.
CREATE INDEX "idx_produtos_botao_rapido"
  ON "produtos" ("descricao_pdv")
  WHERE "botao_rapido" AND "ativo";

-- Os produtos de uma categoria, quando o operador toca no botão dela.
CREATE INDEX "idx_produtos_categoria"
  ON "produtos" ("categoria_id", "descricao_pdv")
  WHERE "ativo";

-- ─────────────────────────────────────────────────────────────────────────
-- Fatos são append-only (princípio 5)
-- ─────────────────────────────────────────────────────────────────────────
--
-- Uma função só para as três tabelas: a mensagem diz qual tabela recusou, e
-- quem ler o log não precisa adivinhar.
CREATE OR REPLACE FUNCTION impedir_alteracao_de_fato()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    '% e append-only: registre uma operacao nova em vez de %', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_devolucoes_imutavel
  BEFORE UPDATE OR DELETE ON "devolucoes"
  FOR EACH ROW EXECUTE FUNCTION impedir_alteracao_de_fato();

CREATE TRIGGER trg_devolucao_itens_imutavel
  BEFORE UPDATE OR DELETE ON "devolucao_itens"
  FOR EACH ROW EXECUTE FUNCTION impedir_alteracao_de_fato();

CREATE TRIGGER trg_registros_auditoria_imutavel
  BEFORE UPDATE OR DELETE ON "registros_auditoria"
  FOR EACH ROW EXECUTE FUNCTION impedir_alteracao_de_fato();

-- ─────────────────────────────────────────────────────────────────────────
-- Permissões novas nos papéis de fábrica já instalados
-- ─────────────────────────────────────────────────────────────────────────
--
-- Papel de fábrica é semeado no primeiro acesso e não recebe sozinho o que a
-- versão nova acrescentou ao catálogo. Sem isto, a loja que atualiza ficaria
-- com o operador sem poder tirar a bipada errada e o gerente sem a tela de
-- auditoria — o mesmo papel com permissões diferentes conforme a data da
-- instalação. Só papéis `padrao`: o papel que a loja criou é dela.
INSERT INTO "permissoes_papel" ("papel_id", "permissao")
SELECT p."id", n."permissao"
FROM "papeis" p
JOIN (VALUES
  ('OPERADOR_CAIXA', 'venda:remover_item'),
  ('SUPERVISOR', 'venda:remover_item'),
  ('SUPERVISOR', 'venda:devolver'),
  ('SUPERVISOR', 'venda:sem_estoque'),
  ('GERENTE', 'venda:remover_item'),
  ('GERENTE', 'venda:devolver'),
  ('GERENTE', 'venda:sem_estoque'),
  ('GERENTE', 'backup:executar'),
  ('GERENTE', 'auditoria:consultar'),
  ('ADMIN', 'venda:remover_item'),
  ('ADMIN', 'venda:devolver'),
  ('ADMIN', 'venda:sem_estoque'),
  ('ADMIN', 'backup:executar'),
  ('ADMIN', 'auditoria:consultar')
) AS n("codigo", "permissao") ON n."codigo" = p."codigo"
WHERE p."padrao"
ON CONFLICT DO NOTHING;
