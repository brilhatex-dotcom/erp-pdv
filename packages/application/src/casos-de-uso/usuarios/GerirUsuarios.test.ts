import { Identificador, Matricula, Papel, papelPadrao, Usuario } from "@erp/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { montarAmbiente } from "../../testes/dubles.js";
import {
  CriarPrimeiroAdministrador,
  InstalacaoPrecisaConfiguracao,
} from "./CriarPrimeiroAdministrador.js";
import { AlterarUsuario, CadastrarUsuario, DefinirCredencial } from "./GerirUsuarios.js";

const AGORA = new Date("2026-08-01T09:00:00.000Z");
const ADMIN_ID = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e800001").unwrap();
const PAPEL_ID = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e800002").unwrap();

function montar() {
  const ambiente = montarAmbiente(AGORA);

  return {
    ...ambiente,
    cadastrar: new CadastrarUsuario(
      ambiente.unitOfWork,
      ambiente.geradorId,
      ambiente.hasher,
    ),
    alterar: new AlterarUsuario(ambiente.unitOfWork, ambiente.geradorId),
    definirCredencial: new DefinirCredencial(ambiente.unitOfWork, ambiente.hasher),
    primeiroAdmin: new CriarPrimeiroAdministrador(
      ambiente.unitOfWork,
      ambiente.geradorId,
      ambiente.hasher,
    ),
    precisaConfiguracao: new InstalacaoPrecisaConfiguracao(ambiente.unitOfWork),
  };
}

let sistema: ReturnType<typeof montar>;

beforeEach(() => {
  sistema = montar();
});

async function comAdministrador(): Promise<Usuario> {
  const admin = Usuario.criar({
    id: ADMIN_ID,
    matricula: Matricula.criar("1").unwrap(),
    nome: "Ana Administradora",
    papel: Papel.criar(papelPadrao("ADMIN", PAPEL_ID)).unwrap(),
    hashSenha: await sistema.hasher.hash("senha-bem-longa-aqui"),
    precisaTrocarCredencial: false,
  }).unwrap();

  sistema.usuarios.adicionar(admin);
  return admin;
}

describe("Primeiro administrador", () => {
  it("🔑 instalação nova precisa de configuração", async () => {
    // Sem isto o produto instala e não abre: criar usuário exige permissão, e
    // ter permissão exige usuário.
    expect((await sistema.precisaConfiguracao.executar()).unwrap()).toBe(true);
  });

  it("cria o administrador e a instalação deixa de precisar", async () => {
    const criado = await sistema.primeiroAdmin.executar({
      matricula: "1",
      nome: "Ana Administradora",
      senha: "senha-bem-longa-aqui",
    });

    expect(criado.isOk()).toBe(true);
    expect(criado.unwrap().papel.codigo).toBe("ADMIN");
    expect((await sistema.precisaConfiguracao.executar()).unwrap()).toBe(false);
  });

  it("🔑 não exige troca — quem escolheu a senha foi quem está instalando", async () => {
    // Pedir para trocar uma senha recém-criada pela mesma pessoa é atrito sem
    // ganho de segurança.
    const criado = await sistema.primeiroAdmin.executar({
      matricula: "1",
      nome: "Ana",
      senha: "senha-bem-longa-aqui",
    });

    expect(criado.unwrap().precisaTrocarCredencial).toBe(false);
  });

  it("🔑 a porta se tranca sozinha depois do primeiro", async () => {
    // Não depende de ninguém lembrar de desativar a configuração inicial.
    await comAdministrador();

    const segundo = await sistema.primeiroAdmin.executar({
      matricula: "2",
      nome: "Invasor",
      senha: "outra-senha-longa",
    });

    expect(segundo.isErr()).toBe(true);
    if (segundo.isErr()) {
      expect(segundo.error.codigo).toBe("INSTALACAO_JA_CONFIGURADA");
    }
  });

  it("aceita PIN junto, para quem também opera o caixa", async () => {
    const criado = await sistema.primeiroAdmin.executar({
      matricula: "1",
      nome: "Ana",
      senha: "senha-bem-longa-aqui",
      pin: "419273",
    });

    expect(criado.unwrap().hashPin).toBeDefined();
  });

  it("matrícula inválida é recusada", async () => {
    const criado = await sistema.primeiroAdmin.executar({
      matricula: "",
      nome: "Ana",
      senha: "senha-bem-longa-aqui",
    });

    expect(criado.isErr()).toBe(true);
  });
});

describe("Cadastro de usuário", () => {
  it("cria com PIN para o balcão", async () => {
    const criado = await sistema.cadastrar.executar({
      matricula: "42",
      nome: "Maria da Silva",
      papelCodigo: "OPERADOR_CAIXA",
      pin: "419273",
    });

    expect(criado.isOk()).toBe(true);
    expect(criado.unwrap().hashPin).toBeDefined();
    expect(criado.unwrap().hashSenha).toBeUndefined();
  });

  it("🔑 nasce exigindo troca — nunca existe senha de fábrica", async () => {
    // Uma credencial que o administrador digitou é uma credencial que o
    // administrador conhece.
    const criado = await sistema.cadastrar.executar({
      matricula: "42",
      nome: "Maria",
      papelCodigo: "OPERADOR_CAIXA",
      pin: "419273",
    });

    expect(criado.unwrap().precisaTrocarCredencial).toBe(true);
  });

  it("🔑 usuário sem nenhuma credencial é recusado", async () => {
    // Cadastro sem credencial cria alguém que nunca consegue entrar, e a falha
    // só aparece quando a pessoa tenta trabalhar.
    const criado = await sistema.cadastrar.executar({
      matricula: "42",
      nome: "Maria",
      papelCodigo: "OPERADOR_CAIXA",
    });

    expect(criado.isErr()).toBe(true);
    if (criado.isErr()) expect(criado.error.codigo).toBe("USUARIO_SEM_CREDENCIAL");
  });

  it("🔑 matrícula repetida é recusada, apontando qual", async () => {
    // Duas pessoas com a mesma matrícula fazem toda venda ficar atribuída à
    // primeira — a auditoria deixa de valer exatamente onde mais importa.
    await comAdministrador();

    const repetido = await sistema.cadastrar.executar({
      matricula: "1",
      nome: "Outra Pessoa",
      papelCodigo: "GERENTE",
      senha: "senha-bem-longa-aqui",
    });

    expect(repetido.isErr()).toBe(true);
    if (repetido.isErr()) {
      expect(repetido.error.codigo).toBe("MATRICULA_EM_USO");
      expect(repetido.error.detalhes?.["matricula"]).toBe("1");
    }
  });

  it("cria o papel padrão na primeira vez que ele é usado", async () => {
    // É o que permite o produto funcionar sem seed.
    const criado = await sistema.cadastrar.executar({
      matricula: "42",
      nome: "Maria",
      papelCodigo: "ESTOQUISTA",
      senha: "senha-bem-longa-aqui",
    });

    expect(criado.unwrap().papel.codigo).toBe("ESTOQUISTA");
    expect(await sistema.papeis.porCodigo("ESTOQUISTA")).toBeDefined();
  });

  it("reaproveita o papel já existente em vez de duplicar", async () => {
    await sistema.cadastrar.executar({
      matricula: "42",
      nome: "Maria",
      papelCodigo: "OPERADOR_CAIXA",
      pin: "419273",
    });
    const primeiro = await sistema.papeis.porCodigo("OPERADOR_CAIXA");

    await sistema.cadastrar.executar({
      matricula: "43",
      nome: "João",
      papelCodigo: "OPERADOR_CAIXA",
      pin: "111222",
    });

    expect((await sistema.papeis.porCodigo("OPERADOR_CAIXA"))?.id.valor).toBe(
      primeiro?.id.valor,
    );
  });

  it("matrícula inválida é recusada antes de gastar hash", async () => {
    const criado = await sistema.cadastrar.executar({
      matricula: "abc",
      nome: "Maria",
      papelCodigo: "OPERADOR_CAIXA",
      pin: "419273",
    });

    expect(criado.isErr()).toBe(true);
  });

  it("nome vazio é recusado pelo domínio", async () => {
    const criado = await sistema.cadastrar.executar({
      matricula: "42",
      nome: "   ",
      papelCodigo: "OPERADOR_CAIXA",
      pin: "419273",
    });

    expect(criado.isErr()).toBe(true);
  });
});

describe("Alteração de usuário", () => {
  it("altera nome e papel", async () => {
    const admin = await comAdministrador();
    const criado = (
      await sistema.cadastrar.executar({
        matricula: "42",
        nome: "Maria",
        papelCodigo: "OPERADOR_CAIXA",
        pin: "419273",
      })
    ).unwrap();

    const alterado = await sistema.alterar.executar({
      id: criado.id,
      nome: "Maria da Silva Souza",
      papelCodigo: "SUPERVISOR",
      ativo: true,
      executadoPor: admin.id,
    });

    expect(alterado.unwrap().nome).toBe("Maria da Silva Souza");
    expect(alterado.unwrap().papel.codigo).toBe("SUPERVISOR");
  });

  it("desativa e reativa", async () => {
    const admin = await comAdministrador();
    const criado = (
      await sistema.cadastrar.executar({
        matricula: "42",
        nome: "Maria",
        papelCodigo: "OPERADOR_CAIXA",
        pin: "419273",
      })
    ).unwrap();

    const desativado = await sistema.alterar.executar({
      id: criado.id,
      nome: "Maria",
      papelCodigo: "OPERADOR_CAIXA",
      ativo: false,
      executadoPor: admin.id,
    });
    expect(desativado.unwrap().ativo).toBe(false);

    const reativado = await sistema.alterar.executar({
      id: criado.id,
      nome: "Maria",
      papelCodigo: "OPERADOR_CAIXA",
      ativo: true,
      executadoPor: admin.id,
    });
    expect(reativado.unwrap().ativo).toBe(true);
  });

  it("🔑 reativar destrava quem tinha ficado bloqueado", async () => {
    // Senão o operador volta a existir e continua sem conseguir entrar.
    const admin = await comAdministrador();
    const criado = (
      await sistema.cadastrar.executar({
        matricula: "42",
        nome: "Maria",
        papelCodigo: "OPERADOR_CAIXA",
        pin: "419273",
      })
    ).unwrap();

    for (let i = 0; i < 5; i += 1) criado.registrarTentativaFalha(AGORA);
    expect(criado.estaBloqueado(AGORA)).toBe(true);

    const reativado = await sistema.alterar.executar({
      id: criado.id,
      nome: "Maria",
      papelCodigo: "OPERADOR_CAIXA",
      ativo: true,
      executadoPor: admin.id,
    });

    expect(reativado.unwrap().estaBloqueado(AGORA)).toBe(false);
  });

  it("🔑 ninguém desativa o próprio acesso", async () => {
    // É trancar a chave dentro do carro: se for o único administrador, o
    // suporte vira intervenção no banco, na loja do cliente.
    const admin = await comAdministrador();

    const tentativa = await sistema.alterar.executar({
      id: admin.id,
      nome: "Ana",
      papelCodigo: "ADMIN",
      ativo: false,
      executadoPor: admin.id,
    });

    expect(tentativa.isErr()).toBe(true);
    if (tentativa.isErr()) expect(tentativa.error.codigo).toBe("NAO_PODE_DESATIVAR_A_SI");
  });

  it("🔑 ninguém retira a própria permissão de gerir usuários", async () => {
    // Mesmo motivo: rebaixar-se sozinho tira a permissão de voltar atrás.
    const admin = await comAdministrador();

    const tentativa = await sistema.alterar.executar({
      id: admin.id,
      nome: "Ana",
      papelCodigo: "OPERADOR_CAIXA",
      ativo: true,
      executadoPor: admin.id,
    });

    expect(tentativa.isErr()).toBe(true);
    if (tentativa.isErr()) expect(tentativa.error.codigo).toBe("NAO_PODE_REBAIXAR_A_SI");
  });

  it("outro administrador pode desativar quem quiser", async () => {
    const admin = await comAdministrador();
    const outro = (
      await sistema.cadastrar.executar({
        matricula: "2",
        nome: "Bruno",
        papelCodigo: "ADMIN",
        senha: "senha-bem-longa-aqui",
      })
    ).unwrap();

    const desativado = await sistema.alterar.executar({
      id: outro.id,
      nome: "Bruno",
      papelCodigo: "ADMIN",
      ativo: false,
      executadoPor: admin.id,
    });

    expect(desativado.unwrap().ativo).toBe(false);
  });

  it("usuário inexistente é recusado", async () => {
    const admin = await comAdministrador();

    const alterado = await sistema.alterar.executar({
      id: Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e809999").unwrap(),
      nome: "Fantasma",
      papelCodigo: "GERENTE",
      ativo: true,
      executadoPor: admin.id,
    });

    expect(alterado.isErr()).toBe(true);
  });

  it("nome inválido é recusado", async () => {
    const admin = await comAdministrador();

    const alterado = await sistema.alterar.executar({
      id: admin.id,
      nome: "",
      papelCodigo: "ADMIN",
      ativo: true,
      executadoPor: admin.id,
    });

    expect(alterado.isErr()).toBe(true);
  });
});

describe("Definição de credencial", () => {
  it("🔑 o administrador repõe o PIN e destrava quem estava preso", async () => {
    // É o chamado mais comum do módulo: "esqueci o PIN e agora não entro".
    const criado = (
      await sistema.cadastrar.executar({
        matricula: "42",
        nome: "Maria",
        papelCodigo: "OPERADOR_CAIXA",
        pin: "419273",
      })
    ).unwrap();

    for (let i = 0; i < 5; i += 1) criado.registrarTentativaFalha(AGORA);
    expect(criado.estaBloqueado(AGORA)).toBe(true);

    const reposta = await sistema.definirCredencial.executar({
      id: criado.id,
      pin: "999888",
      propria: false,
    });

    expect(reposta.isOk()).toBe(true);
    expect(criado.estaBloqueado(AGORA)).toBe(false);
    // E exige troca: o administrador acabou de conhecer o PIN novo.
    expect(criado.precisaTrocarCredencial).toBe(true);
  });

  it("🔑 quando é o próprio usuário, a exigência de troca é satisfeita", async () => {
    const criado = (
      await sistema.cadastrar.executar({
        matricula: "42",
        nome: "Maria",
        papelCodigo: "OPERADOR_CAIXA",
        pin: "419273",
      })
    ).unwrap();

    expect(criado.precisaTrocarCredencial).toBe(true);

    await sistema.definirCredencial.executar({
      id: criado.id,
      pin: "999888",
      propria: true,
    });

    expect(criado.precisaTrocarCredencial).toBe(false);
  });

  it("define senha e PIN de uma vez", async () => {
    const admin = await comAdministrador();

    const definida = await sistema.definirCredencial.executar({
      id: admin.id,
      pin: "419273",
      senha: "outra-senha-bem-longa",
      propria: true,
    });

    expect(definida.isOk()).toBe(true);
    expect(admin.hashPin).toBeDefined();
  });

  it("sem nenhuma credencial é recusado", async () => {
    const admin = await comAdministrador();

    const definida = await sistema.definirCredencial.executar({
      id: admin.id,
      propria: true,
    });

    expect(definida.isErr()).toBe(true);
  });

  it("usuário inexistente é recusado", async () => {
    const definida = await sistema.definirCredencial.executar({
      id: Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e809999").unwrap(),
      pin: "419273",
      propria: false,
    });

    expect(definida.isErr()).toBe(true);
  });
});

describe("Primeiro administrador — dados inválidos", () => {
  it("nome vazio é recusado, e nada é gravado", async () => {
    const criado = await sistema.primeiroAdmin.executar({
      matricula: "1",
      nome: "   ",
      senha: "senha-bem-longa-aqui",
    });

    expect(criado.isErr()).toBe(true);
    // A instalação continua sem configuração: a tentativa falha não conta.
    expect((await sistema.precisaConfiguracao.executar()).unwrap()).toBe(true);
  });
});
