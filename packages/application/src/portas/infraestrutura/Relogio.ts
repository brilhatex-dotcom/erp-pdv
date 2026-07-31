/**
 * Fonte de tempo do sistema.
 *
 * Existe como porta por dois motivos concretos:
 *
 * 1. **Teste determinístico.** Um caso de uso que chama `new Date()` por conta
 *    própria não pode ser testado com precisão — e boa parte das regras deste
 *    sistema é sobre tempo (janela de cancelamento, prazo de contingência,
 *    fechamento de caixa).
 * 2. **A hora da estação não é confiável.** Máquina de loja frequentemente está
 *    com o relógio errado, e isso quebraria ordenação e obrigação fiscal. O
 *    adapter de produção usa a hora do servidor, não a da estação
 *    (ARQUITETURA.md §11.5).
 */
export interface Relogio {
  agora(): Date;
}
