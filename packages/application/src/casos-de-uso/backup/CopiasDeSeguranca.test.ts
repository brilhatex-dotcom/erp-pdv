import { err, ErroRegraNegocio, ok } from "@erp/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ANA, montarCopias, RESUMO, segurar } from "../../testes/backup.js";
import { textoDoErro } from "./configuracao.js";
import { descreverCopia, formatarTamanho } from "./CopiasDeSeguranca.js";
import type { CopiaGuardada } from "./portas.js";

/**
 * As regras da cópia de segurança, com o banco e o disco de mentira.
 *
 * O que se verifica é a ordem e as recusas: provar toda cópia, apagar só o que
 * a retenção manda, registrar cada tentativa — inclusive a que falhou —, nunca
 * restaurar sem a palavra, sem conferir, sem a cópia de antes, e sempre deixar
 * o registro de quem restaurou.
 */

let balcao: ReturnType<typeof montarCopias>;

beforeEach(() => {
  balcao = montarCopias();
});

describe("fazer a cópia", () => {
  it("🔑 gera, prova, guarda e registra quem fez", async () => {
    const copia = (
      await balcao.fazer.executar({ origem: "MANUAL", usuarioId: ANA })
    ).unwrap();

    expect(copia).toMatchObject({
      origem: "MANUAL",
      tamanhoBytes: 12_900_000,
      prova: { restaurou: true },
    });
    expect(balcao.pasta.copias.size).toBe(1);

    const [registro] = balcao.ambiente.auditoria.da("BACKUP_EXECUTADO");
    expect(registro?.usuarioId?.equals(ANA)).toBe(true);
    expect(registro?.descricao).toBe(
      "Cópia de segurança feita à mão: 12,3 MB, conferida (1.234 vendas).",
    );
    expect(registro?.dados).toMatchObject({ arquivo: copia.nome, restaurou: true });
  });

  it("🔑 a tentativa fica registrada, do começo ao fim", async () => {
    const copia = (
      await balcao.fazer.executar({ origem: "MANUAL", usuarioId: ANA })
    ).unwrap();

    const [execucao] = balcao.ambiente.backup.emOrdem();
    expect(execucao).toMatchObject({
      operacao: "BACKUP",
      origem: "MANUAL",
      situacao: "CONCLUIDO",
      arquivo: copia.nome,
      tamanhoBytes: 12_900_000,
      sha256: "f".repeat(64),
      erro: undefined,
    });
    expect(execucao?.usuarioId?.equals(ANA)).toBe(true);
    expect(execucao?.concluidaEm).toBeInstanceOf(Date);
  });

  it("🔑 a cópia leva a hora do começo — a da fotografia do banco", async () => {
    const comeco = balcao.ambiente.relogio.agora();
    const gerar = balcao.ferramenta.gerar.bind(balcao.ferramenta);
    vi.spyOn(balcao.ferramenta, "gerar").mockImplementationOnce(() => {
      balcao.ambiente.relogio.avancar(90_000);
      return gerar();
    });

    const copia = (await balcao.fazer.executar({ origem: "AUTOMATICA" })).unwrap();

    expect(copia.criadaEm).toEqual(comeco);
    const [execucao] = balcao.ambiente.backup.emOrdem();
    expect(execucao?.iniciadaEm).toEqual(comeco);
    expect(execucao?.concluidaEm).toEqual(new Date(comeco.getTime() + 90_000));
  });

  it("🔑 a cópia que não restaura é guardada assim, e o registro diz", async () => {
    balcao.ferramenta.provaPadrao = { restaurou: false, motivo: "arquivo truncado" };

    const copia = (await balcao.fazer.executar({ origem: "AUTOMATICA" })).unwrap();

    expect(copia.prova).toEqual({ restaurou: false, motivo: "arquivo truncado" });
    const [registro] = balcao.ambiente.auditoria.da("BACKUP_EXECUTADO");
    expect(registro?.usuarioId).toBeUndefined();
    expect(registro?.descricao).toContain(
      "NÃO restaurou na conferência: arquivo truncado",
    );
    expect(balcao.ambiente.backup.emOrdem()).toMatchObject([
      {
        situacao: "FALHOU",
        arquivo: copia.nome,
        erro: "A cópia foi feita, mas não restaurou na conferência: arquivo truncado",
      },
    ]);
  });

  it("🔑 falha ao gerar não guarda nada, e a tentativa fica como falha", async () => {
    balcao.ferramenta.falharAoGerar();

    const resultado = await balcao.fazer.executar({ origem: "AUTOMATICA" });

    expect(resultado.isErr() && resultado.error.codigo).toBe("BACKUP_FALHOU");
    expect(balcao.pasta.copias.size).toBe(0);
    expect(balcao.ambiente.auditoria.da("BACKUP_EXECUTADO")).toHaveLength(0);
    const [execucao] = balcao.ambiente.backup.emOrdem();
    expect(execucao).toMatchObject({
      situacao: "FALHOU",
      erro: "O banco não respondeu.",
    });
    expect(execucao?.arquivo).toBeUndefined();
  });

  it("🔑 pasta que não grava vira falha com o detalhe para o suporte — nunca exceção", async () => {
    vi.spyOn(balcao.pasta, "guardar").mockRejectedValueOnce(
      new Error("ENOSPC: no space left on device"),
    );

    const resultado = await balcao.fazer.executar({ origem: "AUTOMATICA" });

    expect(resultado.isErr() && resultado.error.codigo).toBe("BACKUP_FALHOU");
    expect(resultado.isErr() && resultado.error.mensagem).toContain(
      "Confira se há espaço no disco",
    );
    const [execucao] = balcao.ambiente.backup.emOrdem();
    expect(execucao?.situacao).toBe("FALHOU");
    expect(execucao?.erro).toContain(
      "Detalhe para o suporte: ENOSPC: no space left on device",
    );
    expect(balcao.trava.ocupada).toBe(false);
  });

  it("o que for lançado sem ser Error também vira texto no registro", async () => {
    vi.spyOn(balcao.pasta, "guardar").mockRejectedValueOnce("pasta sumiu");

    const resultado = await balcao.fazer.executar({ origem: "AUTOMATICA" });

    expect(resultado.isErr()).toBe(true);
    expect(balcao.ambiente.backup.emOrdem()[0]?.erro).toContain(
      "Detalhe para o suporte: pasta sumiu",
    );
  });

  it("🔑 a pasta que não lista depois de guardar não faz da cópia boa uma falha", async () => {
    vi.spyOn(balcao.pasta, "listar").mockRejectedValueOnce(new Error("EBUSY"));

    const resultado = await balcao.fazer.executar({ origem: "AUTOMATICA" });

    expect(resultado.isOk()).toBe(true);
    expect(balcao.pasta.copias.size).toBe(1);
    expect(balcao.ambiente.backup.emOrdem()[0]?.situacao).toBe("CONCLUIDO");
  });

  it("🔑 aplica a retenção depois de cada cópia", async () => {
    for (let hora = 0; hora < 26; hora += 1) {
      await balcao.fazer.executar({ origem: "AUTOMATICA" });
      balcao.ambiente.relogio.avancar(3_600_000);
    }

    // De 17/10 13h a 18/10 14h: as 24 últimas horas ficam, e as duas
    // primeiras não representam nenhum dia, semana ou mês que as outras já
    // não representem — saem.
    expect(balcao.pasta.copias.size).toBe(24);
    expect(balcao.pasta.apagadas).toEqual([
      "erp-2026-10-17T13:00:00.000Z-automatica.dump",
      "erp-2026-10-17T14:00:00.000Z-automatica.dump",
    ]);
  });

  it("🔑 as cópias recentes que o suporte ajustou valem na retenção", async () => {
    balcao.ambiente.backup.configuracaoAtual = {
      intervaloHoras: 1,
      aoFecharCaixa: true,
      copiasRecentes: 3,
    };

    for (let hora = 0; hora < 6; hora += 1) {
      await balcao.fazer.executar({ origem: "AUTOMATICA" });
      balcao.ambiente.relogio.avancar(3_600_000);
    }

    // Todas do mesmo dia: a mais nova já representa o dia, a semana e o mês.
    expect([...balcao.pasta.copias.keys()]).toEqual([
      "erp-2026-10-17T16:00:00.000Z-automatica.dump",
      "erp-2026-10-17T17:00:00.000Z-automatica.dump",
      "erp-2026-10-17T18:00:00.000Z-automatica.dump",
    ]);
  });

  it("🔑 com o banco fora do ar, a cópia feita não é jogada fora", async () => {
    balcao.ambiente.unitOfWork.falharAoConfirmar = true;

    const resultado = await balcao.fazer.executar({ origem: "MANUAL" });

    expect(resultado.isOk()).toBe(true);
    expect(balcao.pasta.copias.size).toBe(1);
  });

  it("🔑 uma cópia de cada vez: a segunda, no meio da primeira, é recusada", async () => {
    const { presa, soltar } = segurar();
    vi.spyOn(balcao.ferramenta, "gerar").mockImplementationOnce(async () => {
      await presa;
      return ok({ caminho: "/tmp/lento", tamanhoBytes: 10, sha256: "0".repeat(64) });
    });

    const primeira = balcao.fazer.executar({ origem: "AUTOMATICA" });
    expect(balcao.trava.ocupada).toBe(true);

    const segunda = await balcao.fazer.executar({ origem: "MANUAL" });
    expect(segunda.isErr() && segunda.error.codigo).toBe("COPIA_EM_ANDAMENTO");

    soltar();
    expect((await primeira).isOk()).toBe(true);
    expect(balcao.trava.ocupada).toBe(false);
  });
});

describe("conferir a cópia", () => {
  it("🔑 prova de novo, e compara com o banco de agora", async () => {
    const copia = (await balcao.fazer.executar({ origem: "MANUAL" })).unwrap();

    const conferencia = (await balcao.conferir.executar(copia.nome)).unwrap();

    expect(conferencia).toMatchObject({
      copia: { nome: copia.nome },
      compativel: true,
      atual: RESUMO,
    });
    expect(conferencia.prova.restaurou).toBe(true);
  });

  it("cópia de outra versão do sistema não é compatível", async () => {
    const copia = (await balcao.fazer.executar({ origem: "MANUAL" })).unwrap();
    balcao.ferramenta.atual = {
      ...RESUMO,
      migracoes: [...RESUMO.migracoes, "20261101_nova"],
    };

    expect((await balcao.conferir.executar(copia.nome)).unwrap().compativel).toBe(false);

    balcao.ferramenta.atual = {
      ...RESUMO,
      migracoes: ["20260801_inicial", "20261016_outra"],
    };
    expect((await balcao.conferir.executar(copia.nome)).unwrap().compativel).toBe(false);
  });

  it("cópia que não restaura na conferência não é compatível", async () => {
    const copia = (await balcao.fazer.executar({ origem: "MANUAL" })).unwrap();
    balcao.ferramenta.provas.set(`/copias/${copia.nome}`, {
      restaurou: false,
      motivo: "corrompida",
    });

    expect((await balcao.conferir.executar(copia.nome)).unwrap()).toMatchObject({
      compativel: false,
      prova: { restaurou: false },
    });
  });

  it("cópia que sumiu da pasta é avisada", async () => {
    const resultado = await balcao.conferir.executar("erp-nao-existe.dump");

    expect(resultado.isErr() && resultado.error.codigo).toBe("COPIA_NAO_ENCONTRADA");
  });
});

describe("restaurar a cópia", () => {
  async function copiaBoa(): Promise<CopiaGuardada> {
    const copia = (
      await balcao.fazer.executar({ origem: "MANUAL", usuarioId: ANA })
    ).unwrap();
    balcao.ambiente.relogio.avancar(60_000);
    return copia;
  }

  function pedido(nome: string, confirmacao = "RESTAURAR") {
    return { nome, confirmacao, usuarioId: ANA, quem: "Ana Gerente (matrícula 1)" };
  }

  function restauracoes() {
    return balcao.ambiente.backup
      .emOrdem()
      .filter((execucao) => execucao.operacao === "RESTAURACAO");
  }

  it("🔑 sem a palavra RESTAURAR, nada acontece", async () => {
    const copia = await copiaBoa();

    for (const confirmacao of ["", "sim", "restaura"]) {
      const resultado = await balcao.restaurar.executar(pedido(copia.nome, confirmacao));
      expect(resultado.isErr() && resultado.error.codigo).toBe("CONFIRMACAO_INCORRETA");
    }
    expect(balcao.ferramenta.restauradas).toHaveLength(0);
    expect(restauracoes()).toHaveLength(0);
  });

  it("🔑 confere, faz a cópia de antes, troca em manutenção e registra quem fez", async () => {
    const copia = await copiaBoa();

    const saida = (
      await balcao.restaurar.executar(pedido(copia.nome, " restaurar "))
    ).unwrap();

    expect(saida.restaurada.nome).toBe(copia.nome);
    expect(saida.copiaDeAntes.origem).toBe("ANTES_DE_RESTAURAR");
    expect(balcao.pasta.copias.has(saida.copiaDeAntes.nome)).toBe(true);
    // Feita na mesma hora, a cópia de antes não empurra a restaurada para fora.
    expect(balcao.pasta.copias.has(copia.nome)).toBe(true);
    expect(balcao.pasta.apagadas).toEqual([]);
    expect(balcao.ferramenta.restauradas).toEqual([`/copias/${copia.nome}`]);
    expect(balcao.manutencao.vezes).toBe(1);
    expect(balcao.manutencao.ativa).toBe(false);

    const [registro] = balcao.ambiente.auditoria.da("BACKUP_RESTAURADO");
    expect(registro?.usuarioId?.equals(ANA)).toBe(true);
    expect(registro?.descricao).toContain("por Ana Gerente (matrícula 1)");
    expect(registro?.descricao).toContain(saida.copiaDeAntes.nome);

    const [restauracao] = restauracoes();
    expect(restauracao).toMatchObject({
      origem: "MANUAL",
      situacao: "CONCLUIDO",
      arquivo: copia.nome,
      sha256: copia.sha256,
    });
    expect(restauracao?.usuarioId?.equals(ANA)).toBe(true);
  });

  it("🔑 se quem restaurou não existe na cópia, o registro sai sem o vínculo, com o nome no texto", async () => {
    const copia = await copiaBoa();
    const registrar = vi.spyOn(balcao.ambiente.auditoria, "registrar");
    // A cópia de antes grava normalmente; a restauração, com usuário, falha.
    registrar.mockImplementation((registro) => {
      if (registro.acao === "BACKUP_RESTAURADO" && registro.usuarioId !== undefined) {
        return Promise.reject(new Error("usuário não existe nesta cópia"));
      }
      balcao.ambiente.auditoria.registros.push(registro);
      return Promise.resolve();
    });

    (await balcao.restaurar.executar(pedido(copia.nome))).unwrap();

    const [registro] = balcao.ambiente.auditoria.da("BACKUP_RESTAURADO");
    expect(registro?.usuarioId).toBeUndefined();
    expect(registro?.descricao).toContain("por Ana Gerente (matrícula 1)");
    expect(restauracoes()).toMatchObject([
      { situacao: "CONCLUIDO", usuarioId: undefined },
    ]);
  });

  it("🔑 a recusa fica registrada no banco de agora, com o motivo", async () => {
    const copia = await copiaBoa();
    balcao.ferramenta.provas.set(`/copias/${copia.nome}`, {
      restaurou: false,
      motivo: "corrompida",
    });

    const resultado = await balcao.restaurar.executar(pedido(copia.nome));

    expect(resultado.isErr() && resultado.error.codigo).toBe("COPIA_NAO_RESTAURA");
    expect(resultado.isErr() && resultado.error.mensagem).toContain("corrompida");
    expect(balcao.ferramenta.restauradas).toHaveLength(0);

    const [restauracao] = restauracoes();
    expect(restauracao).toMatchObject({ situacao: "FALHOU", arquivo: copia.nome });
    expect(restauracao?.erro).toContain("corrompida");
  });

  it("🔑 cópia de outra versão do sistema não é restaurada por aqui", async () => {
    const copia = await copiaBoa();
    balcao.ferramenta.atual = {
      ...RESUMO,
      migracoes: [...RESUMO.migracoes, "20261101_nova"],
    };

    const resultado = await balcao.restaurar.executar(pedido(copia.nome));

    expect(resultado.isErr() && resultado.error.codigo).toBe("COPIA_DE_OUTRA_VERSAO");
    expect(balcao.ferramenta.restauradas).toHaveLength(0);
  });

  it("🔑 com caixa aberto, espera os caixas fecharem — a não ser que se peça mesmo assim", async () => {
    const copia = await copiaBoa();
    balcao.ferramenta.atual = { ...RESUMO, caixasAbertos: 2 };

    const recusada = await balcao.restaurar.executar(pedido(copia.nome));
    expect(recusada.isErr() && recusada.error.codigo).toBe("CAIXAS_ABERTOS");
    expect(recusada.isErr() && recusada.error.mensagem).toContain(
      "Há 2 caixas abertos agora.",
    );
    expect(balcao.ferramenta.restauradas).toHaveLength(0);

    balcao.ferramenta.atual = { ...RESUMO, caixasAbertos: 1 };
    const umAberto = await balcao.restaurar.executar(pedido(copia.nome));
    expect(umAberto.isErr() && umAberto.error.mensagem).toContain(
      "Há 1 caixa aberto agora.",
    );

    const mesmoAssim = await balcao.restaurar.executar({
      ...pedido(copia.nome),
      comCaixasAbertos: true,
    });
    expect(mesmoAssim.isOk()).toBe(true);
    expect(balcao.ferramenta.restauradas).toHaveLength(1);
  });

  it("cópia que sumiu não é restaurada", async () => {
    const resultado = await balcao.restaurar.executar(pedido("erp-sumiu.dump"));

    expect(resultado.isErr() && resultado.error.codigo).toBe("COPIA_NAO_ENCONTRADA");
  });

  it("🔑 sem a cópia de antes, nada é trocado", async () => {
    const copia = await copiaBoa();
    balcao.ferramenta.falharAoGerar();

    const resultado = await balcao.restaurar.executar(pedido(copia.nome));

    expect(resultado.isErr() && resultado.error.codigo).toBe("BACKUP_FALHOU");
    expect(balcao.ferramenta.restauradas).toHaveLength(0);
  });

  it("🔑 a cópia de antes que não passou na prova também impede a troca", async () => {
    const copia = await copiaBoa();
    // A próxima a ser gerada é a de antes: o caminho dela é o segundo gerado.
    balcao.ferramenta.provas.set("/tmp/gerado-2", {
      restaurou: false,
      motivo: "disco cheio",
    });

    const resultado = await balcao.restaurar.executar(pedido(copia.nome));

    expect(resultado.isErr() && resultado.error.codigo).toBe("COPIA_DE_ANTES_FALHOU");
    expect(balcao.ferramenta.restauradas).toHaveLength(0);
  });

  it("restauração que falha devolve o erro, e nada é registrado como restaurado", async () => {
    const copia = await copiaBoa();
    balcao.ferramenta.resultadoDaRestauracao = err(
      new ErroRegraNegocio(
        "RESTAURACAO_FALHOU",
        "A restauração não terminou. O banco continua como estava.",
      ),
    );

    const resultado = await balcao.restaurar.executar(pedido(copia.nome));

    expect(resultado.isErr() && resultado.error.codigo).toBe("RESTAURACAO_FALHOU");
    expect(balcao.ambiente.auditoria.da("BACKUP_RESTAURADO")).toHaveLength(0);
    expect(balcao.manutencao.ativa).toBe(false);
    expect(restauracoes()).toMatchObject([{ situacao: "FALHOU" }]);
  });

  it("no meio de uma cópia, a restauração não espera a vez — é recusada", async () => {
    const copia = await copiaBoa();
    const { presa, soltar } = segurar();
    vi.spyOn(balcao.ferramenta, "gerar").mockImplementationOnce(async () => {
      await presa;
      return ok({ caminho: "/tmp/lento", tamanhoBytes: 10, sha256: "0".repeat(64) });
    });

    const copiando = balcao.fazer.executar({ origem: "AUTOMATICA" });
    const resultado = await balcao.restaurar.executar(pedido(copia.nome));

    expect(resultado.isErr() && resultado.error.codigo).toBe("COPIA_EM_ANDAMENTO");
    soltar();
    await copiando;
  });
});

describe("textos", () => {
  it("o tamanho em KB e em MB, com vírgula", () => {
    expect(formatarTamanho(100)).toBe("1 KB");
    expect(formatarTamanho(850 * 1024)).toBe("850 KB");
    expect(formatarTamanho(12_900_000)).toBe("12,3 MB");
  });

  it("a descrição de cada origem", () => {
    const base: CopiaGuardada = {
      nome: "erp.dump",
      criadaEm: new Date(),
      origem: "FECHAMENTO_DE_CAIXA",
      tamanhoBytes: 2048,
      sha256: "0",
      prova: { restaurou: true, resumo: { ...RESUMO, vendas: 1 } },
    };

    expect(descreverCopia(base)).toBe(
      "Cópia de segurança do fechamento de caixa: 2 KB, conferida (1 venda).",
    );
    expect(descreverCopia({ ...base, origem: "ANTES_DE_RESTAURAR" })).toContain(
      "de antes de uma restauração",
    );
    expect(descreverCopia({ ...base, origem: "AUTOMATICA" })).toContain("automática");
  });

  it("o erro registrado leva o detalhe técnico só quando há, e cabe na coluna", () => {
    const semDetalhe = new ErroRegraNegocio("X", "O banco não respondeu.");
    const detalheVazio = new ErroRegraNegocio("X", "O banco não respondeu.", {
      causa: "",
    });
    const detalheQueNaoETexto = new ErroRegraNegocio("X", "O banco não respondeu.", {
      causa: 42,
    });
    const comprido = new ErroRegraNegocio("X", "Falhou.", { causa: "x".repeat(600) });

    expect(textoDoErro(semDetalhe)).toBe("O banco não respondeu.");
    expect(textoDoErro(detalheVazio)).toBe("O banco não respondeu.");
    expect(textoDoErro(detalheQueNaoETexto)).toBe("O banco não respondeu.");
    expect(textoDoErro(comprido)).toHaveLength(500);
    expect(textoDoErro(comprido).endsWith("…")).toBe(true);
  });
});
