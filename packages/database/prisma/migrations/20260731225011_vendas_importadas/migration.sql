-- DropIndex
DROP INDEX "ix_cliente_nome_busca";

-- DropIndex
DROP INDEX "ix_fornecedor_razao_busca";

-- CreateTable
CREATE TABLE "vendas_importadas" (
    "chave" VARCHAR(64) NOT NULL,
    "venda_id" UUID NOT NULL,
    "estacao_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendas_importadas_pkey" PRIMARY KEY ("chave")
);

-- CreateIndex
CREATE UNIQUE INDEX "vendas_importadas_venda_id_key" ON "vendas_importadas"("venda_id");

-- CreateIndex
CREATE INDEX "ix_venda_importada_estacao" ON "vendas_importadas"("estacao_id", "criado_em");

-- CreateIndex
CREATE INDEX "ix_cliente_nome_busca" ON "clientes"("nome_busca" text_pattern_ops);

-- CreateIndex
CREATE INDEX "ix_fornecedor_razao_busca" ON "fornecedores"("razao_social_busca" text_pattern_ops);

-- AddForeignKey
ALTER TABLE "vendas_importadas" ADD CONSTRAINT "vendas_importadas_venda_id_fkey" FOREIGN KEY ("venda_id") REFERENCES "vendas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
