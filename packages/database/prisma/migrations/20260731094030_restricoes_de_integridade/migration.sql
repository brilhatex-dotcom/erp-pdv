-- Restrições que o Prisma não expressa no schema, escritas à mão.
--
-- Elas existem porque validação em aplicação não é garantia: basta um script
-- de correção, uma importação ou um segundo processo para violar a regra. O
-- banco é a última linha de defesa, e a única que não depende de quem escreve
-- o código.

-- ── Uma única sessão de caixa aberta por estação ──────────────────────────
--
-- Índice parcial: só as sessões ABERTA disputam a chave. Duas aberturas
-- simultâneas na mesma estação — dois cliques, duas janelas — falham no banco
-- em vez de duplicar o fundo de troco.
CREATE UNIQUE INDEX "uq_sessao_aberta_por_estacao"
  ON "sessoes_caixa" ("estacao_id")
  WHERE "status" = 'ABERTA';

-- ── Movimento de estoque é append-only (princípio 5 do CLAUDE.md) ─────────
--
-- Correção de estoque gera movimento novo; jamais UPDATE ou DELETE. Sem isto,
-- o saldo deixa de ser reconstruível a partir dos fatos, e a auditoria de
-- inventário perde o sentido.
CREATE OR REPLACE FUNCTION impedir_alteracao_movimento()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'movimentos_estoque e append-only: corrija com um movimento de ajuste, nao com %', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_movimentos_estoque_imutavel
  BEFORE UPDATE OR DELETE ON "movimentos_estoque"
  FOR EACH ROW EXECUTE FUNCTION impedir_alteracao_movimento();

-- ── Invariantes de valor ──────────────────────────────────────────────────
--
-- Espelham as regras já validadas no domínio. A duplicação é deliberada: o
-- domínio protege o fluxo normal, o banco protege contra todo o resto.

-- Quantidade de movimento é sempre positiva; o sinal vem do tipo.
ALTER TABLE "movimentos_estoque"
  ADD CONSTRAINT "ck_movimentos_quantidade_positiva" CHECK ("quantidade" > 0);

ALTER TABLE "produtos"
  ADD CONSTRAINT "ck_produtos_preco_nao_negativo" CHECK ("preco_venda" >= 0);

ALTER TABLE "produtos"
  ADD CONSTRAINT "ck_produtos_custo_nao_negativo" CHECK ("custo" >= 0);

-- Código de balança só existe em produto pesável: a etiqueta vem da balança.
ALTER TABLE "produtos"
  ADD CONSTRAINT "ck_produtos_balanca_so_pesavel"
  CHECK ("codigo_balanca" IS NULL OR "tipo" = 'PESAVEL');

ALTER TABLE "sessoes_caixa"
  ADD CONSTRAINT "ck_sessoes_fundo_nao_negativo" CHECK ("fundo_troco" >= 0);

ALTER TABLE "pagamentos"
  ADD CONSTRAINT "ck_pagamentos_valor_positivo" CHECK ("valor" > 0);

-- Embalagem com fator 1 seria a própria unidade base — cadastro sem sentido
-- que quebraria a conversão no recebimento de mercadoria.
ALTER TABLE "embalagens"
  ADD CONSTRAINT "ck_embalagens_fator_maior_que_um" CHECK ("fator" > 1);
