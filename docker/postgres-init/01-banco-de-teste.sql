-- Banco separado para a suíte de integração.
--
-- Os testes truncam tabelas entre casos. Rodar isso no banco de
-- desenvolvimento apagaria o cadastro que se estava usando para conferir algo
-- na tela — e o desenvolvedor descobriria depois, sem entender por quê.
CREATE DATABASE erp_teste OWNER erp;
