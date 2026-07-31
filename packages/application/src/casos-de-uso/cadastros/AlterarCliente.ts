import {
  type Cliente,
  type DadosEndereco,
  Dinheiro,
  type DomainError,
  err,
  ErroConflito,
  ErroNaoEncontrado,
  type ErroValidacao,
  type Identificador,
  ok,
  type Result,
} from "@erp/domain";

import { agregarErros } from "../../erros/agregarErros.js";
import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";

import {
  interpretarContato,
  interpretarDinheiro,
  interpretarDocumento,
  interpretarInscricaoEstadual,
} from "./interpretar.js";

export interface EntradaAlterarCliente {
  readonly id: Identificador;
  readonly nome: string;
  readonly apelido?: string | undefined;
  readonly documento?: string | undefined;
  readonly inscricaoEstadual?: string | undefined;
  readonly telefone?: string | undefined;
  readonly email?: string | undefined;
  readonly endereco?: DadosEndereco | undefined;
  readonly limiteCreditoCentavos?: bigint | undefined;
  readonly observacao?: string | undefined;
  readonly ativo: boolean;
}

/**
 * Altera um cliente.
 *
 * **O tipo de pessoa não muda.** Transformar pessoa física em empresa (ou o
 * contrário) invalidaria o documento já gravado e as notas já emitidas para
 * ele; o caminho certo é desativar e cadastrar o novo. Campo que não se altera
 * não entra na entrada — assim ninguém precisa descobrir na tela que ele é
 * ignorado.
 */
export class AlterarCliente {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async executar(entrada: EntradaAlterarCliente): Promise<Result<Cliente, DomainError>> {
    return this.unitOfWork.transacao(async (repositorios) => {
      const cliente = await repositorios.clientes.porId(entrada.id);

      if (cliente === undefined) {
        return err(
          new ErroNaoEncontrado("CLIENTE_NAO_ENCONTRADO", "Cliente não encontrado."),
        );
      }

      const problemas: ErroValidacao[] = [];

      const documento = interpretarDocumento(entrada.documento, problemas);
      const inscricaoEstadual = interpretarInscricaoEstadual(
        entrada.inscricaoEstadual,
        problemas,
      );
      const contato = interpretarContato(entrada, problemas);
      const limiteCredito =
        interpretarDinheiro(entrada.limiteCreditoCentavos, problemas) ?? Dinheiro.zero();

      // A unicidade é conferida **antes** de mexer no agregado. Verificar
      // depois consultaria um repositório onde este cliente já carrega o
      // documento novo, e ele encontraria a si mesmo — passando batido
      // justamente no caso que a regra existe para pegar.
      if (documento !== undefined) {
        const homonimo = await repositorios.clientes.porDocumento(documento);

        if (homonimo !== undefined && !homonimo.id.equals(cliente.id)) {
          return err(
            new ErroConflito(
              "CLIENTE_DOCUMENTO_JA_CADASTRADO",
              `Este documento já está no cadastro de ${homonimo.exibicao}.`,
              { clienteId: homonimo.id.valor },
            ),
          );
        }
      }

      // As alterações são aplicadas antes da verificação de erros de propósito:
      // a instância é descartada quando algo falha — a transação é desfeita e
      // nada chega ao banco —, e em troca o usuário recebe todos os campos
      // errados de uma vez em vez de descobrir um por gravação.
      const renomeado = cliente.renomear(entrada.nome, entrada.apelido);
      if (renomeado.isErr()) problemas.push(renomeado.error);

      const comDocumento = cliente.definirDocumento(documento);
      if (comDocumento.isErr()) problemas.push(...comDocumento.error);

      const comInscricao = cliente.definirInscricaoEstadual(inscricaoEstadual);
      if (comInscricao.isErr()) problemas.push(comInscricao.error);

      const comLimite = cliente.definirLimiteCredito(limiteCredito);
      if (comLimite.isErr()) problemas.push(comLimite.error);

      const comObservacao = cliente.definirObservacao(entrada.observacao);
      if (comObservacao.isErr()) problemas.push(comObservacao.error);

      cliente.definirContato(contato.telefone, contato.email);
      cliente.definirEndereco(contato.endereco);

      if (entrada.ativo) {
        cliente.ativar();
      } else {
        cliente.desativar();
      }

      if (problemas.length > 0) return err(agregarErros(problemas));

      await repositorios.clientes.salvar(cliente);

      return ok(cliente);
    });
  }
}
