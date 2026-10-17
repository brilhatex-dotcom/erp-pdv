-- Agenda das cópias de segurança.
--
-- 1. O padrão passa a ser o da ARQUITETURA.md §10.3: cópia de hora em hora,
--    com as 24 mais recentes guardadas. O 24/30 de antes era de quando a
--    retenção ainda não era avô-pai-filho; com ela, "manter_ultimos" é a escala
--    das recentes, e as diárias, semanais e mensais ficam além dela.
--
-- 2. O registro de tentativas ganha a origem RESTAURACAO: a cópia feita logo
--    antes de uma restauração, que é o caminho de volta se a restauração foi
--    engano. Registrá-la como MANUAL esconderia do suporte por que ela existe.
--
-- Só expande: nenhuma linha muda, e a versão anterior do sistema continua
-- funcionando com o banco migrado — ela nunca grava a origem nova.

ALTER TABLE "configuracao_backup"
  ALTER COLUMN "intervalo_horas" SET DEFAULT 1,
  ALTER COLUMN "manter_ultimos" SET DEFAULT 24;

ALTER TABLE "execucoes_backup" DROP CONSTRAINT "ck_execucoes_origem";

ALTER TABLE "execucoes_backup"
  ADD CONSTRAINT "ck_execucoes_origem"
    CHECK ("origem" IN ('MANUAL', 'AGENDADO', 'FECHAMENTO', 'RESTAURACAO'));
