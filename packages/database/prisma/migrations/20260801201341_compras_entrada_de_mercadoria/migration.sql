-- CreateEnum
CREATE TYPE "StatusNotaCompra" AS ENUM ('LANCADA', 'CANCELADA');

-- Os índices `text_pattern_ops` de clientes e fornecedores NÃO são recriados
-- aqui de propósito. O Prisma não reconhece o operador declarado em `raw(...)` e
-- propõe derrubá-los e refazê-los a cada migração — idênticos ao que já existem.
-- Em loja com cadastro grande isso é uma reconstrução de índice cobrada de todo
-- cliente na atualização, em troca de nada.

-- CreateTable
CREATE TABLE "notas_compra" (
    "id" UUID NOT NULL,
    "fornecedor_id" UUID NOT NULL,
    "numero" VARCHAR(20) NOT NULL,
    "serie" VARCHAR(5) NOT NULL DEFAULT '',
    "emitida_em" TIMESTAMPTZ(3) NOT NULL,
    "recebida_em" TIMESTAMPTZ(3) NOT NULL,
    "total_declarado" BIGINT NOT NULL,
    "usuario_id" UUID NOT NULL,
    "observacao" VARCHAR(500),
    "status" "StatusNotaCompra" NOT NULL DEFAULT 'LANCADA',
    "cancelada_em" TIMESTAMPTZ(3),
    "motivo_cancelamento" VARCHAR(500),
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notas_compra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itens_nota_compra" (
    "nota_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "produto_id" UUID NOT NULL,
    "descricao" VARCHAR(120) NOT NULL,
    "quantidade" BIGINT NOT NULL,
    "unidade" VARCHAR(6) NOT NULL,
    "custo_unitario" BIGINT NOT NULL,
    "desconto" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "itens_nota_compra_pkey" PRIMARY KEY ("nota_id","numero")
);

-- CreateIndex
CREATE INDEX "idx_notas_recebida" ON "notas_compra"("recebida_em");

-- CreateIndex
CREATE INDEX "idx_notas_fornecedor_numero_serie" ON "notas_compra"("fornecedor_id", "numero", "serie");

-- A mesma nota lançada duas vezes dobra o estoque: é o defeito mais comum da
-- entrada de mercadoria. O índice é a garantia; a checagem no caso de uso
-- existe para dar a mensagem certa.
--
-- **Parcial**, valendo só para as notas `LANCADA`, por um caso concreto: quem
-- digitou a quantidade errada cancela a nota e precisa relançá-la com o mesmo
-- número. Com índice total, a chave ficaria presa pela nota cancelada e a
-- correção seria impossível sem mexer no banco na loja do cliente.
--
-- Escrito em SQL porque o Prisma não declara índice parcial no esquema.
CREATE UNIQUE INDEX "uq_notas_lancadas_fornecedor_numero_serie"
  ON "notas_compra"("fornecedor_id", "numero", "serie")
  WHERE "status" = 'LANCADA';

-- CreateIndex
CREATE INDEX "idx_itens_nota_produto" ON "itens_nota_compra"("produto_id");

-- AddForeignKey
ALTER TABLE "notas_compra" ADD CONSTRAINT "notas_compra_fornecedor_id_fkey" FOREIGN KEY ("fornecedor_id") REFERENCES "fornecedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_nota_compra" ADD CONSTRAINT "itens_nota_compra_nota_id_fkey" FOREIGN KEY ("nota_id") REFERENCES "notas_compra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_nota_compra" ADD CONSTRAINT "itens_nota_compra_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
