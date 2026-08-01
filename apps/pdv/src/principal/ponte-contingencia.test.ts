import { describe, expect, it, vi } from "vitest";

import { CANAIS, type Contingencia, registrarCanaisDeContingencia } from "./ponte-ipc.js";

/**
 * A ponte é a fronteira entre a tela e o sistema. Dois riscos, dois grupos de
 * teste: um tratador que **lança** vira exceção dentro da tela no meio de uma
 * venda offline, e um tratador que **confia** no que a tela mandou vira a porta
 * de entrada para o que vier da rede da loja.
 */

function ipcFalso(): {
  readonly ipc: { handle: (canal: string, tratador: Tratador) => void };
  readonly chamar: (canal: string, dados?: unknown) => Promise<unknown>;
} {
  const tratadores = new Map<string, Tratador>();

  return {
    ipc: {
      handle: (canal, tratador): void => {
        tratadores.set(canal, tratador);
      },
    },
    chamar: (canal, dados): Promise<unknown> => {
      const tratador = tratadores.get(canal);
      if (tratador === undefined) throw new Error(`canal ausente: ${canal}`);

      return Promise.resolve(tratador(undefined, dados));
    },
  };
}

type Tratador = (evento: unknown, ...argumentos: unknown[]) => unknown;

function contingenciaFalsa(sobrescritas: Partial<Contingencia> = {}): Contingencia {
  return {
    estado: vi.fn().mockReturnValue({ tipo: "CONECTADO", pendentes: 0 }),
    iniciar: vi.fn().mockReturnValue({
      id: "v1",
      offline: true,
      total: "0",
      faltaPagar: "0",
      itens: [],
    }),
    adicionarItem: vi.fn().mockReturnValue({ tipo: "OK", venda: { id: "v1" } }),
    registrarPagamento: vi.fn().mockReturnValue({ tipo: "OK", faltaPagar: "0" }),
    finalizar: vi.fn().mockReturnValue({ tipo: "OK", troco: "0" }),
    cancelar: vi.fn(),
    sincronizar: vi.fn().mockResolvedValue({
      enviadas: 0,
      recusadas: 0,
      interrompida: false,
    }),
    ...sobrescritas,
  };
}

describe("canais de contingência", () => {
  it("liga todos os canais declarados", async () => {
    const { ipc, chamar } = ipcFalso();
    registrarCanaisDeContingencia(ipc, contingenciaFalsa());

    await expect(chamar(CANAIS.estadoConexao)).resolves.toEqual({
      tipo: "CONECTADO",
      pendentes: 0,
    });
    await expect(chamar(CANAIS.cancelarVendaLocal)).resolves.toBeNull();
  });

  it("🔑 devolve null, e não undefined, no cancelamento", async () => {
    // `undefined` chega do outro lado da ponte como promessa resolvida sem
    // valor — indistinguível de canal que não existe.
    const { ipc, chamar } = ipcFalso();
    registrarCanaisDeContingencia(ipc, contingenciaFalsa());

    await expect(chamar(CANAIS.cancelarVendaLocal)).resolves.toBeNull();
  });
});

describe("a ponte não confia no que a tela manda", () => {
  it("🔑 pedido de venda sem estação não chega à contingência", async () => {
    const iniciar = vi.fn();
    const contingencia = contingenciaFalsa({ iniciar });
    const { ipc, chamar } = ipcFalso();
    registrarCanaisDeContingencia(ipc, contingencia);

    await expect(chamar(CANAIS.iniciarVendaLocal, {})).resolves.toBeUndefined();
    await expect(chamar(CANAIS.iniciarVendaLocal, undefined)).resolves.toBeUndefined();
    await expect(
      chamar(CANAIS.iniciarVendaLocal, { estacaoId: 7, operadorId: "x" }),
    ).resolves.toBeUndefined();

    expect(iniciar).not.toHaveBeenCalled();
  });

  it("código que não é texto vira erro, não exceção", async () => {
    const adicionarItem = vi.fn();
    const contingencia = contingenciaFalsa({ adicionarItem });
    const { ipc, chamar } = ipcFalso();
    registrarCanaisDeContingencia(ipc, contingencia);

    await expect(chamar(CANAIS.itemLocal, { codigo: 123 })).resolves.toEqual({
      tipo: "ERRO",
      mensagem: "Código inválido.",
    });
    expect(adicionarItem).not.toHaveBeenCalled();
  });

  it("pagamento malformado vira erro, não exceção", async () => {
    const registrarPagamento = vi.fn();
    const contingencia = contingenciaFalsa({ registrarPagamento });
    const { ipc, chamar } = ipcFalso();
    registrarCanaisDeContingencia(ipc, contingencia);

    await expect(chamar(CANAIS.pagamentoLocal, { forma: "DINHEIRO" })).resolves.toEqual({
      tipo: "ERRO",
      mensagem: "Pagamento inválido.",
    });
    expect(registrarPagamento).not.toHaveBeenCalled();
  });

  it("caminho feliz de cada canal chega à contingência", async () => {
    const contingencia = contingenciaFalsa();
    const { ipc, chamar } = ipcFalso();
    registrarCanaisDeContingencia(ipc, contingencia);

    await expect(
      chamar(CANAIS.iniciarVendaLocal, { estacaoId: "e1", operadorId: "o1" }),
    ).resolves.toMatchObject({ id: "v1" });
    await expect(chamar(CANAIS.itemLocal, { codigo: "789" })).resolves.toEqual({
      tipo: "OK",
      venda: { id: "v1" },
    });
    await expect(
      chamar(CANAIS.pagamentoLocal, { forma: "DINHEIRO", valor: "100" }),
    ).resolves.toEqual({ tipo: "OK", faltaPagar: "0" });
    await expect(chamar(CANAIS.finalizarVendaLocal)).resolves.toEqual({
      tipo: "OK",
      troco: "0",
    });
  });

  it("chamada sem dado nenhum não derruba os canais que esperam corpo", async () => {
    const { ipc, chamar } = ipcFalso();
    registrarCanaisDeContingencia(ipc, contingenciaFalsa());

    await expect(chamar(CANAIS.itemLocal, undefined)).resolves.toEqual({
      tipo: "ERRO",
      mensagem: "Código inválido.",
    });
    await expect(chamar(CANAIS.pagamentoLocal, undefined)).resolves.toEqual({
      tipo: "ERRO",
      mensagem: "Pagamento inválido.",
    });
  });

  it("valor que não é texto também é recusado", async () => {
    const { ipc, chamar } = ipcFalso();
    registrarCanaisDeContingencia(ipc, contingenciaFalsa());

    await expect(
      chamar(CANAIS.pagamentoLocal, { forma: "DINHEIRO", valor: 100 }),
    ).resolves.toEqual({ tipo: "ERRO", mensagem: "Pagamento inválido." });
  });

  it("registra o pedido malformado para o suporte enxergar", async () => {
    const registrar = vi.fn();
    const { ipc, chamar } = ipcFalso();
    registrarCanaisDeContingencia(ipc, contingenciaFalsa(), registrar);

    await chamar(CANAIS.iniciarVendaLocal, {});

    expect(registrar).toHaveBeenCalledWith(expect.stringContaining("sem estação"));
  });
});

describe("nenhum tratador derruba a tela", () => {
  it("🔑 falha na sincronização vira resumo interrompido", async () => {
    // Um `handle` que rejeita vira exceção dentro da tela — e a tela está no
    // meio de uma venda offline, sem para onde escalar o problema.
    const contingencia = contingenciaFalsa({
      sincronizar: vi.fn().mockRejectedValue(new Error("rede caiu")),
    });
    const registrar = vi.fn();
    const { ipc, chamar } = ipcFalso();
    registrarCanaisDeContingencia(ipc, contingencia, registrar);

    await expect(chamar(CANAIS.sincronizarAgora)).resolves.toEqual({
      enviadas: 0,
      recusadas: 0,
      interrompida: true,
    });
    expect(registrar).toHaveBeenCalledWith(expect.stringContaining("rede caiu"));
  });

  it("sincronização bem-sucedida devolve o resumo", async () => {
    const { ipc, chamar } = ipcFalso();
    registrarCanaisDeContingencia(
      ipc,
      contingenciaFalsa({
        sincronizar: vi
          .fn()
          .mockResolvedValue({ enviadas: 3, recusadas: 1, interrompida: false }),
      }),
    );

    await expect(chamar(CANAIS.sincronizarAgora)).resolves.toEqual({
      enviadas: 3,
      recusadas: 1,
      interrompida: false,
    });
  });
});
