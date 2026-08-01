-- A empresa que opera esta instalação. Uma linha, sempre (ADR-0024).
--
-- A garantia é a coluna `unica` com índice único: a segunda inserção falha no
-- banco, e não depende de nenhum caminho de código lembrar de conferir.
--
-- Nota sobre o que foi removido daqui: o Prisma não reconhece `text_pattern_ops`
-- e propõe derrubar e recriar `ix_cliente_nome_busca` e
-- `ix_fornecedor_razao_busca` a cada migração. São idênticos ao que já existe;
-- recriá-los custaria bloqueio de tabela por nada. Confira essa remoção em toda
-- migração nova.

-- CreateTable
CREATE TABLE "empresas" (
    "id" UUID NOT NULL,
    "razao_social" VARCHAR(60) NOT NULL,
    "nome_fantasia" VARCHAR(60),
    "razao_social_busca" TEXT NOT NULL,
    "cnpj" VARCHAR(14) NOT NULL,
    "inscricao_estadual" VARCHAR(20),
    "inscricao_municipal" VARCHAR(20),
    "regime_tributario" VARCHAR(30) NOT NULL,
    "telefone" VARCHAR(11),
    "email" VARCHAR(160),
    "logradouro" VARCHAR(120) NOT NULL,
    "numero" VARCHAR(10) NOT NULL,
    "complemento" VARCHAR(60),
    "bairro" VARCHAR(60) NOT NULL,
    "municipio" VARCHAR(60) NOT NULL,
    "codigo_municipio_ibge" VARCHAR(7),
    "uf" VARCHAR(2) NOT NULL,
    "cep" VARCHAR(8) NOT NULL,
    "unica" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "empresas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "empresas_cnpj_key" ON "empresas"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "empresas_unica_key" ON "empresas"("unica");

-- Reversão:
--   DROP TABLE "empresas";
