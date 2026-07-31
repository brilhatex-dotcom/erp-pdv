-- CreateTable
CREATE TABLE "categorias" (
    "id" UUID NOT NULL,
    "nome" VARCHAR(60) NOT NULL,
    "nome_busca" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categorias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clientes" (
    "id" UUID NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "apelido" VARCHAR(60),
    "nome_busca" TEXT NOT NULL,
    "tipo_pessoa" VARCHAR(10) NOT NULL,
    "documento" VARCHAR(14),
    "inscricao_estadual" VARCHAR(20),
    "telefone" VARCHAR(11),
    "email" VARCHAR(160),
    "limite_credito" BIGINT NOT NULL DEFAULT 0,
    "observacao" VARCHAR(500),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "logradouro" VARCHAR(120),
    "numero" VARCHAR(10),
    "complemento" VARCHAR(60),
    "bairro" VARCHAR(60),
    "municipio" VARCHAR(60),
    "codigo_municipio_ibge" VARCHAR(7),
    "uf" VARCHAR(2),
    "cep" VARCHAR(8),
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fornecedores" (
    "id" UUID NOT NULL,
    "razao_social" VARCHAR(120) NOT NULL,
    "nome_fantasia" VARCHAR(60),
    "razao_social_busca" TEXT NOT NULL,
    "documento" VARCHAR(14) NOT NULL,
    "inscricao_estadual" VARCHAR(20),
    "telefone" VARCHAR(11),
    "email" VARCHAR(160),
    "prazo_entrega_dias" INTEGER,
    "observacao" VARCHAR(500),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "logradouro" VARCHAR(120),
    "numero" VARCHAR(10),
    "complemento" VARCHAR(60),
    "bairro" VARCHAR(60),
    "municipio" VARCHAR(60),
    "codigo_municipio_ibge" VARCHAR(7),
    "uf" VARCHAR(2),
    "cep" VARCHAR(8),
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fornecedores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categorias_nome_busca_key" ON "categorias"("nome_busca");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_documento_key" ON "clientes"("documento");

-- CreateIndex
CREATE INDEX "ix_cliente_nome_busca" ON "clientes"("nome_busca" text_pattern_ops);

-- CreateIndex
CREATE UNIQUE INDEX "fornecedores_documento_key" ON "fornecedores"("documento");

-- CreateIndex
CREATE INDEX "ix_fornecedor_razao_busca" ON "fornecedores"("razao_social_busca" text_pattern_ops);
