-- Banco separado para a suíte de integração.
--
-- Os testes truncam tabelas entre casos. Rodar isso no banco de
-- desenvolvimento apagaria o cadastro que se estava usando para conferir algo
-- na tela — e o desenvolvedor descobriria depois, sem entender por quê.
CREATE DATABASE erp_teste OWNER erp;

-- Banco próprio da suíte do servidor. O Turbo roda os pacotes em paralelo, e
-- duas suítes truncando as mesmas tabelas produziriam falha intermitente.
CREATE DATABASE erp_teste_api OWNER erp;
