# ADR-0027 — Cópias de segurança da V1: `pg_dump` provado por restauração, sem PITR e sem cópia externa automática

| Campo | Valor |
|---|---|
| **Status** | Aceito |
| **Data** | 17/10/2026 |
| **Decisores** | Arquiteto · DBA PostgreSQL · Especialista em Segurança · DevOps · Analista de Negócios · UX |

## Contexto

`docs/ARQUITETURA.md` §10 descreve a proteção dos dados em quatro camadas: WAL
arquivado continuamente (restauração a qualquer instante — PITR), cópias locais
automáticas com retenção avô-pai-filho, cópia externa cifrada (nuvem ou HD
externo) e a guarda separada dos XMLs fiscais.

A primeira versão comercial precisa de proteção **de verdade desde o primeiro
dia**: o lojista de bairro não tem TI, o computador do caixa é o servidor, e o
dia em que o disco queima é o dia em que o produto é julgado. Mas as quatro
camadas juntas são três projetos diferentes, e dois deles têm custo que a V1
não pode assumir sem decisão de negócio:

- **PITR** exige arquivar WAL (configuração do cluster, pasta própria, limpeza)
  e, sobretudo, uma restauração **física**: parar o serviço do PostgreSQL,
  trocar o diretório de dados, recuperar até um instante. Nenhum lojista executa
  isso, e o assistente gráfico que o tornaria clicável é um projeto à parte.
- **Nuvem cifrada** tem custo recorrente por cliente e por gigabyte — a regra
  permanente do `CLAUDE.md` §2 exige apresentar as alternativas e quem paga a
  conta antes de decidir. Essa decisão não foi tomada.

## Decisão

A V1 entrega a **camada local completa**, com verificação mais forte que a
prevista, e deixa PITR e cópia externa automática **explicitamente** para depois.

1. **`pg_dump` no formato próprio**, consistente e comprimido, sem parar as
   vendas. De hora em hora por padrão (a agenda vai de 1 a 24 horas), uma cópia
   logo depois de cada fechamento de caixa, e a cópia "agora" pela retaguarda.
   O padrão vale desde o primeiro minuto da instalação, sem ninguém configurar.
2. **Toda cópia é provada**: restaurada numa base descartável, criada e apagada
   na hora, e resumida (vendas, produtos, clientes, período, caixas abertos e a
   lista de migrações). A cópia que não restaura é guardada como tal e aparece
   na tela como falha no mesmo minuto.
3. **Toda tentativa fica registrada** em `execucoes_backup`, inclusive a que
   falhou sem deixar arquivo — com a frase para a tela e o detalhe técnico para
   o suporte. A tela abre dizendo quando foi a última cópia **boa**.
4. **Retenção avô-pai-filho** — 24 recentes, 7 diárias, 4 semanais, 12
   mensais. Só a cópia provada ocupa lugar. As recentes são ajustáveis pelo
   suporte (`manter_ultimos`), não pela tela. A cópia feita antes de uma
   restauração fica pelo menos 7 dias e não dispara a retenção.
5. **Restauração pela retaguarda**, só com `config:backup`: a cópia é conferida
   de novo e mostrada lado a lado com o banco de agora; exige a palavra
   RESTAURAR; recusa cópia de outra versão (lista de migrações diferente);
   recusa com caixas abertos, salvo pedido explícito; faz uma cópia do banco de
   agora antes de trocar; troca com `pg_restore --clean --single-transaction`
   (tudo ou nada); e põe a API em manutenção (503) enquanto troca — o caixa
   trata 503 como servidor fora e segue vendendo pela fila da estação.
6. **As ferramentas são as do PostgreSQL** (`pg_dump`, `pg_restore`, `psql`), as
   que o instalador embarca na mesma versão do servidor — e as que o suporte
   usaria à mão.
7. **As cópias ficam no disco do servidor**, na pasta de dados da instalação.
   Levar uma cópia para fora da loja é copiar essa pasta para um pendrive — a
   tela e `docs/operacao/BACKUP.md` dizem isso com todas as letras.

## Alternativas consideradas

| Alternativa | A favor | Contra | Situação |
|---|---|---|---|
| **Não fazer nada na V1** — o técnico agenda um `pg_dump` no Windows | Zero desenvolvimento | Cada instalação depende do técnico lembrar; nenhuma verificação; o suporte não vê se roda; dado perdido não volta (hierarquia nº 2) | Rejeitada |
| **Cópia sem prova** — só `pg_dump`, tamanho e hash | Metade da carga de disco e CPU | Cópia truncada só é descoberta no dia em que é preciso (§10.4: "backup que não restaura é ilusão de segurança") | Rejeitada |
| **Restaurar num banco novo e renomear** | O banco antigo fica intacto, como volta instantânea | Exige derrubar as conexões do servidor, permissão de renomear banco e o dobro do disco | Rejeitada: `--single-transaction` + a cópia de antes dão a mesma volta sem derrubar ninguém |
| **WAL + PITR já na V1** | Perda máxima perto de zero | Restauração física, fora do alcance do lojista; projeto próprio | **Adiada** |
| **Nuvem cifrada** | Sobrevive a roubo e incêndio | Custo recorrente por cliente e por GB; chave de cifra para custodiar | **Adiada — decisão de negócio pendente** |
| **Pendrive detectado automaticamente** | Cópia fora do disco sem depender de lembrar | Detecção de mídia no Windows, unidade que muda de letra, pendrive cheio | **Adiada** |
| **Baixar a cópia pelo navegador** | Qualquer computador da loja leva uma cópia | O arquivo carrega dado pessoal de clientes (LGPD) e hashes de senha, sem cifra, para fora do servidor | **Adiada** — junto com a cifra |

## Custo recorrente

A V1 não cria custo recorrente para o fabricante. Para o cliente, consome:

- **Disco do servidor**: perto de 47 cópias. Com um banco de 100 MB, a cópia
  comprimida fica entre 10 e 20 MB — de 0,5 a 1 GB no total. **A variável que
  domina é o tamanho do banco**; ele cresce com os anos de venda. A cópia não
  começa com menos de 1 GB livre, para não encher o disco do banco.
- **CPU e disco de hora em hora**: o `pg_dump` e a restauração da prova. Numa
  loja pequena são segundos; num banco de vários gigabytes, minutos.

## Consequências

- ✅ A loja está protegida desde o primeiro minuto, e a falha aparece na tela
  e no registro — o "achei que o backup estava funcionando" deixa de existir.
- ✅ Toda cópia listada como boa **restaurou de verdade**, e a restauração é
  clicável, com volta garantida.
- ⚠️ **A perda máxima é o intervalo da agenda** (1 hora por padrão), e não
  "perto de zero" como diz o §10.5 para a arquitetura completa. As vendas que
  estavam na fila das estações sobrevivem; as que já estavam no banco desde a
  última cópia, não.
- ⚠️ **Roubo, incêndio e disco queimado só são cobertos pelo pendrive manual.**
  É a maior lacuna da V1, e quem vende o produto precisa dizer isso ao lojista.
- ⚠️ **Carga de hora em hora no computador do caixa.** **Gatilho de revisão**:
  se o balcão sentir lentidão durante a cópia numa loja real, baixar a
  prioridade dos processos do PostgreSQL ou espaçar a prova.
- ⚠️ A restauração com caixa aberto depois da cópia faz as vendas guardadas
  pela estação durante a troca serem recusadas — e o Agente as tira da fila
  (registro no log da estação). Por isso a restauração espera os caixas
  fecharem, e a saída "mesmo assim" existe só para o caixa que não tem como ser
  fechado.
- O registro de tentativas vive no banco, e o banco é o que a restauração troca:
  depois de restaurar, o histórico de tentativas volta ao da cópia, mais a
  restauração. As cópias, que moram na pasta, não voltam no tempo.
