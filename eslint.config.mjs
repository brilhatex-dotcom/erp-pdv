import base from "@erp/config/eslint";

export default [
  ...base,
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/.turbo/**",
      ".dependency-cruiser.cjs",
      // Cliente do Prisma: código gerado, reescrito a cada `prisma generate`.
      // Corrigir estilo aqui seria trabalho desfeito na próxima migração.
      "**/src/gerado/**",
    ],
  },
];
