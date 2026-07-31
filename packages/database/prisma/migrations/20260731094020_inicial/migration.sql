-- CreateEnum
CREATE TYPE "TipoProduto" AS ENUM ('UNITARIO', 'PESAVEL');

-- CreateEnum
CREATE TYPE "TipoReferencia" AS ENUM ('EAN', 'FABRICANTE', 'ORIGINAL', 'SIMILAR', 'INTERNO', 'FORNECEDOR');

-- CreateEnum
CREATE TYPE "TipoMovimentoEstoque" AS ENUM ('ENTRADA', 'DEVOLUCAO_CLIENTE', 'AJUSTE_POSITIVO', 'TRANSFERENCIA_ENTRADA', 'SAIDA', 'PERDA', 'DEVOLUCAO_FORNECEDOR', 'AJUSTE_NEGATIVO', 'TRANSFERENCIA_SAIDA');

-- CreateEnum
CREATE TYPE "OrigemMovimentoEstoque" AS ENUM ('VENDA', 'COMPRA', 'INVENTARIO', 'TRANSFERENCIA', 'MANUAL');

-- CreateEnum
CREATE TYPE "StatusCaixa" AS ENUM ('ABERTA', 'FECHADA');

-- CreateEnum
CREATE TYPE "TipoMovimentoCaixa" AS ENUM ('SANGRIA', 'SUPRIMENTO');

-- CreateEnum
CREATE TYPE "StatusVenda" AS ENUM ('ABERTA', 'FINALIZADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "StatusOutbox" AS ENUM ('PENDENTE', 'PROCESSANDO', 'ENTREGUE', 'FALHOU');

-- CreateTable
CREATE TABLE "produtos" (
    "id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "descricao" VARCHAR(120) NOT NULL,
    "descricao_pdv" VARCHAR(40) NOT NULL,
    "descricao_busca" TEXT NOT NULL,
    "tipo" "TipoProduto" NOT NULL,
    "unidade_base" VARCHAR(6) NOT NULL,
    "preco_venda" BIGINT NOT NULL,
    "custo" BIGINT NOT NULL DEFAULT 0,
    "codigo_barras" VARCHAR(14),
    "codigo_balanca" VARCHAR(7),
    "categoria_id" UUID,
    "perfil_tributario_id" UUID,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "produtos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referencias_produto" (
    "produto_id" UUID NOT NULL,
    "tipo" "TipoReferencia" NOT NULL,
    "valor" VARCHAR(60) NOT NULL,
    "normalizado" TEXT NOT NULL,

    CONSTRAINT "referencias_produto_pkey" PRIMARY KEY ("produto_id","tipo","normalizado")
);

-- CreateTable
CREATE TABLE "embalagens" (
    "produto_id" UUID NOT NULL,
    "unidade" VARCHAR(6) NOT NULL,
    "fator" BIGINT NOT NULL,
    "codigo_barras" VARCHAR(14),

    CONSTRAINT "embalagens_pkey" PRIMARY KEY ("produto_id","unidade")
);

-- CreateTable
CREATE TABLE "movimentos_estoque" (
    "id" UUID NOT NULL,
    "produto_id" UUID NOT NULL,
    "tipo" "TipoMovimentoEstoque" NOT NULL,
    "quantidade" BIGINT NOT NULL,
    "unidade" VARCHAR(6) NOT NULL,
    "origem_tipo" "OrigemMovimentoEstoque" NOT NULL,
    "origem_documento_id" UUID,
    "usuario_id" UUID NOT NULL,
    "custo_unitario" BIGINT,
    "lote" VARCHAR(30),
    "observacao" TEXT,
    "ocorrido_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "movimentos_estoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saldos_estoque" (
    "produto_id" UUID NOT NULL,
    "milesimos" BIGINT NOT NULL DEFAULT 0,
    "unidade" VARCHAR(6) NOT NULL,
    "custo_medio" BIGINT NOT NULL DEFAULT 0,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "saldos_estoque_pkey" PRIMARY KEY ("produto_id")
);

-- CreateTable
CREATE TABLE "sessoes_caixa" (
    "id" UUID NOT NULL,
    "estacao_id" UUID NOT NULL,
    "operador_id" UUID NOT NULL,
    "fundo_troco" BIGINT NOT NULL,
    "status" "StatusCaixa" NOT NULL DEFAULT 'ABERTA',
    "aberta_em" TIMESTAMPTZ(3) NOT NULL,
    "fechada_em" TIMESTAMPTZ(3),
    "contado_em_dinheiro" BIGINT,
    "troco_devolvido" BIGINT NOT NULL DEFAULT 0,
    "total_vendido" BIGINT NOT NULL DEFAULT 0,
    "quantidade_vendas" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sessoes_caixa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimentos_caixa" (
    "id" UUID NOT NULL,
    "sessao_caixa_id" UUID NOT NULL,
    "tipo" "TipoMovimentoCaixa" NOT NULL,
    "valor" BIGINT NOT NULL,
    "motivo" TEXT NOT NULL,
    "usuario_id" UUID NOT NULL,
    "autorizado_por_id" UUID,
    "ocorrido_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "movimentos_caixa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recebimentos_caixa" (
    "sessao_caixa_id" UUID NOT NULL,
    "forma" VARCHAR(20) NOT NULL,
    "valor" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "recebimentos_caixa_pkey" PRIMARY KEY ("sessao_caixa_id","forma")
);

-- CreateTable
CREATE TABLE "vendas" (
    "id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "sessao_caixa_id" UUID NOT NULL,
    "operador_id" UUID NOT NULL,
    "estacao_id" UUID NOT NULL,
    "cliente_id" UUID,
    "status" "StatusVenda" NOT NULL DEFAULT 'ABERTA',
    "desconto_venda" BIGINT NOT NULL DEFAULT 0,
    "troco" BIGINT NOT NULL DEFAULT 0,
    "aberta_em" TIMESTAMPTZ(3) NOT NULL,
    "finalizada_em" TIMESTAMPTZ(3),

    CONSTRAINT "vendas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venda_itens" (
    "venda_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "produto_id" UUID NOT NULL,
    "descricao" VARCHAR(120) NOT NULL,
    "quantidade" BIGINT NOT NULL,
    "unidade" VARCHAR(6) NOT NULL,
    "preco_unitario" BIGINT NOT NULL,
    "desconto" BIGINT NOT NULL DEFAULT 0,
    "desconto_rateado" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "venda_itens_pkey" PRIMARY KEY ("venda_id","numero")
);

-- CreateTable
CREATE TABLE "pagamentos" (
    "venda_id" UUID NOT NULL,
    "ordem" INTEGER NOT NULL,
    "forma" VARCHAR(20) NOT NULL,
    "valor" BIGINT NOT NULL,
    "autorizacao" VARCHAR(40),
    "parcelas" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pagamentos_pkey" PRIMARY KEY ("venda_id","ordem")
);

-- CreateTable
CREATE TABLE "eventos_outbox" (
    "id" UUID NOT NULL,
    "tipo" VARCHAR(60) NOT NULL,
    "agregado_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "StatusOutbox" NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "ocorrido_em" TIMESTAMPTZ(3) NOT NULL,
    "processado_em" TIMESTAMPTZ(3),
    "ultimo_erro" TEXT,

    CONSTRAINT "eventos_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "produtos_sku_key" ON "produtos"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "produtos_codigo_barras_key" ON "produtos"("codigo_barras");

-- CreateIndex
CREATE UNIQUE INDEX "produtos_codigo_balanca_key" ON "produtos"("codigo_balanca");

-- CreateIndex
CREATE INDEX "idx_produtos_busca" ON "produtos"("descricao_busca");

-- CreateIndex
CREATE INDEX "idx_produtos_ativo" ON "produtos"("ativo");

-- CreateIndex
CREATE INDEX "idx_referencias_normalizado" ON "referencias_produto"("normalizado");

-- CreateIndex
CREATE INDEX "idx_movimentos_produto_data" ON "movimentos_estoque"("produto_id", "ocorrido_em");

-- CreateIndex
CREATE INDEX "idx_movimentos_origem" ON "movimentos_estoque"("origem_documento_id");

-- CreateIndex
CREATE INDEX "idx_sessoes_estacao_status" ON "sessoes_caixa"("estacao_id", "status");

-- CreateIndex
CREATE INDEX "idx_movimentos_caixa_sessao" ON "movimentos_caixa"("sessao_caixa_id");

-- CreateIndex
CREATE INDEX "idx_vendas_sessao" ON "vendas"("sessao_caixa_id");

-- CreateIndex
CREATE INDEX "idx_vendas_finalizada" ON "vendas"("finalizada_em");

-- CreateIndex
CREATE UNIQUE INDEX "uq_vendas_estacao_numero" ON "vendas"("estacao_id", "numero");

-- CreateIndex
CREATE INDEX "idx_itens_produto" ON "venda_itens"("produto_id");

-- CreateIndex
CREATE INDEX "idx_outbox_pendentes" ON "eventos_outbox"("status", "ocorrido_em");

-- AddForeignKey
ALTER TABLE "referencias_produto" ADD CONSTRAINT "referencias_produto_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "embalagens" ADD CONSTRAINT "embalagens_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos_estoque" ADD CONSTRAINT "movimentos_estoque_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saldos_estoque" ADD CONSTRAINT "saldos_estoque_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos_caixa" ADD CONSTRAINT "movimentos_caixa_sessao_caixa_id_fkey" FOREIGN KEY ("sessao_caixa_id") REFERENCES "sessoes_caixa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recebimentos_caixa" ADD CONSTRAINT "recebimentos_caixa_sessao_caixa_id_fkey" FOREIGN KEY ("sessao_caixa_id") REFERENCES "sessoes_caixa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_sessao_caixa_id_fkey" FOREIGN KEY ("sessao_caixa_id") REFERENCES "sessoes_caixa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venda_itens" ADD CONSTRAINT "venda_itens_venda_id_fkey" FOREIGN KEY ("venda_id") REFERENCES "vendas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venda_itens" ADD CONSTRAINT "venda_itens_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_venda_id_fkey" FOREIGN KEY ("venda_id") REFERENCES "vendas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
