import base from "@erp/config/vitest";
import { mergeConfig } from "vitest/config";

export default mergeConfig(base, {
  test: {
    // Testes de integração conversam com o Postgres de verdade.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // Uma conexão por arquivo evita disputa de transação entre suítes.
    fileParallelism: false,
    coverage: {
      exclude: [
        "src/**/*.{test,spec}.ts",
        "src/**/index.ts",
        // Cliente gerado pelo Prisma: não é código nosso.
        "src/gerado/**",
        // Infraestrutura de teste, não código de produção — mesma exclusão que
        // `@erp/application` e `apps/server` já fazem.
        //
        // Medi-la produzia um portão que dependia do ambiente: `banco.ts` lê
        // `DATABASE_URL_TESTE ?? padrão`, e cada lado do `??` é exercitado numa
        // máquina diferente. Passava no desenvolvimento, onde a variável não
        // existe, e reprovava no CI, onde existe. Limiar que depende de variável
        // de ambiente não mede teste — mede onde o comando rodou.
        "src/testes/**",
      ],
    },
  },
});
