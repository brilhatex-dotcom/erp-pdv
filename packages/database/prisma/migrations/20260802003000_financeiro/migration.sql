-- Financeiro: contas a receber e a pagar.
--
-- É a caderneta do lojista, que hoje mora num caderno e é onde o dono mais
-- perde dinheiro (`docs/ANALISE-SEGMENTOS.md` §3.3).
--
-- ⚠️ Ao gerar a próxima migração, confira se o `prisma migrate diff` incluiu um
-- DROP/CREATE de `ix_cliente_nome_busca` e `ix_fornecedor_razao_busca`. Ele faz
-- isso porque não entende `text_pattern_ops`, e o par é sempre removido à mão:
-- recriá-los sem o operador destruiria a busca por prefixo dos dois cadastros.

-- CreateEnum
CREATE TYPE "TipoTitulo" AS ENUM ('RECEBER', 'PAGAR');

-- CreateEnum
CREATE TYPE "OrigemTitulo" AS ENUM ('VENDA', 'COMPRA', 'MANUAL');

-- CreateEnum
CREATE TYPE "TipoBaixa" AS ENUM ('PAGAMENTO', 'ESTORNO');

-- CreateTable
--
-- Sem coluna de saldo nem de situação: as duas saem das baixas (princípio 5).
-- Guardar qualquer uma criaria um segundo lugar onde a verdade mora.
CREATE TABLE "titulos" (
    "id" UUID NOT NULL,
    "tipo" "TipoTitulo" NOT NULL,
    "origem" "OrigemTitulo" NOT NULL,
    "documento_id" UUID,
    "contraparte_id" UUID,
    "contraparte_nome" VARCHAR(120) NOT NULL,
    "valor_original" BIGINT NOT NULL,
    "vencimento" TIMESTAMPTZ(3) NOT NULL,
    "emitido_em" TIMESTAMPTZ(3) NOT NULL,
    "parcela_numero" INTEGER,
    "parcela_de" INTEGER,
    "descricao" VARCHAR(200),
    "cancelado_em" TIMESTAMPTZ(3),
    "motivo_cancelamento" VARCHAR(500),
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "titulos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "baixas_titulo" (
    "id" UUID NOT NULL,
    "titulo_id" UUID NOT NULL,
    "tipo" "TipoBaixa" NOT NULL,
    "valor" BIGINT NOT NULL,
    "ocorrida_em" TIMESTAMPTZ(3) NOT NULL,
    "usuario_id" UUID NOT NULL,
    "forma" VARCHAR(30),
    "observacao" VARCHAR(500),
    "estorna_id" UUID,

    CONSTRAINT "baixas_titulo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_titulos_tipo_contraparte" ON "titulos"("tipo", "contraparte_id");

-- CreateIndex
CREATE INDEX "idx_titulos_tipo_vencimento" ON "titulos"("tipo", "vencimento");

-- CreateIndex
CREATE INDEX "idx_titulos_documento" ON "titulos"("documento_id");

-- CreateIndex
CREATE INDEX "idx_baixas_titulo_data" ON "baixas_titulo"("titulo_id", "ocorrida_em");

-- CreateIndex
--
-- Um recebimento só é estornado uma vez. Sem isto, dois cliques no botão
-- devolveriam o dobro ao saldo e a dívida do cliente cresceria sozinha.
CREATE UNIQUE INDEX "uq_baixa_estorno_unico" ON "baixas_titulo"("estorna_id");

-- AddForeignKey
ALTER TABLE "baixas_titulo"
  ADD CONSTRAINT "baixas_titulo_titulo_id_fkey"
  FOREIGN KEY ("titulo_id") REFERENCES "titulos"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Invariantes de valor ──────────────────────────────────────────────────
--
-- Espelham o que o domínio já valida. A duplicação é deliberada: o domínio
-- protege o fluxo normal, o banco protege contra todo o resto — importação,
-- correção manual, versão futura com defeito.

ALTER TABLE "titulos"
  ADD CONSTRAINT "ck_titulos_valor_positivo" CHECK ("valor_original" > 0);

ALTER TABLE "baixas_titulo"
  ADD CONSTRAINT "ck_baixas_valor_positivo" CHECK ("valor" > 0);

-- Parcela `0 de 3` ou `4 de 3` não existe; e ou o par está preenchido, ou nenhum.
ALTER TABLE "titulos"
  ADD CONSTRAINT "ck_titulos_parcela_coerente" CHECK (
    ("parcela_numero" IS NULL AND "parcela_de" IS NULL)
    OR ("parcela_numero" >= 1 AND "parcela_de" >= 1 AND "parcela_numero" <= "parcela_de")
  );

-- Estorno não tem forma de pagamento; recebimento sem forma é lançamento cego.
ALTER TABLE "baixas_titulo"
  ADD CONSTRAINT "ck_baixas_estorno_coerente" CHECK (
    ("tipo" = 'ESTORNO' AND "estorna_id" IS NOT NULL)
    OR ("tipo" = 'PAGAMENTO' AND "estorna_id" IS NULL)
  );

-- Título de venda ou compra aponta para o documento e para a contraparte.
-- Fiado sem devedor é a caderneta perdendo o que a torna útil.
ALTER TABLE "titulos"
  ADD CONSTRAINT "ck_titulos_origem_coerente" CHECK (
    "origem" = 'MANUAL'
    OR ("documento_id" IS NOT NULL AND "contraparte_id" IS NOT NULL)
  );

-- ── Baixa é append-only (princípio 5 do CLAUDE.md) ────────────────────────
--
-- Corrigir um recebimento errado grava um ESTORNO, nunca um UPDATE. O cliente
-- que pagou R$ 50 e viu o valor sumir do extrato não confia mais na caderneta
-- do sistema do que confiava na de papel — e é essa confiança que o produto
-- está vendendo.
CREATE OR REPLACE FUNCTION impedir_alteracao_baixa()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'baixas_titulo e append-only: corrija com um estorno, nao com %', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_baixas_titulo_imutavel
  BEFORE UPDATE OR DELETE ON "baixas_titulo"
  FOR EACH ROW EXECUTE FUNCTION impedir_alteracao_baixa();

-- Reversão:
--   DROP TRIGGER "trg_baixas_titulo_imutavel" ON "baixas_titulo";
--   DROP FUNCTION impedir_alteracao_baixa();
--   DROP TABLE "baixas_titulo";
--   DROP TABLE "titulos";
--   DROP TYPE "TipoBaixa";
--   DROP TYPE "OrigemTitulo";
--   DROP TYPE "TipoTitulo";
