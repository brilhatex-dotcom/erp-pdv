import {
  Cliente,
  type DadosEndereco,
  type DomainError,
  err,
  ErroConflito,
  type ErroValidacao,
  ok,
  type Result,
  type TipoPessoa,
} from "@erp/domain";

import { agregarErros } from "../../erros/agregarErros.js";
import type { GeradorId } from "../../portas/infraestrutura/GeradorId.js";
import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";

import {
  interpretarContato,
  interpretarDinheiro,
  interpretarDocumento,
  interpretarInscricaoEstadual,
} from "./interpretar.js";

export interface EntradaCadastrarCliente {
  readonly nome: string;
  readonly apelido?: string | undefined;
  readonly tipoPessoa: TipoPessoa;
  readonly documento?: string | undefined;
  readonly inscricaoEstadual?: string | undefined;
  readonly telefone?: string | undefined;
  readonly email?: string | undefined;
  readonly endereco?: DadosEndereco | undefined;
  /** Centavos. Ausente é o mesmo que zero: não vende a prazo. */
  readonly limiteCreditoCentavos?: bigint | undefined;
  readonly observacao?: string | undefined;
}

/**
 * Cadastra um cliente.
 *
 * O documento é **opcional** (LGPD, minimização), mas quando informado é
 * único: o mesmo CPF cadastrado duas vezes divide o histórico da pessoa entre
 * dois registros, e o fiado de um não aparece na consulta do outro.
 */
export class CadastrarCliente {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly geradorId: GeradorId,
  ) {}

  async executar(
    entrada: EntradaCadastrarCliente,
  ): Promise<Result<Cliente, DomainError>> {
    return this.unitOfWork.transacao(async (repositorios) => {
      const problemas: ErroValidacao[] = [];

      const documento = interpretarDocumento(entrada.documento, problemas);
      const inscricaoEstadual = interpretarInscricaoEstadual(
        entrada.inscricaoEstadual,
        problemas,
      );
      const contato = interpretarContato(entrada, problemas);
      const limiteCredito = interpretarDinheiro(entrada.limiteCreditoCentavos, problemas);

      // Só monta o agregado depois de traduzir tudo: assim os erros de formato
      // e os de regra chegam juntos ao usuário, numa gravação só.
      const cliente = Cliente.criar({
        id: this.geradorId.proximo(),
        nome: entrada.nome,
        apelido: entrada.apelido,
        tipoPessoa: entrada.tipoPessoa,
        documento,
        inscricaoEstadual,
        telefone: contato.telefone,
        email: contato.email,
        endereco: contato.endereco,
        limiteCredito,
        observacao: entrada.observacao,
      });

      if (cliente.isErr()) problemas.push(...cliente.error);

      if (problemas.length > 0) return err(agregarErros(problemas));

      const novo = cliente.unwrap();

      if (documento !== undefined) {
        const existente = await repositorios.clientes.porDocumento(documento);

        if (existente !== undefined) {
          return err(
            new ErroConflito(
              "CLIENTE_DOCUMENTO_JA_CADASTRADO",
              `Este documento já está no cadastro de ${existente.exibicao}.`,
              { clienteId: existente.id.valor },
            ),
          );
        }
      }

      await repositorios.clientes.salvar(novo);

      return ok(novo);
    });
  }
}
