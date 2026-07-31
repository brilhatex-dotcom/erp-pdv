# ADR-0020 — `@erp/cliente-api` como pacote compartilhado entre retaguarda e PDV

| Campo | Valor |
|---|---|
| **Status** | Aceito |
| **Data** | 31/07/2026 |
| **Decisores** | Arquiteto · Dev Sênior · Segurança · UX/UI |

## Contexto

Na Etapa 7a, o cliente HTTP, a sessão em memória e o contexto React de autenticação
nasceram dentro de `apps/web`. Era o lugar certo enquanto havia **uma** interface.

A Etapa 7b criou a segunda: `apps/pdv`. E as duas precisam exatamente do mesmo
comportamento na borda mais delicada do sistema:

- token de acesso **em memória**, nunca em `localStorage` — o refresh mora em cookie
  `httpOnly`, fora do alcance de qualquer script;
- **renovação transparente** no 401, com promessa compartilhada para que dez
  requisições simultâneas não disparem dez renovações — o servidor trata reuso de
  refresh como roubo de sessão e revoga a família inteira, então renovações
  concorrentes derrubariam o próprio operador;
- tradução de erro do servidor para **frase que o operador entende**, sem código HTTP
  nem stack trace.

Copiar isso para o PDV significaria manter duas cópias de uma lógica de segurança.
A segunda cópia começa idêntica e diverge na primeira correção feita com pressa —
e a divergência aparece como sessão caindo no balcão, no horário de pico.

## Decisão

Extrair para o pacote **`@erp/cliente-api`**, consumido por `apps/web` e `apps/pdv`.

O pacote conhece HTTP e o navegador. **Não** conhece regra de negócio: nada de
"venda", "caixa" ou "produto" atravessa a sua fronteira. Ele transporta e traduz.

O que muda de comportamento entre as duas interfaces é **parâmetro, não código**:
`ProvedorSessao` recebe `contexto="PDV"` ou `contexto="RETAGUARDA"`, e é o servidor
quem decide, a partir disso, se a credencial exigida é PIN ou senha longa
(ADR-0011), comparando contra `hashPin` ou `hashSenha`.

Esse parâmetro **não afrouxa exigência**: declarar `"PDV"` na retaguarda não abre
porta nenhuma — continuaria sendo necessário o PIN cadastrado daquele usuário. Ele
informa a origem, não o nível de confiança.

A primeira versão do pacote fixava `"RETAGUARDA"` no código, e o efeito era
silencioso e total: o PDV mandava `"RETAGUARDA"`, o servidor conferia o PIN de seis
dígitos contra o hash da senha longa e **nenhum operador conseguia entrar no
caixa**. Sem mensagem útil — só "matrícula ou senha incorreta", que é o que o
servidor deve responder para não revelar qual dos dois errou. Daí o parâmetro ser
obrigatório: um `contexto` que se pode esquecer volta a ser um valor fixo errado.

## Consequências

**A favor**

- Uma correção de segurança na renovação de sessão vale para as duas interfaces no
  mesmo commit.
- O comportamento fica testável em isolamento: 23 testes cobrem o cliente e o
  contexto sem subir nenhuma tela.
- `apps/pdv` e `apps/web` ficam só com o que é delas — telas e fluxo.

**Contra**

- Mais um pacote no grafo, com o seu `package.json`, `tsconfig` e configuração de
  teste. O custo é real e foi aceito porque a alternativa é duplicar autenticação.
- O pacote depende do DOM (`fetch`, `localStorage`, React). Não é candidato a rodar
  no servidor, e o `dependency-cruiser` o mantém fora do caminho de `@erp/domain`.

## Alternativas consideradas

| Alternativa | Por que não |
|---|---|
| Copiar os arquivos para `apps/pdv` | Duas cópias de lógica de sessão divergem na primeira correção — e o sintoma é o operador deslogando no pico |
| `apps/web` exportar para o PDV | Faria a frente de caixa depender da retaguarda inteira: uma quebra na tela de consulta de produto derrubaria o build do PDV |
| Deixar o PDV sem renovação transparente | O turno dura oito horas e o token vale quinze minutos. Seriam trinta e duas interrupções por turno |

## Referências

- ADR-0011 (`CLAUDE.md` §1) — PIN no balcão, senha longa na retaguarda
- `docs/ARQUITETURA.md` §3.3 — grafo de dependências
