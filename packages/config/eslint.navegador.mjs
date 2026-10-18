import base from "./eslint.base.mjs";

/**
 * Lint do código que roda no navegador da estação (PDV, retaguarda e os
 * pacotes que eles carregam).
 *
 * A loja fala **HTTP puro** na rede local (ADR-0028). Só o computador do
 * servidor abre o sistema por `localhost`, que o navegador trata como contexto
 * seguro; o segundo caixa abre por `http://NOME-DO-SERVIDOR:3000`, e ali certas
 * APIs **não existem**. O defeito não aparece no desenvolvimento, nem no CI, nem
 * na instalação testada no próprio servidor — aparece na loja, no segundo
 * computador, com a tela dizendo "sem conexão" para um servidor de pé.
 *
 * Por isso a regra é mecânica: acessar a API é erro de lint, e a mensagem diz o
 * que usar no lugar.
 */
const SO_EM_CONTEXTO_SEGURO = [
  {
    selector: "MemberExpression[property.name='randomUUID']",
    message:
      "crypto.randomUUID() só existe em HTTPS ou localhost, e o 2º caixa da loja abre o sistema por HTTP (ADR-0028). Use crypto.getRandomValues (novoUuid / novoIdentificador).",
  },
  {
    selector: "MemberExpression[property.name='subtle']",
    message:
      "crypto.subtle só existe em HTTPS ou localhost (ADR-0028). Faça a operação no servidor ou no Agente Local.",
  },
  {
    selector: "MemberExpression[property.name='clipboard']",
    message:
      "navigator.clipboard só existe em HTTPS ou localhost (ADR-0028). Ofereça o texto selecionado para o operador copiar.",
  },
];

export default [
  ...base,
  {
    files: ["**/*.ts", "**/*.tsx"],
    // Testes simulam a origem insegura de propósito, tirando essas APIs do
    // `crypto` — e não têm como ser a causa do defeito.
    ignores: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "no-restricted-syntax": ["error", ...SO_EM_CONTEXTO_SEGURO],
    },
  },
];
