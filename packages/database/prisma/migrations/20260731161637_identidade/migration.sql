-- CreateEnum
CREATE TYPE "ContextoSessao" AS ENUM ('PDV', 'RETAGUARDA');

-- CreateTable
CREATE TABLE "papeis" (
    "id" UUID NOT NULL,
    "codigo" VARCHAR(40) NOT NULL,
    "nome" VARCHAR(60) NOT NULL,
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "desconto_maximo_item_bps" INTEGER,
    "desconto_maximo_venda_bps" INTEGER,
    "valor_maximo_sangria" BIGINT,
    "minutos_para_cancelar_venda" INTEGER,
    "estorno_maximo_em_dinheiro" BIGINT,

    CONSTRAINT "papeis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissoes_papel" (
    "papel_id" UUID NOT NULL,
    "permissao" VARCHAR(40) NOT NULL,

    CONSTRAINT "permissoes_papel_pkey" PRIMARY KEY ("papel_id","permissao")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" UUID NOT NULL,
    "matricula" VARCHAR(6) NOT NULL,
    "nome" VARCHAR(80) NOT NULL,
    "papel_id" UUID NOT NULL,
    "hash_pin" TEXT,
    "algoritmo_pin" VARCHAR(20),
    "hash_senha" TEXT,
    "algoritmo_senha" VARCHAR(20),
    "precisa_trocar_credencial" BOOLEAN NOT NULL DEFAULT true,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "tentativas_falhas" INTEGER NOT NULL DEFAULT 0,
    "bloqueado_ate" TIMESTAMPTZ(3),
    "bloqueios_consecutivos" INTEGER NOT NULL DEFAULT 0,
    "ultimo_acesso_em" TIMESTAMPTZ(3),
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estacoes_permitidas" (
    "usuario_id" UUID NOT NULL,
    "estacao_id" UUID NOT NULL,

    CONSTRAINT "estacoes_permitidas_pkey" PRIMARY KEY ("usuario_id","estacao_id")
);

-- CreateTable
CREATE TABLE "sessoes_acesso" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "familia_id" UUID NOT NULL,
    "dispositivo_id" UUID NOT NULL,
    "contexto" "ContextoSessao" NOT NULL,
    "hash_refresh" TEXT NOT NULL,
    "algoritmo_refresh" VARCHAR(20) NOT NULL,
    "criada_em" TIMESTAMPTZ(3) NOT NULL,
    "expira_em" TIMESTAMPTZ(3) NOT NULL,
    "revogada_em" TIMESTAMPTZ(3),
    "usada_em" TIMESTAMPTZ(3),
    "sucessora_id" UUID,

    CONSTRAINT "sessoes_acesso_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "papeis_codigo_key" ON "papeis"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_matricula_key" ON "usuarios"("matricula");

-- CreateIndex
CREATE INDEX "idx_usuarios_papel" ON "usuarios"("papel_id");

-- CreateIndex
CREATE INDEX "idx_sessoes_familia" ON "sessoes_acesso"("familia_id");

-- CreateIndex
CREATE INDEX "idx_sessoes_usuario" ON "sessoes_acesso"("usuario_id");

-- CreateIndex
CREATE INDEX "idx_sessoes_expiracao" ON "sessoes_acesso"("expira_em");

-- AddForeignKey
ALTER TABLE "permissoes_papel" ADD CONSTRAINT "permissoes_papel_papel_id_fkey" FOREIGN KEY ("papel_id") REFERENCES "papeis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_papel_id_fkey" FOREIGN KEY ("papel_id") REFERENCES "papeis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estacoes_permitidas" ADD CONSTRAINT "estacoes_permitidas_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessoes_acesso" ADD CONSTRAINT "sessoes_acesso_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
