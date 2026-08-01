import {
  type DomainError,
  err,
  ErroRegraNegocio,
  ok,
  Papel,
  papelPadrao,
  type Result,
  Usuario,
  Matricula,
} from "@erp/domain";

import type { GeradorId } from "../../portas/infraestrutura/GeradorId.js";
import type { Hasher } from "../../portas/infraestrutura/Hasher.js";
import type { UnitOfWork } from "../../portas/infraestrutura/UnitOfWork.js";

/**
 * Rede de segurança para uma lista de erros que nunca chega vazia.
 *
 * `Result` de validação sempre traz ao menos um problema quando falha, mas o
 * tipo é `ErroValidacao[]` e o compilador não sabe disso. Devolver um erro
 * genérico é melhor que afirmar com `!` que o primeiro existe.
 */
/* v8 ignore next 3 -- inalcançável: lista de erros nunca chega vazia */
function falhaInesperada(): DomainError {
  return new ErroRegraNegocio("FALHA_INESPERADA", "Não foi possível concluir.");
}

export interface EntradaPrimeiroAdministrador {
  readonly matricula: string;
  readonly nome: string;
  readonly senha: string;
  readonly pin?: string | undefined;
}

/**
 * Cria o primeiro administrador de uma instalação nova.
 *
 * ### O problema do ovo e da galinha
 *
 * Criar usuário exige `usuario:criar`. Ter a permissão exige um usuário. Numa
 * instalação recém-feita não existe nenhum, e sem isto **ninguém consegue
 * entrar no sistema** — o produto instala e não abre.
 *
 * ### Por que não um seed com senha padrão
 *
 * Seria a mesma senha em toda instalação do país, publicada no primeiro fórum e
 * nunca trocada, porque quem instala não sabe que existe. A alternativa —
 * gerar uma senha aleatória na instalação — só desloca o problema: ela precisa
 * ser mostrada a alguém, e o instalador ainda não existe.
 *
 * ### A guarda
 *
 * Este caso de uso funciona **apenas enquanto não há nenhum usuário**. Depois do
 * primeiro, ele recusa para sempre — a porta se tranca sozinha, sem depender de
 * ninguém lembrar de trancá-la.
 *
 * A verificação acontece **dentro da transação**, e não antes: duas requisições
 * simultâneas passariam as duas por uma checagem feita fora dela. O índice único
 * da matrícula é a garantia final; isto aqui é o que dá a mensagem certa.
 */
export class CriarPrimeiroAdministrador {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly geradorId: GeradorId,
    private readonly hasher: Hasher,
  ) {}

  async executar(
    entrada: EntradaPrimeiroAdministrador,
  ): Promise<Result<Usuario, DomainError>> {
    const matricula = Matricula.criar(entrada.matricula);
    if (matricula.isErr()) return err(matricula.error);

    const hashSenha = await this.hasher.hash(entrada.senha);
    const hashPin =
      entrada.pin === undefined ? undefined : await this.hasher.hash(entrada.pin);

    return this.unitOfWork.transacao(async (repositorios) => {
      if ((await repositorios.usuarios.quantidade()) > 0) {
        return err(
          new ErroRegraNegocio(
            "INSTALACAO_JA_CONFIGURADA",
            "Esta instalação já tem usuários. Peça acesso a um administrador.",
          ),
        );
      }

      const papel = Papel.criar(papelPadrao("ADMIN", this.geradorId.proximo()));

      /* v8 ignore next -- o papel padrão ADMIN é constante e sempre válido */
      if (papel.isErr()) return err(papel.error[0] ?? falhaInesperada());

      await repositorios.papeis.salvar(papel.unwrap());

      const usuario = Usuario.criar({
        id: this.geradorId.proximo(),
        matricula: matricula.unwrap(),
        nome: entrada.nome,
        papel: papel.unwrap(),
        hashSenha,
        hashPin,
        // **Não** exige troca: a senha foi escolhida por quem está instalando,
        // agora, e ninguém mais a conhece. Exigir troca aqui seria pedir para
        // trocar uma senha recém-criada pela mesma pessoa — atrito sem ganho.
        precisaTrocarCredencial: false,
      });

      if (usuario.isErr()) return err(usuario.error[0] ?? falhaInesperada());

      await repositorios.usuarios.salvar(usuario.unwrap());

      return ok(usuario.unwrap());
    });
  }
}

/**
 * A instalação ainda precisa ser configurada?
 *
 * Consulta separada porque a tela de login precisa dela **antes** de qualquer
 * autenticação, para decidir entre pedir credencial e oferecer a configuração
 * inicial. Não revela nada: quem já tem acesso sabe que há usuários, e quem não
 * tem descobriria na primeira tentativa de login.
 */
export class InstalacaoPrecisaConfiguracao {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async executar(): Promise<Result<boolean, DomainError>> {
    return this.unitOfWork.transacao(async (repositorios) =>
      ok((await repositorios.usuarios.quantidade()) === 0),
    );
  }
}
