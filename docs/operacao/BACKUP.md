# Cópias de segurança

> Para o dono da loja, o gerente e o técnico. A primeira metade se usa pela tela;
> a segunda é do técnico, para quando a tela não está ao alcance.

---

## O que acontece sozinho

Sem ninguém configurar nada, desde o primeiro minuto da instalação:

| Quando | O quê |
|---|---|
| **De hora em hora** | Uma cópia do banco inteiro da loja |
| **Ao fechar cada caixa** | Uma cópia logo depois do fechamento — o movimento do dia salvo |
| **A qualquer momento** | "Fazer uma cópia agora", na retaguarda |

**Toda cópia é conferida.** Logo depois de feita, ela é aberta numa base à
parte, só para provar que restaura, e o sistema anota o que há nela: quantas
vendas, produtos e clientes, e de quando é a última venda. Uma cópia que não
abre aparece na tela como **falha** no mesmo minuto — e não no dia em que a loja
precisar dela.

O caixa **continua vendendo** enquanto a cópia é feita.

O banco do **treinamento** não é copiado: o que se faz nele é de mentira por
definição, e a cópia dele ocuparia o disco que a cópia da loja precisa
(ADR-0026).

### Quantas cópias ficam

As 24 mais recentes, uma por dia dos últimos 7 dias, uma por semana das últimas
4 semanas e uma por mês dos últimos 12 meses — perto de 47 arquivos. Assim dá
para voltar tanto ao "agora há pouco" quanto ao "como estava no mês passado", e
o disco não enche.

A cópia não começa com **menos de 1 GB livre** no disco: o banco e as cópias
dividem o mesmo disco, e encher o disco para o banco — e o banco parado para o
caixa.

---

## Como saber se está tudo bem

Retaguarda → **Cópias de segurança** (gerente e administrador).

O topo responde à pergunta que importa — *se o computador queimar agora, o que
eu perco?*:

- **"Última cópia boa: hoje, 14:00 (há 12 minutos) — 1.234 vendas…"** em verde:
  está tudo certo.
- Em amarelo, **"Ela está velha"**: a última cópia boa tem mais de duas voltas
  da agenda. Faça uma agora; se falhar, chame o suporte.
- Em vermelho, **"A última tentativa… não deu certo"**: a frase diz o motivo, e
  o "detalhe para o suporte" é o que o técnico precisa ouvir pelo telefone.

### A agenda (administrador)

"De hora em hora" até "Uma vez por dia", e a cópia ao fechar o caixa. Espaçar
as cópias é aceitar perder mais vendas se o disco queimar — a mudança fica na
auditoria, com o nome de quem mudou.

---

## Levar uma cópia para fora da loja

**As cópias ficam no disco deste computador.** Elas protegem contra o "apaguei
sem querer", o banco corrompido e o Windows que não sobe — **não contra roubo,
incêndio ou disco queimado**. Para isso, uma cópia precisa estar fora da loja.

Uma vez por semana, pelo menos:

1. Abra a pasta das cópias — o caminho aparece no pé da tela de cópias. Numa
   instalação padrão: `C:\ProgramData\ERP PDV\backup`.
2. Copie **os dois arquivos** da cópia mais recente — o `.dump` e o `.json` de
   mesmo nome — para um pendrive.
3. Guarde o pendrive **fora da loja**.

> ⚠️ **O pendrive leva os dados da loja inteira**, inclusive os dos clientes.
> Guarde-o como se guarda a chave da loja. A cópia em nuvem, cifrada, ainda não
> existe nesta versão (ADR-0027).

---

## Restaurar pela retaguarda (administrador)

Restaurar **troca o banco inteiro** pelo da cópia: tudo o que foi feito depois
dela sai do sistema. É para o dia em que algo deu muito errado.

1. **Feche os caixas.** A restauração espera: a venda feita num caixa aberto
   depois da cópia não teria mais onde entrar.
2. Retaguarda → **Cópias de segurança** → na cópia escolhida, **Conferir e
   restaurar…**
3. O sistema abre a cópia à parte e mostra, lado a lado, o que há **nela** e no
   **banco de agora** — vendas, última venda, produtos, clientes. Confira.
4. Digite **RESTAURAR** e clique em **Restaurar esta cópia**.

O sistema, nesta ordem: confere a cópia de novo, **faz uma cópia do banco de
agora** (marcada "Antes de restaurar"), e troca. Ou troca tudo, ou nada muda —
não existe banco pela metade.

### Durante e depois

- Durante a troca (de segundos a poucos minutos), a retaguarda e o caixa veem o
  sistema "em manutenção". **O caixa continua vendendo** pela fila da estação.
- Depois, o sistema pode pedir para **entrar de novo**: as sessões voltam a ser
  as da cópia.
- **Os caixas precisam ser abertos de novo.** As vendas que as estações
  guardaram durante a troca entram assim que houver caixa aberto.
- **Se foi engano**, restaure a cópia "Antes de restaurar": é o banco exatamente
  como estava. Ela fica guardada por pelo menos 7 dias.

### "Restaurar mesmo com caixas abertos"

Só aparece quando há caixa aberto, e só existe para o caixa que **não tem como**
ser fechado — a estação queimou junto, por exemplo. As vendas que as estações
guardarem durante a troca podem ser **recusadas** pelo servidor. A estação anota
cada recusa no log do Agente Local, e a venda continua gravada no arquivo da fila
da estação, que só cresce — é de lá que o suporte a recupera.

### Quando o sistema recusa

| A tela diz | O que fazer |
|---|---|
| Há N caixas abertos agora | Feche os caixas e tente de novo |
| Esta cópia é de outra versão do sistema | Chame o suporte: ela precisa ser restaurada na versão em que foi feita, e o sistema atualizado depois |
| Esta cópia não restaurou na conferência | Escolha outra cópia — esta está danificada |
| Essa cópia não está mais na pasta | Atualize a tela: a retenção pode tê-la tirado |
| Já há uma cópia de segurança em andamento | Espere alguns minutos e tente de novo |
| A cópia do banco atual, feita antes de restaurar, não passou na conferência | **Nada foi trocado.** Chame o suporte |

---

## Para o técnico

### Onde as coisas ficam

| O quê | Onde (instalação padrão) |
|---|---|
| Cópias (`.dump` + `.json` de mesmo nome) | `C:\ProgramData\ERP PDV\backup` |
| Ferramentas do PostgreSQL usadas na cópia | `C:\Program Files\ERP PDV\postgres\bin` |
| Configuração do servidor (inclui a senha do banco) | `C:\Program Files\ERP PDV\servidor\.env` |
| Serviços do Windows | `ERPPDVServidor` (o sistema) e `ERPPDVBanco` (o PostgreSQL) |

O `.json` é a ficha da cópia: data, origem, tamanho, SHA-256 do `.dump` e o que
a conferência viu. **Sem a ficha, a cópia não aparece na tela** — um `.dump`
solto na pasta não vira "cópia conferida" sem ter passado pela conferência.

### Computador novo, depois de o antigo queimar

1. Instale o sistema na máquina nova, na **mesma versão** da cópia (ver
   `INSTALACAO.md`).
2. Copie o `.dump` e o `.json` do pendrive para a pasta das cópias.
3. Entre na retaguarda como administrador e restaure pela tela. Na instalação
   nova não há caixa aberto, e a cópia aparece na lista.

### Restaurar sem a tela

Quando o sistema não sobe, ou o banco está tão danificado que a conferência não
consegue nem ler o banco de agora:

```bat
net stop ERPPDVServidor

cd "C:\Program Files\ERP PDV\postgres\bin"
rem A senha está no DATABASE_URL do servidor\.env, entre "erp:" e "@localhost".
set PGPASSWORD=<senha do banco>

pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error ^
  --single-transaction --host=localhost --port=55433 --username=erp ^
  --dbname=erp_pdv "C:\ProgramData\ERP PDV\backup\copia-AAAAMMDD-HHMMSS-automatica.dump"

set PGPASSWORD=
net start ERPPDVServidor
```

`--single-transaction` é o que garante o tudo-ou-nada: se o comando falhar no
meio, o banco continua como estava. Antes, se o banco ainda abre, faça uma cópia
dele com `pg_dump --format=custom` — é a volta, se a restauração for engano.

### O histórico das tentativas

Cada tentativa, inclusive as que falharam sem deixar arquivo, fica em
`execucoes_backup`:

```sql
SELECT iniciada_em, operacao, origem, situacao, arquivo, erro
FROM execucoes_backup
ORDER BY iniciada_em DESC
LIMIT 20;
```

A agenda é a linha única de `configuracao_backup`. `manter_ultimos` — quantas
cópias recentes ficam — **não aparece na tela de propósito**: é o ajuste para a
loja cujo banco já pesa no disco.

### Falhas comuns

| Detalhe para o suporte | Causa provável |
|---|---|
| `server version mismatch` | O `pg_dump` não é o da instalação: confira `PASTA_BINARIOS_POSTGRES` no `.env` |
| `ENOENT` | As ferramentas não estão na pasta indicada em `PASTA_BINARIOS_POSTGRES` |
| `connection refused` | O serviço `ERPPDVBanco` está parado |
| "O disco do servidor tem só … livres" | Libere espaço; a cópia volta sozinha na hora seguinte |

---

## O que esta versão ainda não faz

Registrado com honestidade (ADR-0027):

- **Cópia fora da loja automática** — nuvem cifrada ou pendrive detectado
  sozinho. Hoje, só o pendrive à mão.
- **Voltar a qualquer instante** (PITR). Volta-se a uma cópia: a perda máxima,
  se o disco queimar, é o intervalo da agenda — uma hora, no padrão.
- **Baixar a cópia pelo navegador.** Entra junto com a cifra: o arquivo leva os
  dados dos clientes.
