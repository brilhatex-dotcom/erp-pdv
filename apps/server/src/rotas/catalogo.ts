import { catalogoParaReplica } from "@erp/database";
import type { FastifyInstance } from "fastify";

import type { Container } from "../composicao/container.js";
import { exigirAutenticacao, exigirPermissao } from "../http/autenticacao.js";

/**
 * O catálogo que a estação replica para vender offline.
 *
 * ### Exige autenticação, e não é formalidade
 *
 * A resposta é o catálogo comercial inteiro da loja. Sem token, bastaria estar
 * na rede da loja — ou num Wi-Fi mal configurado — para baixar a tabela de
 * preços completa de um concorrente.
 *
 * A permissão é `venda:criar`, a mesma da bipada: quem pode vender pode ver
 * preço de venda, porque é isso que a tela mostra a cada item. Exigir permissão
 * de gerente impediria a estação de operador comum de montar a réplica —
 * justamente a estação que fica sem catálogo quando o servidor cai.
 *
 * ### Baixa inteira, não incremental
 *
 * Sincronização incremental exigiria versionar cada produto e resolver conflito
 * de exclusão. Com 50 mil SKUs o JSON fica na casa de poucos megabytes na rede
 * local da loja, uma vez por abertura de caixa. A complexidade do incremental
 * não se paga aqui — e a réplica é substituída inteira, que é a operação sem
 * estado intermediário para dar errado.
 */
export function rotasDeCatalogo(servidor: FastifyInstance, container: Container): void {
  servidor.get(
    "/api/catalogo/replica",
    {
      preHandler: [
        exigirAutenticacao(container),
        exigirPermissao(container, "venda:criar"),
      ],
    },
    async () => catalogoParaReplica(container.prisma, container.relogio.agora()),
  );
}
