import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Configuração base de lint do ERP/PDV.
 *
 * As regras aqui não são estilísticas — o Prettier cuida do estilo.
 * Elas existem para impedir classes de defeito que custam caro em produção:
 * `any` que esconde erro de tipo fiscal, promessa não aguardada que perde
 * uma venda, e comparação frouxa que confunde 0 com "".
 */
export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/coverage/**", "**/node_modules/**", "**/.turbo/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      // `any` desliga o compilador justamente onde mais precisamos dele.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-argument": "error",

      // Promessa esquecida no PDV = venda que não gravou.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/require-await": "error",

      // Consistência de tipos e imports.
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": ["error", { allow: ["warn", "error"] }],
      "prefer-const": "error",
      "no-var": "error",
    },
  },
  {
    // Testes podem afrouxar o rigor de tipos ao montar cenários inválidos
    // de propósito — que é exatamente o que um bom teste faz.
    files: ["**/*.test.ts", "**/*.spec.ts", "**/tests/**"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-console": "off",
    },
  },
);
