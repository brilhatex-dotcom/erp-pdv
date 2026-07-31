# ADR-0018 — Um papel por usuário, com papéis personalizáveis

| Campo | Valor |
|---|---|
| **Status** | Aceito |
| **Data** | 31/07/2026 |
| **Decisores** | Responsável pelo produto · Analista de Negócios · UX/UI · Segurança · Arquiteto |

## Contexto

O diagrama de `ARQUITETURA.md` §9.1 mostrava `Usuário --possui--> Papéis`, no plural,
sugerindo que um usuário acumularia vários papéis — o RBAC clássico.

Ao implementar o domínio de identidade a pergunta virou concreta: `Usuario` guarda um
`Papel` ou uma coleção deles? A escolha muda a resposta a uma pergunta que o dono da
loja faz com frequência: **"por que o João consegue fazer isso?"**

Com papel múltiplo, responder exige somar conjuntos de permissões mentalmente e
descobrir qual dos papéis concedeu o quê. Pior: os **limites por valor** (§9.4) também
se acumulam, e aí é preciso decidir se dois papéis com tetos de desconto diferentes
produzem o maior, o menor ou a soma. Nenhuma dessas respostas é óbvia para quem não
tem equipe de TI — que é o perfil dominante do produto.

A necessidade real que motiva papel múltiplo existe e é banal: **o funcionário que
vende e também repõe estoque**. Em loja de 1 a 3 computadores, é a regra, não a
exceção.

## Decisão

**Cada usuário tem exatamente um papel.** Papéis continuam **personalizáveis**: a loja
cria os próprios combinando permissões e limites, e os sete de fábrica são ponto de
partida, não camisa de força.

O funcionário que vende e repõe estoque recebe um papel que faz as duas coisas — uma
configuração que o dono da loja entende olhando a tela, sem precisar entender
composição de conjuntos.

Consequência técnica direta: `Usuario.papel` é singular, e a resolução de permissão é
uma consulta a um único conjunto. O limite por valor vem de um lugar só, e não há regra
de combinação a inventar nem a explicar.

## Alternativas consideradas

| Alternativa | Por que não |
|---|---|
| **Papéis múltiplos com união de permissões** | RBAC clássico e conhecido, mas exige definir como os **limites** se combinam. Qualquer regra escolhida (maior, menor, soma) surpreende alguém — e "surpresa" em teto de desconto é dinheiro |
| **Papéis múltiplos com precedência declarada** | Resolve a ambiguidade dos limites, ao custo de uma ordenação que o usuário precisa configurar e entender. Complexidade que ninguém pediu e que gera chamado |
| **Permissões avulsas por usuário, sem papel** | Máxima flexibilidade e o pior custo de manutenção: cada contratação vira uma matriz de 30 caixas de seleção, e ninguém audita o que já foi concedido |
| **Papel único e fixo, sem personalização** | Simples demais. O funcionário que vende e repõe estoque não teria como ser representado, e a loja usaria o papel de gerente para tudo — que é como o controle de acesso morre na prática |

## Consequências

**Positivas**

- "Por que o João consegue isso?" tem resposta de uma linha: o papel dele.
- Não existe regra de combinação de limites — logo, não existe a classe de defeitos em
  que um teto de desconto emerge de uma soma que ninguém pretendeu.
- O domínio fica menor: `temPermissao` é uma consulta a um conjunto.

**Negativas**

- Uma loja que queira duas responsabilidades sobrepostas precisa **criar um papel**, em
  vez de marcar duas caixas. É um passo a mais na primeira configuração.
- Se no futuro aparecer um cliente com estrutura organizacional complexa — várias
  filiais, hierarquias — a decisão precisará ser revista. Está fora do perfil do
  produto hoje (1 a 3 computadores, sem TI).

**Neutras**

- Os sete papéis de fábrica cobrem os nove segmentos-alvo sem personalização em boa
  parte dos casos.

## Como reverter

Passar `Usuario` a guardar uma coleção de papéis e definir a regra de combinação de
limites — que é a parte difícil, e que este ADR evita justamente por não haver resposta
neutra. A migração é aditiva: um usuário com um papel é caso particular de um usuário
com vários.

## Relacionados

- ADR-0011 — PIN no PDV, senha + 2FA na retaguarda
- `docs/ARQUITETURA.md` §9 — modelo de permissões, limites e onde a autorização é aplicada
