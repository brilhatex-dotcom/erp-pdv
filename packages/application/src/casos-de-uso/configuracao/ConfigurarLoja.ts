import {
  type AlteracaoConfiguracaoLoja,
  ConfiguracaoLoja,
  type DomainError,
  err,
  type Identificador,
  ok,
  type Result,
} from "@erp/domain";

import { auditar } from "../../auditoria/RegistroAuditoria.js";
import { agregarErros } from "../../erros/agregarErros.js";
import { imagemAusente } from "../cadastros/CadastrarCategoria.js";
import type { GeradorId } from "../../portas/infraestrutura/GeradorId.js";
import type { Relogio } from "../../portas/infraestrutura/Relogio.js";
import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";
import type { ConfiguracaoLojaRepository } from "../../portas/repositorios/RepositoriosBalcao.js";

/**
 * Lê a configuração da loja.
 *
 * Antes de qualquer gravação, devolve a de fábrica — mista, com todos os
 * recursos — **sem gravá-la**. Ler não pode ter efeito colateral, e o caixa
 * precisa funcionar no primeiro minuto da instalação, antes de alguém abrir a
 * tela de configuração.
 *
 * Sem transação e sem `Result`: é uma leitura, e a única falha possível é o
 * banco fora do ar — que não é regra de negócio, e chega a quem chamou como
 * qualquer outra falha de leitura.
 */
export class ObterConfiguracaoLoja {
  constructor(
    private readonly configuracoes: ConfiguracaoLojaRepository,
    private readonly geradorId: GeradorId,
  ) {}

  async executar(): Promise<{
    readonly configuracao: ConfiguracaoLoja;
    readonly gravada: boolean;
  }> {
    const atual = await this.configuracoes.atual();

    return atual === undefined
      ? {
          configuracao: ConfiguracaoLoja.padrao(this.geradorId.proximo()),
          gravada: false,
        }
      : { configuracao: atual, gravada: true };
  }
}

export interface EntradaDefinirConfiguracao {
  readonly usuarioId: Identificador;
  readonly alteracao: AlteracaoConfiguracaoLoja;
}

/**
 * Grava a configuração — a primeira vez, ou por cima da que existe.
 *
 * Partindo da de fábrica do segmento escolhido quando ainda não há nenhuma: o
 * dono que só escolhe "padaria" no primeiro acesso recebe a padaria inteira,
 * sem precisar entender o que cada recurso faz.
 *
 * Fica na auditoria, com o antes e o depois: mudar a regra de venda sem
 * estoque ou desligar o fiado muda o que o caixa faz amanhã, e "quem mudou
 * isso?" é pergunta que aparece.
 */
export class DefinirConfiguracaoLoja {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly geradorId: GeradorId,
    private readonly relogio: Relogio,
  ) {}

  async executar(
    entrada: EntradaDefinirConfiguracao,
  ): Promise<Result<ConfiguracaoLoja, DomainError>> {
    return this.unitOfWork.transacao(async (repositorios) => {
      const logoId = entrada.alteracao.logoId;

      if (
        logoId !== undefined &&
        logoId !== null &&
        !(await repositorios.imagens.existe(logoId))
      ) {
        return err(imagemAusente());
      }

      const existente = await repositorios.configuracao.atual();

      const configuracao =
        existente ??
        ConfiguracaoLoja.padrao(this.geradorId.proximo(), entrada.alteracao.segmento);

      const antes = resumir(configuracao);

      const alterada = configuracao.alterar(entrada.alteracao);
      if (alterada.isErr()) return err(agregarErros(alterada.error));

      const depois = resumir(configuracao);

      await repositorios.configuracao.salvar(configuracao);

      if (antes !== depois || existente === undefined) {
        await auditar(repositorios, this.geradorId, {
          ocorridoEm: this.relogio.agora(),
          acao: "CONFIGURACAO_ALTERADA",
          usuarioId: entrada.usuarioId,
          descricao:
            existente === undefined
              ? `Configuração da loja definida: ${depois}`
              : `Configuração da loja alterada: ${depois}`,
          entidade: "configuracao",
          entidadeId: configuracao.id,
          dados: { antes: existente === undefined ? null : antes, depois },
        });
      }

      return ok(configuracao);
    });
  }
}

/** Uma linha que o dono lê na auditoria — e que serve para comparar antes e depois. */
function resumir(configuracao: ConfiguracaoLoja): string {
  const layout = configuracao.layoutBalanca;

  return [
    configuracao.segmento.toLowerCase(),
    `recursos: ${configuracao.recursos.join(", ").toLowerCase() || "nenhum"}`,
    `sem estoque: ${configuracao.vendaSemEstoque.toLowerCase()}`,
    `cupom ${String(configuracao.larguraCupom)} mm`,
    `impressão ${configuracao.impressaoComprovante.toLowerCase().replace("_", " ")}`,
    `balança ${layout.prefixos.join("/")}+${String(layout.tamanhoCodigoProduto)} ${layout.conteudo.toLowerCase()}`,
    `logotipo: ${configuracao.logoId === undefined ? "não" : "sim"}`,
  ].join("; ");
}
