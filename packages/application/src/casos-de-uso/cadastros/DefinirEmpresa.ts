import {
  type DadosEndereco,
  type DomainError,
  Empresa,
  err,
  ErroValidacao,
  ok,
  type RegimeTributario,
  type Result,
} from "@erp/domain";
import { textoOpcional } from "@erp/utils";

import { agregarErros } from "../../erros/agregarErros.js";
import type { GeradorId } from "../../portas/infraestrutura/GeradorId.js";
import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";

import {
  interpretarCnpj,
  interpretarContato,
  interpretarInscricaoEstadual,
} from "./interpretar.js";

/**
 * Define os dados da empresa que opera esta instalação.
 *
 * ### Um caso de uso, não dois
 *
 * Cadastrar e alterar são o mesmo ato aqui, porque **a empresa sempre existe
 * uma vez** (ADR-0024). Separá-los obrigaria a tela a descobrir antes se já há
 * cadastro para escolher qual chamar — e a primeira vez que ela errasse
 * produziria "já existe" para quem está preenchendo pela primeira vez.
 *
 * ### O CNPJ só entra na criação
 *
 * Depois, ele é ignorado — nem chega a ser validado. Trocá-lo não é corrigir
 * cadastro: é outra empresa, e as notas já emitidas passariam a apontar para um
 * emitente que nunca as emitiu. Validar o que será descartado só produziria
 * mensagem de erro sobre um campo que a tela já mostra travado.
 */

export interface EntradaDefinirEmpresa {
  readonly razaoSocial: string;
  readonly nomeFantasia?: string | undefined;
  /** Usado **só** quando ainda não há empresa cadastrada. */
  readonly cnpj?: string | undefined;
  readonly inscricaoEstadual?: string | undefined;
  readonly inscricaoMunicipal?: string | undefined;
  readonly regimeTributario: RegimeTributario;
  /** Obrigatório: é o endereço do emitente, e o cabeçalho de todo relatório. */
  readonly endereco: DadosEndereco;
  readonly telefone?: string | undefined;
  readonly email?: string | undefined;
}

export class DefinirEmpresa {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly geradorId: GeradorId,
  ) {}

  async executar(entrada: EntradaDefinirEmpresa): Promise<Result<Empresa, DomainError>> {
    return this.unitOfWork.transacao(async (repositorios) => {
      const problemas: ErroValidacao[] = [];

      const inscricaoEstadual = interpretarInscricaoEstadual(
        entrada.inscricaoEstadual,
        problemas,
      );
      // `endereco` é obrigatório no tipo de entrada, então `contato.endereco`
      // só vem indefinido quando `Endereco.criar` recusou — e aí os erros dele
      // já estão em `problemas`, com o campo exato que falta.
      const contato = interpretarContato(entrada, problemas);

      const existente = await repositorios.empresa.atual();

      const comuns = {
        razaoSocial: entrada.razaoSocial,
        nomeFantasia: entrada.nomeFantasia,
        inscricaoEstadual,
        inscricaoMunicipal: entrada.inscricaoMunicipal,
        regimeTributario: entrada.regimeTributario,
        telefone: contato.telefone,
        email: contato.email,
      };

      if (existente !== undefined) {
        // `alterar` valida **antes** de mexer no estado, então chamá-lo aqui é
        // seguro mesmo com problemas pendentes: nada muda quando ele recusa.
        const alterada =
          contato.endereco === undefined
            ? undefined
            : existente.alterar({ ...comuns, endereco: contato.endereco });

        if (alterada?.isErr() === true) problemas.push(...alterada.error);

        if (problemas.length > 0) return err(agregarErros(problemas));

        await repositorios.empresa.salvar(existente);

        return ok(existente);
      }

      const cnpj = interpretarCnpj(entrada.cnpj, problemas);

      if (cnpj === undefined && textoOpcional(entrada.cnpj) === undefined) {
        problemas.push(
          new ErroValidacao("EMPRESA_CNPJ_OBRIGATORIO", "Informe o CNPJ da empresa."),
        );
      }

      const nova =
        cnpj === undefined || contato.endereco === undefined
          ? undefined
          : Empresa.criar({
              ...comuns,
              id: this.geradorId.proximo(),
              cnpj,
              endereco: contato.endereco,
            });

      if (nova?.isErr() === true) problemas.push(...nova.error);

      if (problemas.length > 0 || nova === undefined) {
        return err(agregarErros(problemas));
      }

      const empresa = nova.unwrap();

      await repositorios.empresa.salvar(empresa);

      return ok(empresa);
    });
  }
}

// A leitura não tem caso de uso próprio: é `repositorios.empresa.atual()`, e a
// rota a chama pelo `leitura` do container. Abrir transação para consultar
// gastaria uma conexão do pool — que tem vinte no servidor da loja — sem ganhar
// garantia nenhuma.
