import {
  type CodigoPapelPadrao,
  type DomainError,
  err,
  ErroConflito,
  ErroRegraNegocio,
  ErroValidacao,
  type Identificador,
  Matricula,
  ok,
  Papel,
  papelPadrao,
  type Result,
  Usuario,
} from "@erp/domain";

import type { GeradorId } from "../../portas/infraestrutura/GeradorId.js";
import type { Hasher } from "../../portas/infraestrutura/Hasher.js";
import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";

/**
 * Gestão de usuários.
 *
 * ### Nunca existe senha de fábrica
 *
 * Quem cria o usuário informa a credencial inicial, e ela nasce **marcada para
 * troca**: uma credencial que o administrador digitou é uma credencial que o
 * administrador conhece. Semear o produto com uma senha padrão significaria a
 * mesma senha em toda instalação do país, publicada no primeiro fórum.
 *
 * ### PIN e senha são credenciais diferentes, de propósito
 *
 * O balcão entra com PIN de seis dígitos; a retaguarda, com senha longa
 * (ADR-0011). Um usuário pode ter só uma das duas: o estoquista que nunca opera
 * caixa não precisa de PIN, e dar-lhe um só aumenta a superfície de ataque.
 */

export interface EntradaCadastrarUsuario {
  readonly matricula: string;
  readonly nome: string;
  readonly papelCodigo: CodigoPapelPadrao;
  /** Ao menos uma credencial precisa vir. */
  readonly pin?: string | undefined;
  readonly senha?: string | undefined;
}

export class CadastrarUsuario {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly geradorId: GeradorId,
    private readonly hasher: Hasher,
  ) {}

  async executar(
    entrada: EntradaCadastrarUsuario,
  ): Promise<Result<Usuario, DomainError>> {
    const matricula = Matricula.criar(entrada.matricula);
    if (matricula.isErr()) return err(matricula.error);

    if (entrada.pin === undefined && entrada.senha === undefined) {
      return err(
        new ErroValidacao(
          "USUARIO_SEM_CREDENCIAL",
          "Informe o PIN do balcão, a senha da retaguarda, ou os dois.",
        ),
      );
    }

    // O hash é caro e fica **fora** da transação: mantê-lo dentro seguraria a
    // conexão do banco por centenas de milissegundos a cada cadastro.
    const hashPin =
      entrada.pin === undefined ? undefined : await this.hasher.hash(entrada.pin);
    const hashSenha =
      entrada.senha === undefined ? undefined : await this.hasher.hash(entrada.senha);

    return this.unitOfWork.transacao(async (repositorios) => {
      const existente = await repositorios.usuarios.porMatricula(matricula.unwrap());

      if (existente !== undefined) {
        return err(
          new ErroConflito("MATRICULA_EM_USO", "Já existe usuário com esta matrícula.", {
            matricula: matricula.unwrap().valor,
          }),
        );
      }

      const papel = await obterPapel(repositorios, entrada.papelCodigo, this.geradorId);
      if (papel.isErr()) return err(papel.error);

      const usuario = Usuario.criar({
        id: this.geradorId.proximo(),
        matricula: matricula.unwrap(),
        nome: entrada.nome,
        papel: papel.unwrap(),
        hashPin,
        hashSenha,
        // Nasce exigindo troca. Ver o cabeçalho deste arquivo.
        precisaTrocarCredencial: true,
      });

      if (usuario.isErr()) return err(usuario.error[0] ?? erroGenerico());

      await repositorios.usuarios.salvar(usuario.unwrap());

      return ok(usuario.unwrap());
    });
  }
}

export interface EntradaAlterarUsuario {
  readonly id: Identificador;
  readonly nome: string;
  readonly papelCodigo: CodigoPapelPadrao;
  readonly ativo: boolean;
  /** Quem está executando — não pode se desativar nem se rebaixar. */
  readonly executadoPor: Identificador;
}

/**
 * Altera nome, papel e situação.
 *
 * A credencial **não** entra aqui: trocar senha é outra operação, com outra
 * pergunta ("qual é a nova?") e outro risco. Misturá-las faria a tela de editar
 * nome pedir senha.
 */
export class AlterarUsuario {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly geradorId: GeradorId,
  ) {}

  async executar(entrada: EntradaAlterarUsuario): Promise<Result<Usuario, DomainError>> {
    return this.unitOfWork.transacao(async (repositorios) => {
      const usuario = await repositorios.usuarios.porId(entrada.id);

      if (usuario === undefined) {
        return err(
          new ErroValidacao("USUARIO_NAO_ENCONTRADO", "Usuário não encontrado."),
        );
      }

      const ehEleMesmo = entrada.executadoPor.equals(entrada.id);

      // Desativar-se é como trancar a chave dentro do carro. Se for o único
      // administrador, não há quem reabra — e o suporte vira intervenção no
      // banco, na loja do cliente.
      if (ehEleMesmo && !entrada.ativo) {
        return err(
          new ErroRegraNegocio(
            "NAO_PODE_DESATIVAR_A_SI",
            "Você não pode desativar o próprio acesso. Peça a outro administrador.",
          ),
        );
      }

      const papel = await obterPapel(repositorios, entrada.papelCodigo, this.geradorId);
      if (papel.isErr()) return err(papel.error);

      // Mesmo motivo: rebaixar-se sozinho tira a permissão de voltar atrás.
      if (ehEleMesmo && !papel.unwrap().permissoes.has("usuario:criar")) {
        return err(
          new ErroRegraNegocio(
            "NAO_PODE_REBAIXAR_A_SI",
            "Você não pode retirar a própria permissão de gerir usuários.",
          ),
        );
      }

      const problema = usuario.alterarNome(entrada.nome);
      if (problema.isErr()) return err(problema.error);

      usuario.alterarPapel(papel.unwrap());

      if (entrada.ativo) usuario.reativar();
      else usuario.desativar();

      // Desativar alguém que ficou bloqueado por tentativas e depois reativar
      // deve devolver acesso limpo — senão o operador reativado continua preso.
      if (entrada.ativo) usuario.desbloquear();

      await repositorios.usuarios.salvar(usuario);

      return ok(usuario);
    });
  }
}

export interface EntradaDefinirCredencial {
  readonly id: Identificador;
  readonly pin?: string | undefined;
  readonly senha?: string | undefined;
  /** Verdadeiro quando é o próprio usuário trocando a sua. */
  readonly propria: boolean;
}

/**
 * Define ou troca PIN e senha.
 *
 * Quando o **administrador** define a de outra pessoa, ela nasce marcada para
 * troca: ele acabou de conhecê-la. Quando é o **próprio usuário** trocando a
 * sua, a marca sai — é exatamente o ato de trocar que a satisfaz.
 */
export class DefinirCredencial {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly hasher: Hasher,
  ) {}

  async executar(entrada: EntradaDefinirCredencial): Promise<Result<void, DomainError>> {
    if (entrada.pin === undefined && entrada.senha === undefined) {
      return err(
        new ErroValidacao("SEM_CREDENCIAL", "Informe o PIN, a senha, ou os dois."),
      );
    }

    const hashPin =
      entrada.pin === undefined ? undefined : await this.hasher.hash(entrada.pin);
    const hashSenha =
      entrada.senha === undefined ? undefined : await this.hasher.hash(entrada.senha);

    return this.unitOfWork.transacao(async (repositorios) => {
      const usuario = await repositorios.usuarios.porId(entrada.id);

      if (usuario === undefined) {
        return err(
          new ErroValidacao("USUARIO_NAO_ENCONTRADO", "Usuário não encontrado."),
        );
      }

      if (hashPin !== undefined) usuario.definirPin(hashPin);
      if (hashSenha !== undefined) usuario.definirSenha(hashSenha);

      if (!entrada.propria) {
        // Definida por outra pessoa: ela conhece a credencial, então o próximo
        // acesso obriga a trocar. `definirPin` e `definirSenha` já limpam a
        // marca — daí ela ser reposta aqui, e não o contrário.
        usuario.exigirTrocaDeCredencial();

        // E destrava: o caso real desta operação é "o operador esqueceu o PIN e
        // ficou bloqueado". Sem isto, o administrador reporia a credencial e o
        // operador continuaria preso até o bloqueio expirar sozinho — que é
        // como o suporte é acionado duas vezes pelo mesmo problema.
        usuario.desbloquear();
      }

      await repositorios.usuarios.salvar(usuario);

      return ok(undefined);
    });
  }
}

interface RepositorioDePapeis {
  porCodigo(codigo: string): Promise<Papel | undefined>;
  salvar(papel: Papel): Promise<void>;
}

async function obterPapel(
  repositorios: { readonly papeis: RepositorioDePapeis },
  codigo: CodigoPapelPadrao,
  geradorId: GeradorId,
): Promise<Result<Papel, DomainError>> {
  const existente = await repositorios.papeis.porCodigo(codigo);
  if (existente !== undefined) return ok(existente);

  // Papel padrão que ainda não foi gravado nesta instalação: cria na hora. É o
  // que permite ao produto funcionar sem seed — e seed com dado de negócio é o
  // que faz duas instalações divergirem sem ninguém perceber.
  const novo = Papel.criar(papelPadrao(codigo, geradorId.proximo()));

  /* v8 ignore next -- papel padrão é constante e sempre válido */
  if (novo.isErr()) return err(novo.error[0] ?? erroGenerico());

  await repositorios.papeis.salvar(novo.unwrap());

  return ok(novo.unwrap());
}

function erroGenerico(): DomainError {
  return new ErroValidacao("USUARIO_INVALIDO", "Dados do usuário inválidos.");
}
