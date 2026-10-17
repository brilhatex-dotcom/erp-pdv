-- Reversão da migração `backup_agenda`.
--
-- Como usar, numa instalação que precisa voltar à versão anterior:
--
--   1. cópia de segurança antes de tudo (a tela de cópias, ou `pg_dump`);
--   2. `psql -v ON_ERROR_STOP=1 -f reversao.sql` no banco da loja;
--   3. instalar a versão anterior.
--
-- O próprio script tira a migração de `_prisma_migrations`, pelo mesmo motivo
-- da reversão de `balcao_completo`: sem isso, a versão anterior acharia o banco
-- à frente dela.
--
-- **O que muda**: as tentativas registradas com a origem RESTAURACAO passam a
-- MANUAL — foi uma pessoa que pediu a restauração que as originou. Sem isso, a
-- restrição antiga recusaria as linhas e a reversão pararia no meio. A
-- configuração já gravada continua como está: só o padrão volta a 24/30.

BEGIN;

UPDATE "execucoes_backup" SET "origem" = 'MANUAL' WHERE "origem" = 'RESTAURACAO';

ALTER TABLE "execucoes_backup" DROP CONSTRAINT "ck_execucoes_origem";

ALTER TABLE "execucoes_backup"
  ADD CONSTRAINT "ck_execucoes_origem"
    CHECK ("origem" IN ('MANUAL', 'AGENDADO', 'FECHAMENTO'));

ALTER TABLE "configuracao_backup"
  ALTER COLUMN "intervalo_horas" SET DEFAULT 24,
  ALTER COLUMN "manter_ultimos" SET DEFAULT 30;

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261017120000_backup_agenda';

COMMIT;
