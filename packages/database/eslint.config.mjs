import base from "@erp/config/eslint";

export default [
  {
    // Cliente do Prisma: reescrito inteiro a cada `prisma generate`. Corrigir
    // estilo aqui é trabalho desfeito na migração seguinte — e boa parte dos
    // arquivos sequer entra no `tsconfig`, o que faz o parser tipado falhar.
    ignores: ["src/gerado/**"],
  },
  ...base,
];
