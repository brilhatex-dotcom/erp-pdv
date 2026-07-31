import { describe, expect, it } from "vitest";

import { Identificador } from "../shared/Identificador.js";
import { Dinheiro } from "../valores/Dinheiro.js";
import type { UsuarioBloqueado } from "./eventos.js";
import { HashCredencial } from "./HashCredencial.js";
import { ILIMITADO } from "./LimitesPapel.js";
import { Matricula } from "./Matricula.js";
import { type Papel, papeisDeFabrica } from "./Papel.js";
import {
  BLOQUEIO_INICIAL_MINUTOS,
  BLOQUEIO_MAXIMO_MINUTOS,
  TENTATIVAS_ATE_BLOQUEIO,
  Usuario,
} from "./Usuario.js";

const ID = Identificador.criar("018f3a2b-7c1d-7e4f-8a9b-1c2d3e4f0001").unwrap();
const AGORA = new Date("2026-07-31T14:00:00.000Z");
const HASH = HashCredencial.criar("$argon2id$hash").unwrap();

const papel = (codigo: string): Papel => {
  const encontrado = papeisDeFabrica().find((candidato) => candidato.codigo === codigo);
  if (encontrado === undefined) throw new Error(`papel ausente: ${codigo}`);
  return encontrado;
};

function criar(papeis: readonly Papel[] = [papel("OPERADOR_CAIXA")]): Usuario {
  return Usuario.criar({
    id: ID,
    matricula: Matricula.criar("7").unwrap(),
    nome: "Ana",
    papeis,
  }).unwrap();
}

/** Usuário pronto para entrar por PIN. */
function comPin(papeis?: readonly Papel[]): Usuario {
  const usuario = criar(papeis);
  usuario.definirPin(HASH);
  usuario.coletarEventos();
  return usuario;
}

function minutosDepois(base: Date, minutos: number): Date {
  return new Date(base.getTime() + minutos * 60_000);
}

describe("Usuario.criar", () => {
  it("aceita matrícula, nome e papel", () => {
    const usuario = criar();

    expect(usuario.matricula.valor).toBe("7");
    expect(usuario.nome).toBe("Ana");
    expect(usuario.ativo).toBe(true);
  });

  it("remove espaço do nome", () => {
    expect(
      Usuario.criar({
        id: ID,
        matricula: Matricula.criar("7").unwrap(),
        nome: "  Ana  ",
        papeis: [papel("OPERADOR_CAIXA")],
      }).unwrap().nome,
    ).toBe("Ana");
  });

  it("recusa nome vazio", () => {
    const resultado = Usuario.criar({
      id: ID,
      matricula: Matricula.criar("7").unwrap(),
      nome: "   ",
      papeis: [papel("OPERADOR_CAIXA")],
    });

    expect(resultado.isErr()).toBe(true);
    expect(resultado.isErr() && resultado.error.codigo).toBe("USUARIO_SEM_NOME");
  });

  it("recusa usuário sem papel", () => {
    // Sem papel a pessoa não faz nada, e o cadastro pareceria concluído — o
    // chamado "cadastrei e não funciona".
    const resultado = Usuario.criar({
      id: ID,
      matricula: Matricula.criar("7").unwrap(),
      nome: "Ana",
      papeis: [],
    });

    expect(resultado.isErr()).toBe(true);
    expect(resultado.isErr() && resultado.error.codigo).toBe("USUARIO_SEM_PAPEL");
  });

  it("nasce sem credencial nenhuma", () => {
    // Nunca existe senha padrão de fábrica (§8.3).
    const usuario = criar();

    expect(usuario.hashPin).toBeUndefined();
    expect(usuario.hashSenha).toBeUndefined();
  });
});

describe("podeTentarAcesso", () => {
  it("permite quando ativo e com PIN definido", () => {
    expect(comPin().podeTentarAcesso("PIN", AGORA).isOk()).toBe(true);
  });

  it("recusa quando a credencial daquele meio não existe", () => {
    // Quem só tem PIN não entra na retaguarda, e vice-versa (ADR-0011).
    const usuario = comPin();

    expect(usuario.podeTentarAcesso("SENHA", AGORA).isErr()).toBe(true);
  });

  it("recusa usuário desativado", () => {
    const usuario = comPin();
    usuario.desativar();

    const resultado = usuario.podeTentarAcesso("PIN", AGORA);

    expect(resultado.isErr()).toBe(true);
    expect(resultado.isErr() && resultado.error.codigo).toBe("ACESSO_INATIVO");
  });

  it("reativar devolve o acesso", () => {
    const usuario = comPin();
    usuario.desativar();
    usuario.reativar();

    expect(usuario.podeTentarAcesso("PIN", AGORA).isOk()).toBe(true);
  });

  it("dá a mesma mensagem para inativo, bloqueado e sem credencial", () => {
    // Mensagem diferente por motivo revelaria a existência e o estado da conta a
    // quem só está testando matrículas.
    const inativo = comPin();
    inativo.desativar();

    const semCredencial = criar();

    const bloqueado = comPin();
    for (let tentativa = 0; tentativa < TENTATIVAS_ATE_BLOQUEIO; tentativa += 1) {
      bloqueado.registrarFalhaDeAcesso("PIN", AGORA);
    }

    const mensagens = [inativo, semCredencial, bloqueado].map((usuario) => {
      const resultado = usuario.podeTentarAcesso("PIN", AGORA);
      return resultado.isErr() ? resultado.error.mensagem : "";
    });

    expect(new Set(mensagens).size).toBe(1);
  });

  it("guarda o motivo real nos detalhes, para o log", () => {
    const usuario = criar();

    const resultado = usuario.podeTentarAcesso("PIN", AGORA);

    expect(resultado.isErr() && resultado.error.detalhes?.["motivo"]).toBe(
      "SEM_CREDENCIAL",
    );
  });
});

describe("bloqueio progressivo", () => {
  it("não bloqueia antes do limite de tentativas", () => {
    const usuario = comPin();

    for (let tentativa = 1; tentativa < TENTATIVAS_ATE_BLOQUEIO; tentativa += 1) {
      expect(usuario.registrarFalhaDeAcesso("PIN", AGORA)).toBeUndefined();
    }

    expect(usuario.estaBloqueado(AGORA)).toBe(false);
    expect(usuario.tentativasSeguidas).toBe(TENTATIVAS_ATE_BLOQUEIO - 1);
  });

  it("bloqueia por quinze minutos na quinta falha", () => {
    const usuario = comPin();

    let ate: Date | undefined;
    for (let tentativa = 0; tentativa < TENTATIVAS_ATE_BLOQUEIO; tentativa += 1) {
      ate = usuario.registrarFalhaDeAcesso("PIN", AGORA);
    }

    expect(ate).toEqual(minutosDepois(AGORA, BLOQUEIO_INICIAL_MINUTOS));
    expect(usuario.estaBloqueado(AGORA)).toBe(true);
  });

  it("devolve o instante do desbloqueio, para a tela poder informá-lo", () => {
    // "Tente novamente às 14h15" é acionável; "acesso negado" não diz nada a
    // quem está com fila esperando.
    const usuario = comPin();
    let ate: Date | undefined;

    for (let tentativa = 0; tentativa < TENTATIVAS_ATE_BLOQUEIO; tentativa += 1) {
      ate = usuario.registrarFalhaDeAcesso("PIN", AGORA);
    }

    expect(ate).toBeInstanceOf(Date);
  });

  it("libera sozinho quando o prazo passa", () => {
    const usuario = comPin();
    for (let tentativa = 0; tentativa < TENTATIVAS_ATE_BLOQUEIO; tentativa += 1) {
      usuario.registrarFalhaDeAcesso("PIN", AGORA);
    }

    expect(
      usuario.estaBloqueado(minutosDepois(AGORA, BLOQUEIO_INICIAL_MINUTOS - 1)),
    ).toBe(true);
    expect(usuario.estaBloqueado(minutosDepois(AGORA, BLOQUEIO_INICIAL_MINUTOS))).toBe(
      false,
    );
  });

  it("dobra a duração na reincidência", () => {
    const usuario = comPin();

    const bloquear = (instante: Date): Date | undefined => {
      let ate: Date | undefined;
      for (let tentativa = 0; tentativa < TENTATIVAS_ATE_BLOQUEIO; tentativa += 1) {
        ate = usuario.registrarFalhaDeAcesso("PIN", instante);
      }
      return ate;
    };

    const primeiro = bloquear(AGORA);
    const depois = minutosDepois(AGORA, BLOQUEIO_INICIAL_MINUTOS);
    const segundo = bloquear(depois);

    expect(primeiro).toEqual(minutosDepois(AGORA, 15));
    expect(segundo).toEqual(minutosDepois(depois, 30));
    expect(usuario.bloqueiosSeguidos).toBe(2);
  });

  it("não passa do teto de uma hora", () => {
    // Bloqueio de dias transformaria a defesa em negação de serviço contra a
    // própria loja.
    const usuario = comPin();
    let ate: Date | undefined;
    let instante = AGORA;

    for (let rodada = 0; rodada < 8; rodada += 1) {
      for (let tentativa = 0; tentativa < TENTATIVAS_ATE_BLOQUEIO; tentativa += 1) {
        ate = usuario.registrarFalhaDeAcesso("PIN", instante);
      }
      instante = minutosDepois(instante, BLOQUEIO_MAXIMO_MINUTOS);
    }

    const ultimoInicio = minutosDepois(instante, -BLOQUEIO_MAXIMO_MINUTOS);
    expect(ate).toEqual(minutosDepois(ultimoInicio, BLOQUEIO_MAXIMO_MINUTOS));
  });

  it("acesso bem-sucedido zera a escalada", () => {
    // Carregar punição de um erro de digitação da semana passada faria o segundo
    // esquecimento render meia hora de caixa parado.
    const usuario = comPin();
    for (let tentativa = 0; tentativa < TENTATIVAS_ATE_BLOQUEIO; tentativa += 1) {
      usuario.registrarFalhaDeAcesso("PIN", AGORA);
    }

    usuario.registrarAcesso("PIN", minutosDepois(AGORA, 20));

    expect(usuario.bloqueiosSeguidos).toBe(0);
    expect(usuario.tentativasSeguidas).toBe(0);
    expect(usuario.bloqueadoAte).toBeUndefined();
    expect(usuario.ultimoAcessoEm).toEqual(minutosDepois(AGORA, 20));
  });

  it("desbloqueio pelo ADMIN libera sem esperar o prazo", () => {
    const usuario = comPin();
    for (let tentativa = 0; tentativa < TENTATIVAS_ATE_BLOQUEIO; tentativa += 1) {
      usuario.registrarFalhaDeAcesso("PIN", AGORA);
    }

    usuario.desbloquear();

    expect(usuario.estaBloqueado(AGORA)).toBe(false);
    expect(usuario.bloqueiosSeguidos).toBe(0);
  });
});

describe("eventos de auditoria", () => {
  it("registra acesso autorizado com o meio usado", () => {
    const usuario = comPin();

    usuario.registrarAcesso("PIN", AGORA);

    const eventos = usuario.coletarEventos();
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      tipo: "AcessoAutorizado",
      matricula: "7",
      meio: "PIN",
      ocorridoEm: AGORA,
    });
  });

  it("registra cada recusa com a contagem de tentativas", () => {
    const usuario = comPin();

    usuario.registrarFalhaDeAcesso("SENHA", AGORA);
    usuario.registrarFalhaDeAcesso("SENHA", AGORA);

    const eventos = usuario.coletarEventos();
    expect(eventos).toHaveLength(2);
    expect(eventos[1]).toMatchObject({
      tipo: "AcessoRecusado",
      meio: "SENHA",
      tentativasSeguidas: 2,
    });
  });

  it("registra o bloqueio como evento próprio", () => {
    const usuario = comPin();

    for (let tentativa = 0; tentativa < TENTATIVAS_ATE_BLOQUEIO; tentativa += 1) {
      usuario.registrarFalhaDeAcesso("PIN", AGORA);
    }

    const eventos = usuario.coletarEventos();
    const bloqueio = eventos.at(-1) as UsuarioBloqueado;

    expect(bloqueio.tipo).toBe("UsuarioBloqueado");
    expect(bloqueio.bloqueiosSeguidos).toBe(1);
    expect(bloqueio.bloqueadoAte).toEqual(minutosDepois(AGORA, 15));
  });

  it("nenhum evento carrega credencial", () => {
    const usuario = comPin();
    usuario.registrarFalhaDeAcesso("PIN", AGORA);
    usuario.registrarAcesso("PIN", AGORA);

    expect(JSON.stringify(usuario.coletarEventos())).not.toContain("argon2");
  });
});

describe("credenciais", () => {
  it("definir PIN habilita o acesso pelo balcão", () => {
    const usuario = criar();
    usuario.definirPin(HASH);

    expect(usuario.hashPin).toBe(HASH);
    expect(usuario.podeTentarAcesso("PIN", AGORA).isOk()).toBe(true);
  });

  it("senha temporária exige troca no próximo acesso", () => {
    const usuario = criar();
    usuario.definirSenha(HASH, { temporaria: true });

    expect(usuario.precisaTrocarSenha).toBe(true);
  });

  it("senha definitiva não exige troca", () => {
    const usuario = criar();
    usuario.definirSenha(HASH, { temporaria: false });

    expect(usuario.precisaTrocarSenha).toBe(false);
  });

  it("trocar a senha temporária limpa a exigência", () => {
    const usuario = criar();
    usuario.definirSenha(HASH, { temporaria: true });
    usuario.definirSenha(HashCredencial.criar("$argon2id$nova").unwrap(), {
      temporaria: false,
    });

    expect(usuario.precisaTrocarSenha).toBe(false);
  });
});

describe("cadastro", () => {
  it("renomeia", () => {
    const usuario = criar();

    expect(usuario.renomear("  Ana Maria ").isOk()).toBe(true);
    expect(usuario.nome).toBe("Ana Maria");
  });

  it("recusa renomear para vazio", () => {
    const usuario = criar();

    expect(usuario.renomear("  ").isErr()).toBe(true);
    expect(usuario.nome).toBe("Ana");
  });

  it("troca os papéis", () => {
    const usuario = criar();

    expect(usuario.atribuirPapeis([papel("GERENTE")]).isOk()).toBe(true);
    expect(usuario.temPermissao("config:empresa")).toBe(true);
  });

  it("recusa deixar o usuário sem papel", () => {
    const usuario = criar();

    expect(usuario.atribuirPapeis([]).isErr()).toBe(true);
    expect(usuario.papeis).toHaveLength(1);
  });
});

describe("permissões e alçada", () => {
  it("une as permissões dos papéis, sem repetir", () => {
    const usuario = criar([papel("OPERADOR_CAIXA"), papel("ESTOQUISTA")]);

    expect(usuario.temPermissao("venda:criar")).toBe(true);
    expect(usuario.temPermissao("estoque:entrada")).toBe(true);
    expect(new Set(usuario.permissoes).size).toBe(usuario.permissoes.length);
  });

  it("nega o que nenhum papel concede", () => {
    expect(criar().temPermissao("config:fiscal")).toBe(false);
  });

  it("usa o maior limite entre os papéis", () => {
    // Papel adiciona capacidade, nunca subtrai: ganhar um papel extra não pode
    // reduzir o que a pessoa já podia fazer.
    const usuario = criar([papel("OPERADOR_CAIXA"), papel("SUPERVISOR")]);

    expect(usuario.limites.descontoItem).toBe(1_500);
    expect(usuario.limites.cancelarVendaAteMinutos).toBe(30);
    expect(usuario.limites.sangria).toEqual(Dinheiro.deReais("500.00").unwrap());
  });

  it("ilimitado em um papel vale para o usuário", () => {
    const usuario = criar([papel("SUPERVISOR"), papel("GERENTE")]);

    expect(usuario.limites.sangria).toBe(ILIMITADO);
    expect(usuario.limites.estornoEmDinheiro).toBe(ILIMITADO);
    expect(usuario.limites.cancelarVendaAteMinutos).toBe(ILIMITADO);
  });

  it("com um papel só, repete os limites dele", () => {
    const usuario = criar([papel("OPERADOR_CAIXA")]);

    expect(usuario.limites.descontoItem).toBe(500);
    expect(usuario.limites.sangria).toEqual(Dinheiro.zero());
  });
});

describe("Usuario.reconstituir", () => {
  it("restaura o estado vindo do banco", () => {
    const bloqueadoAte = minutosDepois(AGORA, 10);

    const usuario = Usuario.reconstituir({
      id: ID,
      matricula: Matricula.criar("7").unwrap(),
      nome: "Ana",
      papeis: [papel("SUPERVISOR")],
      hashPin: HASH,
      hashSenha: undefined,
      ativo: false,
      precisaTrocarSenha: true,
      tentativasSeguidas: 3,
      bloqueiosSeguidos: 2,
      bloqueadoAte,
      ultimoAcessoEm: AGORA,
    }).unwrap();

    expect(usuario.ativo).toBe(false);
    expect(usuario.precisaTrocarSenha).toBe(true);
    expect(usuario.tentativasSeguidas).toBe(3);
    expect(usuario.bloqueiosSeguidos).toBe(2);
    expect(usuario.bloqueadoAte).toEqual(bloqueadoAte);
    expect(usuario.ultimoAcessoEm).toEqual(AGORA);
    expect(usuario.hashSenha).toBeUndefined();
  });

  it("não gera evento ao reconstituir", () => {
    // Evento aqui seria auditoria duplicada a cada consulta ao banco.
    const usuario = Usuario.reconstituir({
      id: ID,
      matricula: Matricula.criar("7").unwrap(),
      nome: "Ana",
      papeis: [papel("SUPERVISOR")],
      hashPin: HASH,
      hashSenha: undefined,
      ativo: true,
      precisaTrocarSenha: false,
      tentativasSeguidas: 0,
      bloqueiosSeguidos: 0,
      bloqueadoAte: undefined,
      ultimoAcessoEm: undefined,
    }).unwrap();

    expect(usuario.temEventosPendentes).toBe(false);
  });

  it("propaga erro de dados inválidos", () => {
    const resultado = Usuario.reconstituir({
      id: ID,
      matricula: Matricula.criar("7").unwrap(),
      nome: "",
      papeis: [papel("SUPERVISOR")],
      hashPin: undefined,
      hashSenha: undefined,
      ativo: true,
      precisaTrocarSenha: false,
      tentativasSeguidas: 0,
      bloqueiosSeguidos: 0,
      bloqueadoAte: undefined,
      ultimoAcessoEm: undefined,
    });

    expect(resultado.isErr()).toBe(true);
  });

  it("bloqueio vindo do banco continua valendo", () => {
    const usuario = Usuario.reconstituir({
      id: ID,
      matricula: Matricula.criar("7").unwrap(),
      nome: "Ana",
      papeis: [papel("OPERADOR_CAIXA")],
      hashPin: HASH,
      hashSenha: undefined,
      ativo: true,
      precisaTrocarSenha: false,
      tentativasSeguidas: 0,
      bloqueiosSeguidos: 1,
      bloqueadoAte: minutosDepois(AGORA, 5),
      ultimoAcessoEm: undefined,
    }).unwrap();

    // Reiniciar o servidor não pode zerar um bloqueio em curso — seria a forma
    // mais simples de contorná-lo.
    expect(usuario.podeTentarAcesso("PIN", AGORA).isErr()).toBe(true);
  });
});
