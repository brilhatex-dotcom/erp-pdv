import base from "@erp/config/vitest";
import { mergeConfig } from "vitest/config";

export default mergeConfig(base, {
  test: {
    // As rotas conversam com o Postgres de verdade, pela mesma razão do
    // pacote de persistência: é onde as garantias reais moram.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    coverage: {
      exclude: [
        "src/**/*.{test,spec}.ts",
        "src/index.ts",
        // Infraestrutura de teste, não código de produção.
        //
        // Medi-la produz um portão que depende do ambiente: `apoio.ts` lê
        // `DATABASE_URL_TESTE_API ?? padrão`, e cada lado do `??` é exercitado
        // numa máquina diferente. Limiar que depende de variável de ambiente
        // não mede teste — mede onde o comando rodou. Mesma exclusão de
        // `@erp/database` e `@erp/web`.
        "src/testes/**",
      ],
    },
  },
});
