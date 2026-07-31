import type { Relogio } from "@erp/application";

/**
 * Relógio do processo do servidor.
 *
 * É deliberado que exista **um** relógio, no servidor, e que as estações não
 * usem o seu: máquina de loja com hora errada é comum, e a hora grava em venda,
 * fechamento de caixa e documento fiscal. Divergência de minutos entre caixas
 * inviabiliza a conferência do dia (ARQUITETURA.md §11.5).
 */
export class RelogioSistema implements Relogio {
  agora(): Date {
    return new Date();
  }
}
