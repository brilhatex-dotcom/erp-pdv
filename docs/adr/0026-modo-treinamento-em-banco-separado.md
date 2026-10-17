# ADR-0026 — Modo treinamento num segundo banco, com as mesmas regras

| Campo | Valor |
|---|---|
| **Status** | Aceito |
| **Data** | 17/10/2026 |
| **Decisores** | Arquiteto · Especialista em Segurança · DBA PostgreSQL · UX · Analista de Negócios · DevOps |

## Contexto

O operador novo aprende no balcão, com cliente na fila — e o erro de quem
aprende vira venda errada, estoque errado e gaveta que não bate. A loja precisa
de um lugar para treinar **a tela de verdade**, com os produtos, o peso, o
troco, o desconto e a liberação do supervisor, sem que nada do que acontece ali
toque o movimento real.

O pedido do produto é explícito: treinamento com dados de demonstração
separados, e as simulações (o Pix e o cartão "confirmados" sem maquininha) só no
treinamento.

O que não pode acontecer, em ordem de gravidade:

1. Uma venda de treino entrar no banco da loja — no caixa, no estoque, no fiado
   ou no relatório.
2. Uma sessão de treino abrir alguma coisa no sistema real — e o PIN das pessoas
   de treino é público.
3. A gaveta de verdade abrir para o troco de mentira.
4. O treino depender de alguém configurar algo para funcionar — ou derrubar a
   loja quando falhar.

Havia, antes desta decisão, um caminho para o item 1: no treino, a queda do
servidor fazia a venda cair para a fila do Agente Local, que a entregaria depois
ao servidor **de verdade**. Ele foi fechado aqui.

## Decisão

**Um segundo banco, `erp_pdv_treino`, no mesmo PostgreSQL, com as mesmas
migrações, servido pelos mesmos casos de uso sob o prefixo `/treino`.**

1. **O servidor monta dois containers.** O real, como sempre, e um segundo, com
   `modo: "TREINAMENTO"`, ligado a `DATABASE_URL_TREINAMENTO`. As rotas da loja
   são registradas duas vezes — na raiz e sob `/treino` —, por uma lista só: o
   treino ensina o que o caixa faz de verdade, e não uma imitação dele. Cópia
   de segurança, saúde e a fila do Agente ficam só na raiz.
2. **O token e o cookie de um modo não valem no outro.** O emissor do token é
   `erp-pdv-treinamento` no treino; os cookies de sessão do treino têm nome
   próprio e valem só no caminho `/treino`. No treino, cada requisição confere
   ainda que a sessão existe no banco: depois de "recomeçar", o token emitido
   antes deixa de valer na hora, e a outra estação que treinava volta à
   entrada em vez de operar em nome de quem não existe mais.
3. **Pagamento simulado só no treino.** A confirmação `SIMULADA` é recusada
   fora dele (`permiteSimulacao`); no treino, Pix e cartão saem simulados.
4. **A loja de demonstração se monta sozinha** quando o banco de treino está
   vazio (sem ninguém cadastrado): a primeira abertura do treino, ou a seguinte
   a "recomeçar". Configuração mista, cinco categorias, treze produtos — por
   unidade, por peso com código de balança e com código de barras —, estoque
   inicial lançado como entrada, dois clientes com fiado e três pessoas
   (operador `901`/`121212`, supervisor `902`/`232323`, gerente
   `903`/`343434`). Uma montagem por vez: duas estações abrindo o treino no
   mesmo segundo não montam a loja duas vezes.
5. **A trava mora no banco, e confere o nome dele.** Antes de montar a loja e
   antes de esvaziar qualquer tabela, o adaptador pergunta ao PostgreSQL o nome
   do banco em que está conectado e recusa o que não terminar em `_treino`. É o
   que impede, no dia em que alguém apontar `DATABASE_URL_TREINAMENTO` para o
   banco da loja, um `TRUNCATE` no movimento real — ou um gerente de PIN
   público gravado numa loja recém-instalada. O ambiente já recusa essa
   configuração na partida; a trava do banco é a segunda camada.
6. **Recomeçar o treinamento** esvazia o banco de treino (menos o registro das
   migrações) e monta a loja de novo. Exige estar no treino: o token vai no
   cabeçalho, que uma página de outro site não consegue mandar.
7. **No PDV**, "Treinar" aparece na entrada do caixa quando o servidor tem
   treino. O modo fica guardado **na aba** (`sessionStorage`): o F5 continua no
   treino, e a janela nova — ou a estação religada de manhã — volta sempre ao
   caixa de verdade. No treino, a estação:
   - fala com `/treino` por um cliente da API próprio — login, venda, caixa;
   - **não usa a fila offline**: sem servidor, o treino para e diz por quê;
   - **não guarda a configuração** que o caixa usa sem servidor;
   - **não abre a gaveta** — o comprovante sai marcado "TREINAMENTO - SEM
     VALOR", e só;
   - não mostra o indicador da fila do Agente, que é da loja;
   - mostra a faixa de treinamento em toda tela, os códigos para treinar sem
     leitor na entrada e na ajuda (F1), e "Recomeçar o treino" (8) e "Sair do
     treino" (9) no menu do caixa.
8. **O instalador** cria `erp_pdv_treino`, aplica as migrações nos dois bancos e
   grava `DATABASE_URL_TREINAMENTO`. Falhar no banco de treino é aviso, nunca
   erro: a instalação da loja segue.
9. **O treino não tem cópia de segurança.** É de mentira por definição.

## Alternativas consideradas

| Alternativa | A favor | Contra | Situação |
|---|---|---|---|
| **Mesmo banco, com marca "treino" nas linhas** | Uma instalação, um banco | Cada consulta de relatório, estoque e caixa passa a precisar de `WHERE treino = false`; a que esquecer mistura treino com movimento real — e esquecer é questão de tempo (integridade, hierarquia nº 2) | Rejeitada |
| **Simular no navegador** | Nada no servidor | Repete a regra de negócio na tela — o `CLAUDE.md` §9 proíbe —, e o treino ensinaria uma imitação que diverge do caixa | Rejeitada |
| **Instalação separada só para treinar** | Isolamento total | Outro servidor, outra porta, outro serviço: suporte multiplicado para uma função auxiliar | Rejeitada |
| **Segundo banco no mesmo servidor** | Isolamento de dados por construção, as mesmas regras, nada a configurar | Um banco a mais para migrar em cada atualização; uma montagem a mais no servidor | **Aceita** |

## Custo

Nenhum recorrente. O banco de treino ocupa poucos megabytes e não entra nas
cópias de segurança. Cada atualização aplica as migrações nos dois bancos — uns
segundos a mais no instalador. No treino, cada requisição faz uma consulta a
mais (a sessão); na loja, nenhuma.

## Consequências

- ✅ Uma venda de treino não tem caminho para o banco da loja: outro banco,
  outro token, outro cookie — e nenhuma fila.
- ✅ O operador treina na tela de verdade, com as regras de verdade.
- ⚠️ O PIN das pessoas de treino é conhecido. Elas só existem no banco de
  treino, e o token delas não vale fora dele — mas quem estiver na rede da loja
  consegue treinar sem pedir. É o objetivo.
- ⚠️ O treino precisa do servidor no ar: sem a fila offline, servidor fora é
  treino parado. Treinar sem servidor não ensinaria nada que valha.
- ⚠️ Uma migração que falhe no banco de treino não impede a loja de abrir: o
  servidor sobe, o treino responde "indisponível" e o botão some da entrada. O
  real nunca depende do de treino.
- ⚠️ Recomeçar derruba quem estiver treinando em outra estação — que volta à
  entrada do treino com os mesmos PINs.
