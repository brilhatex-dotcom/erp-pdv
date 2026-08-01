# ADR-0024 — Uma empresa por instalação

| Campo | Valor |
|---|---|
| **Status** | Aceito |
| **Data** | 01/08/2026 |
| **Decisores** | Responsável pelo produto · Arquiteto · DBA PostgreSQL · Analista de Negócios |

## Contexto

O roteiro do produto passou a incluir um módulo "Empresas". O termo comporta
duas coisas muito diferentes, e escolher errado é caro nos dois sentidos:

- **Cadastro da empresa**: uma tabela com CNPJ, razão social, endereço, logotipo
  e regime tributário. É o emitente dos documentos e o cabeçalho dos relatórios.
- **Multiempresa**: um banco atendendo N empresas com dados isolados, o que
  exige `empresa_id` em toda tabela, em todo índice e em **toda** consulta.

## Decisão

**Uma instalação atende uma empresa.** A tabela `empresas` existe com uma única
linha, e **nenhuma outra tabela ganha `empresa_id`**.

Cliente com duas lojas recebe duas instalações.

## Por quê

A topologia do produto já decidiu isso, e reconhecê-lo é mais barato que
contrariá-lo. O ADR-0013 embarca um PostgreSQL por instalação; o ADR-0001 coloca
um servidor dentro de cada loja. Multiempresa é uma resposta a hospedagem
centralizada — que este produto não faz.

O perfil-alvo confirma: 1 a 3 computadores por cliente, sem equipe de TI
(`CLAUDE.md` §2). Não é o cliente que tem quinze filiais num banco só.

E o custo de errar para o lado complexo é assimétrico. `empresa_id` em toda
tabela significa que **toda** consulta passa a poder esquecer o filtro — e o
esquecimento não dá erro: dá dado de um cliente aparecendo para outro. É o pior
defeito que um sistema de gestão pode ter, e nenhum teste o pega por acaso.

Complexidade que ninguém paga é rejeitada (`CLAUDE.md` §2).

## Consequências

### Positivas

- O schema atual continua válido: nenhuma migração em tabela existente.
- Instalações são isoladas por construção. Não existe caminho pelo qual o dado
  de uma loja alcance outra, porque não existe banco compartilhado.
- Backup e restauração continuam simples: um banco, uma loja.

### Negativas — o custo aceito, declarado honestamente

- **Rede com várias lojas paga por instalação**, e a consolidação entre elas não
  existe. Se esse cliente aparecer, o caminho não é multiempresa: é um serviço
  de consolidação que lê as instalações — decisão separada, com ADR próprio.
- Se um dia multiempresa for necessário, a migração é grande. Foi pesado contra
  a alternativa de carregar `empresa_id` desde já sem usar, e o risco de vazar
  dado entre clientes pesou mais que o custo de uma migração futura.

### Neutras

- A empresa continua sendo o emitente fiscal quando o módulo for habilitado
  (ADR-0016). Nada aqui conflita com isso.

## Como reverter

Migração expand-contract acrescentando `empresa_id` às tabelas, preenchido com a
empresa única existente, seguida de revisão de **toda** consulta. É trabalho
grande e conhecido — e é exatamente por ser conhecido que adiá-lo é seguro.
