-- Reversão da migração `compras_entrada_de_mercadoria`.
--
-- O portão do CLAUDE.md §7 exige script de reversão testado. Esta migração é
-- puramente aditiva — duas tabelas novas e um enum novo —, então desfazê-la é
-- derrubá-las. **Destrói as notas de compra lançadas**: os movimentos de estoque
-- que elas geraram continuam de pé, porque `origem_documento_id` não tem chave
-- estrangeira, mas passam a apontar para um documento que não existe mais.
--
-- Rodar apenas em instalação onde nenhuma nota foi lançada, ou depois de
-- exportar `notas_compra` e `itens_nota_compra`.

DROP TABLE IF EXISTS "itens_nota_compra";
DROP TABLE IF EXISTS "notas_compra";
DROP TYPE IF EXISTS "StatusNotaCompra";
