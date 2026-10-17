import { err, ErroRegraNegocio, ok } from "@erp/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ANA, montarCopias, segurar } from "../../testes/backup.js";
import {
  copiaAutomaticaDevida,
  DefinirConfiguracaoDeBackup,
  proximaCopiaAutomatica,
} from "./AgendaDeCopias.js";
import { CONFIGURACAO_DE_BACKUP_PADRAO } from "./configuracao.js";

/**
 * A agenda: quando a cópia sai sozinha, e o que acontece quando ela não pode.
 *
 * O relógio é o dos dublês — uma hora passa numa linha, e a regra de "tentar
 * de novo em uma hora depois de falhar" se verifica sem esperar.
 */

const HORA = 3_600_000;
const AGORA = new Date("2026-10-17T13:00:00.000Z");

function horasAntes(horas: number): Date {
  return new Date(AGORA.getTime() - horas * HORA);
}

let balcao: ReturnType<typeof montarCopias>;

beforeEach(() => {
  balcao = montarCopias(AGORA);
});

describe("quando sai a próxima cópia automática", () => {
  it("🔑 loja que nunca copiou copia já", () => {
    expect(copiaAutomaticaDevida({ intervaloHoras: 1 }, AGORA)).toBe(true);
  });

  it("🔑 conta da última cópia boa", () => {
    expect(
      copiaAutomaticaDevida({ intervaloHoras: 1, ultimaProvada: horasAntes(1) }, AGORA),
    ).toBe(true);
    expect(
      copiaAutomaticaDevida(
        { intervaloHoras: 1, ultimaProvada: horasAntes(59 / 60) },
        AGORA,
      ),
    ).toBe(false);
    expect(
      proximaCopiaAutomatica({ intervaloHoras: 4, ultimaProvada: horasAntes(1) }),
    ).toEqual(new Date(AGORA.getTime() + 3 * HORA));
  });

  it("🔑 depois de uma falha, tenta de novo em uma hora — mesmo com a agenda de 24 em 24", () => {
    const marcos = {
      intervaloHoras: 24,
      ultimaProvada: horasAntes(30),
      ultimaTentativa: horasAntes(0.5),
    };

    expect(copiaAutomaticaDevida(marcos, AGORA)).toBe(false);
    expect(proximaCopiaAutomatica(marcos)).toEqual(
      new Date(AGORA.getTime() + 0.5 * HORA),
    );
    expect(
      copiaAutomaticaDevida({ ...marcos, ultimaTentativa: horasAntes(1) }, AGORA),
    ).toBe(true);
  });

  it("a agenda desligada pelo suporte nunca copia sozinha", () => {
    expect(proximaCopiaAutomatica({ intervaloHoras: 0 })).toBeUndefined();
    expect(copiaAutomaticaDevida({ intervaloHoras: 0 }, AGORA)).toBe(false);
  });
});

describe("a agenda batida pelo relógio", () => {
  it("🔑 faz a cópia automática quando é hora, e espera quando não é", async () => {
    expect(await balcao.agenda.verificar()).toBe("AUTOMATICA");
    expect(balcao.pasta.copias.size).toBe(1);

    balcao.ambiente.relogio.avancar(30 * 60_000);
    expect(await balcao.agenda.verificar()).toBeUndefined();

    balcao.ambiente.relogio.avancar(30 * 60_000);
    expect(await balcao.agenda.verificar()).toBe("AUTOMATICA");
    expect(balcao.pasta.copias.size).toBe(2);
  });

  it("🔑 a cópia que falhou é repetida na hora seguinte, e não antes", async () => {
    balcao.ferramenta.falharAoGerar();
    expect(await balcao.agenda.verificar()).toBe("AUTOMATICA");

    balcao.ambiente.relogio.avancar(10 * 60_000);
    expect(await balcao.agenda.verificar()).toBeUndefined();

    balcao.ferramenta.erroAoGerar = undefined;
    balcao.ambiente.relogio.avancar(50 * 60_000);
    expect(await balcao.agenda.verificar()).toBe("AUTOMATICA");
    expect(balcao.pasta.copias.size).toBe(1);
  });

  it("🔑 o fechamento de caixa pede a cópia, que sai na hora", async () => {
    await balcao.agenda.verificar();
    balcao.ambiente.relogio.avancar(5 * 60_000);

    expect(await balcao.agenda.pedirCopiaDoFechamento()).toBe("FECHAMENTO_DE_CAIXA");
    expect(balcao.ambiente.backup.emOrdem().map((execucao) => execucao.origem)).toEqual([
      "AUTOMATICA",
      "FECHAMENTO_DE_CAIXA",
    ]);
    // Na mesma hora, a do fechamento — mais nova — é a que a retenção guarda.
    expect([...balcao.pasta.copias.values()].map((copia) => copia.origem)).toEqual([
      "FECHAMENTO_DE_CAIXA",
    ]);

    // O pedido foi atendido: a batida seguinte não repete a cópia.
    expect(await balcao.agenda.verificar()).toBeUndefined();
  });

  it("🔑 com a cópia do fechamento desligada, o pedido é esquecido", async () => {
    balcao.ambiente.backup.configuracaoAtual = {
      ...CONFIGURACAO_DE_BACKUP_PADRAO,
      aoFecharCaixa: false,
    };
    await balcao.agenda.verificar();

    expect(await balcao.agenda.pedirCopiaDoFechamento()).toBeUndefined();
    expect(await balcao.agenda.verificar()).toBeUndefined();
    expect(balcao.pasta.copias.size).toBe(1);
  });

  it("🔑 caixa fechado no meio de outra cópia: a do fechamento sai na batida seguinte", async () => {
    const { presa, soltar } = segurar();
    const gerar = balcao.ferramenta.gerar.bind(balcao.ferramenta);
    vi.spyOn(balcao.ferramenta, "gerar").mockImplementationOnce(async () => {
      await presa;
      return gerar();
    });

    const manual = balcao.fazer.executar({ origem: "MANUAL", usuarioId: ANA });
    expect(await balcao.agenda.pedirCopiaDoFechamento()).toBeUndefined();

    soltar();
    await manual;

    expect(await balcao.agenda.verificar()).toBe("FECHAMENTO_DE_CAIXA");
  });

  it("o pedido do fechamento que perde a vez no último instante não se perde", async () => {
    vi.spyOn(balcao.fazer, "executar").mockResolvedValueOnce(
      err(new ErroRegraNegocio("COPIA_EM_ANDAMENTO", "Já há uma cópia em andamento.")),
    );

    expect(await balcao.agenda.pedirCopiaDoFechamento()).toBe("FECHAMENTO_DE_CAIXA");
    expect(balcao.pasta.copias.size).toBe(0);

    expect(await balcao.agenda.verificar()).toBe("FECHAMENTO_DE_CAIXA");
    expect(balcao.pasta.copias.size).toBe(1);
  });

  it("o fechamento que falhou por outro motivo não fica repetindo", async () => {
    balcao.ferramenta.falharAoGerar();

    expect(await balcao.agenda.pedirCopiaDoFechamento()).toBe("FECHAMENTO_DE_CAIXA");

    // A automática, que conta da tentativa, também espera a hora seguinte.
    expect(await balcao.agenda.verificar()).toBeUndefined();
  });

  it("duas batidas ao mesmo tempo fazem uma cópia só", async () => {
    const [primeira, segunda] = await Promise.all([
      balcao.agenda.verificar(),
      balcao.agenda.verificar(),
    ]);

    expect([primeira, segunda]).toEqual(["AUTOMATICA", undefined]);
    expect(balcao.pasta.copias.size).toBe(1);
  });

  it("🔑 com o banco fora do ar, a agenda espera — sem lançar", async () => {
    balcao.ambiente.unitOfWork.falharAoConfirmar = true;

    expect(await balcao.agenda.verificar()).toBeUndefined();
    expect(balcao.pasta.copias.size).toBe(0);
  });

  it("🔑 a pasta que não abre não cala a agenda: a tentativa sai e registra a falha", async () => {
    vi.spyOn(balcao.pasta, "listar").mockRejectedValueOnce(new Error("EACCES"));

    expect(await balcao.agenda.verificar()).toBe("AUTOMATICA");
    expect(balcao.ambiente.backup.emOrdem()).toHaveLength(1);
  });

  it("🔑 nada do que a cópia lançar escapa da agenda", async () => {
    vi.spyOn(balcao.fazer, "executar").mockRejectedValueOnce(new Error("inesperado"));

    await expect(balcao.agenda.verificar()).resolves.toBeUndefined();
    // E a batida seguinte funciona: a agenda não ficou presa em "verificando".
    expect(await balcao.agenda.verificar()).toBe("AUTOMATICA");
  });
});

describe("a situação das cópias, para a tela", () => {
  it("🔑 as cópias da mais nova para a mais antiga, a agenda e a última tentativa", async () => {
    await balcao.fazer.executar({ origem: "AUTOMATICA" });
    balcao.ambiente.relogio.avancar(HORA);
    await balcao.fazer.executar({ origem: "MANUAL", usuarioId: ANA });

    const situacao = (await balcao.consultar.executar()).unwrap();

    expect(situacao.copias.map((copia) => copia.origem)).toEqual([
      "MANUAL",
      "AUTOMATICA",
    ]);
    expect(situacao.configuracao).toEqual(CONFIGURACAO_DE_BACKUP_PADRAO);
    expect(situacao.ultimaTentativa?.origem).toBe("MANUAL");
    expect(situacao.emAndamento).toBe(false);
    expect(situacao.proximaAutomatica).toEqual(new Date(AGORA.getTime() + 2 * HORA));
  });

  it("antes da primeira cópia, a próxima é já", async () => {
    const situacao = (await balcao.consultar.executar()).unwrap();

    expect(situacao.copias).toEqual([]);
    expect(situacao.ultimaTentativa).toBeUndefined();
    expect(situacao.proximaAutomatica).toEqual(new Date(0));
  });

  it("mostra a cópia em andamento", async () => {
    const { presa, soltar } = segurar();
    vi.spyOn(balcao.ferramenta, "gerar").mockImplementationOnce(async () => {
      await presa;
      return ok({ caminho: "/tmp/lento", tamanhoBytes: 10, sha256: "0".repeat(64) });
    });

    const copiando = balcao.fazer.executar({ origem: "MANUAL" });
    const situacao = (await balcao.consultar.executar()).unwrap();

    expect(situacao.emAndamento).toBe(true);
    expect(situacao.ultimaTentativa?.situacao).toBe("EM_ANDAMENTO");
    soltar();
    await copiando;
  });

  it("banco fora do ar devolve o erro, e não a lista pela metade", async () => {
    balcao.ambiente.unitOfWork.falharAoConfirmar = true;

    expect((await balcao.consultar.executar()).isErr()).toBe(true);
  });

  it("🔑 pasta que não abre é dita com palavras, com o detalhe guardado", async () => {
    vi.spyOn(balcao.pasta, "listar").mockRejectedValueOnce(new Error("ENOENT"));

    const resultado = await balcao.consultar.executar();

    expect(resultado.isErr() && resultado.error.codigo).toBe(
      "PASTA_DE_COPIAS_INACESSIVEL",
    );
    expect(resultado.isErr() && resultado.error.mensagem).toContain(
      "Confira se o disco está ligado",
    );
    expect(resultado.isErr() && resultado.error.detalhes).toEqual({ causa: "ENOENT" });
  });

  it("o que a pasta lançar sem ser Error também vira detalhe", async () => {
    vi.spyOn(balcao.pasta, "listar").mockRejectedValueOnce("sem permissão");

    const resultado = await balcao.consultar.executar();

    expect(resultado.isErr() && resultado.error.detalhes).toEqual({
      causa: "sem permissão",
    });
  });
});

describe("mudar a agenda", () => {
  function definir() {
    return new DefinirConfiguracaoDeBackup(
      balcao.ambiente.unitOfWork,
      balcao.ambiente.geradorId,
      balcao.ambiente.relogio,
    );
  }

  it("🔑 grava a agenda escolhida, mantém o ajuste do suporte e registra quem mudou", async () => {
    balcao.ambiente.backup.configuracaoAtual = {
      ...CONFIGURACAO_DE_BACKUP_PADRAO,
      copiasRecentes: 12,
    };

    const configuracao = (
      await definir().executar({
        usuarioId: ANA,
        intervaloHoras: 4,
        aoFecharCaixa: false,
      })
    ).unwrap();

    expect(configuracao).toEqual({
      intervaloHoras: 4,
      aoFecharCaixa: false,
      copiasRecentes: 12,
    });
    expect(balcao.ambiente.backup.configuracaoAtual).toEqual(configuracao);

    const [registro] = balcao.ambiente.auditoria.da("CONFIGURACAO_ALTERADA");
    expect(registro?.usuarioId?.equals(ANA)).toBe(true);
    expect(registro?.descricao).toBe(
      "Cópia de segurança alterada: de 4 em 4 horas, sem cópia ao fechar o caixa.",
    );
    expect(registro?.dados).toEqual({
      antes: "de hora em hora, e ao fechar o caixa",
      depois: "de 4 em 4 horas, sem cópia ao fechar o caixa",
    });
  });

  it("a primeira gravação cria a linha com um identificador da aplicação", async () => {
    await definir().executar({ usuarioId: ANA, intervaloHoras: 2, aoFecharCaixa: true });

    expect(balcao.ambiente.backup.idDaConfiguracao).toBeDefined();
  });

  it("gravar o que já valia não suja a auditoria", async () => {
    await definir().executar({ usuarioId: ANA, intervaloHoras: 1, aoFecharCaixa: true });

    expect(balcao.ambiente.auditoria.da("CONFIGURACAO_ALTERADA")).toHaveLength(0);
    expect(balcao.ambiente.backup.configuracaoAtual).toEqual(
      CONFIGURACAO_DE_BACKUP_PADRAO,
    );
  });

  it("🔑 só os intervalos da lista — nem zero, nem fração, nem mais de um dia", async () => {
    for (const intervaloHoras of [0, 3, 1.5, 48, -1]) {
      const resultado = await definir().executar({
        usuarioId: ANA,
        intervaloHoras,
        aoFecharCaixa: true,
      });

      expect(resultado.isErr() && resultado.error.codigo).toBe(
        "INTERVALO_DE_BACKUP_INVALIDO",
      );
    }
    expect(balcao.ambiente.backup.configuracaoAtual).toBeUndefined();
  });
});
