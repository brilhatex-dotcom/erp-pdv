import { ROTAS } from "@erp/agente-contrato";
import { describe, expect, it, vi } from "vitest";

import type { ContingenciaViva } from "./contingencia.js";
import type { ServicoImpressao } from "./hardware/servicoImpressao.js";
import { montarRoteador, type PedidoHttp } from "./servidor.js";

/**
 * A superfície HTTP do Agente.
 *
 * Dois riscos, e nenhum deles é funcional: um tratador que **lança** vira 500
 * sem mensagem no meio de uma venda offline, e um tratador que **confia** no
 * corpo recebido vira a porta de entrada do que vier do navegador.
 */

const POLITICA = {
  origensPermitidas: ["http://loja:3000"],
  segredo: "segredo-de-teste-1234",
};

function pedido(sobrescritas: Partial<PedidoHttp> = {}): PedidoHttp {
  return {
    metodo: "POST",
    caminho: ROTAS.estado,
    origem: "http://loja:3000",
    host: "127.0.0.1:9787",
    segredo: POLITICA.segredo,
    corpo: undefined,
    ...sobrescritas,
  };
}

function contingenciaFalsa(
  sobrescritas: Partial<ContingenciaViva> = {},
): ContingenciaViva {
  return {
    estado: vi.fn().mockReturnValue({ tipo: "CONECTADO", pendentes: 0 }),
    iniciar: vi.fn().mockReturnValue({ id: "v1", offline: true }),
    adicionarItem: vi.fn().mockReturnValue({ tipo: "OK", venda: { id: "v1" } }),
    registrarPagamento: vi.fn().mockReturnValue({ tipo: "OK", faltaPagar: "0" }),
    finalizar: vi.fn().mockReturnValue({ tipo: "OK", troco: "0" }),
    cancelar: vi.fn(),
    sincronizar: vi.fn().mockResolvedValue({
      enviadas: 0,
      recusadas: 0,
      interrompida: false,
    }),
    atualizarCatalogo: vi.fn(),
    iniciarRelogio: vi.fn(),
    ...sobrescritas,
  } as unknown as ContingenciaViva;
}

function impressaoFalsa(sobrescritas = {}): ServicoImpressao {
  return {
    imprimirCupom: vi.fn().mockResolvedValue({ tipo: "IMPRESSO" }),
    abrirGaveta: vi.fn().mockResolvedValue({ tipo: "IMPRESSO" }),
    ...sobrescritas,
  } as unknown as ServicoImpressao;
}

function montar(sobrescritas: Partial<Parameters<typeof montarRoteador>[0]> = {}) {
  const registrar = vi.fn();

  const responder = montarRoteador({
    contingencia: contingenciaFalsa(),
    impressao: impressaoFalsa(),
    politica: POLITICA,
    colunas: 48,
    registrar,
    ...sobrescritas,
  });

  return { responder, registrar };
}

describe("a porta é conferida antes de qualquer coisa", () => {
  it("🔑 site hostil recebe 403 e não chega à contingência", async () => {
    const estado = vi.fn();
    const { responder } = montar({ contingencia: contingenciaFalsa({ estado }) });

    const resposta = await responder(pedido({ origem: "https://hostil.exemplo" }));

    expect(resposta.status).toBe(403);
    expect(estado).not.toHaveBeenCalled();
  });

  it("🔑 a negativa não devolve cabeçalho de CORS", async () => {
    // Devolvê-lo diria ao site hostil que o Agente existe e qual é a forma dele.
    const { responder } = montar();

    const resposta = await responder(pedido({ segredo: "errado" }));

    expect(resposta.cabecalhos).toEqual({});
  });

  it("a negativa registra o motivo para o suporte", async () => {
    const { responder, registrar } = montar();

    await responder(pedido({ host: "mal.exemplo" }));

    expect(registrar).toHaveBeenCalledWith(expect.stringContaining("Host"));
  });

  it("a vistoria prévia do navegador passa sem segredo, se a origem é conhecida", async () => {
    // O `OPTIONS` existe justamente para perguntar antes de mandar o segredo.
    const { responder } = montar();

    const resposta = await responder(pedido({ metodo: "OPTIONS", segredo: undefined }));

    expect(resposta.status).toBe(204);
    expect(resposta.cabecalhos["access-control-allow-origin"]).toBe("http://loja:3000");
  });

  it("vistoria prévia de origem desconhecida é negada", async () => {
    const { responder } = montar();

    const resposta = await responder(
      pedido({ metodo: "OPTIONS", origem: "https://hostil.exemplo", segredo: undefined }),
    );

    expect(resposta.status).toBe(403);
  });
});

describe("as rotas fazem o que dizem", () => {
  it("saúde responde para a tela descobrir o Agente", async () => {
    const { responder } = montar();

    const resposta = await responder(pedido({ caminho: ROTAS.saude, metodo: "GET" }));

    expect(resposta.status).toBe(200);
    expect(resposta.corpo).toEqual({ estado: "ok" });
  });

  it("estado devolve a fila", async () => {
    const { responder } = montar();

    const resposta = await responder(pedido({ caminho: ROTAS.estado }));

    expect(resposta.corpo).toEqual({ tipo: "CONECTADO", pendentes: 0 });
  });

  it("venda offline vai do início ao fim", async () => {
    const { responder } = montar();

    await expect(
      responder(
        pedido({
          caminho: ROTAS.iniciarVenda,
          corpo: { estacaoId: "e1", operadorId: "o1" },
        }),
      ),
    ).resolves.toMatchObject({ status: 200 });

    await expect(
      responder(pedido({ caminho: ROTAS.item, corpo: { codigo: "789" } })),
    ).resolves.toMatchObject({ corpo: { tipo: "OK" } });

    await expect(
      responder(
        pedido({ caminho: ROTAS.pagamento, corpo: { forma: "DINHEIRO", valor: "100" } }),
      ),
    ).resolves.toMatchObject({ corpo: { tipo: "OK" } });

    await expect(
      responder(pedido({ caminho: ROTAS.finalizar, corpo: {} })),
    ).resolves.toMatchObject({ corpo: { tipo: "OK" } });
  });

  it("cancelar responde algo, e não vazio", async () => {
    const { responder } = montar();

    const resposta = await responder(pedido({ caminho: ROTAS.cancelar, corpo: {} }));

    expect(resposta.corpo).toEqual({ cancelada: true });
  });

  it("caminho desconhecido é 404, não 500", async () => {
    const { responder } = montar();

    const resposta = await responder(pedido({ caminho: "/o-que-e-isso" }));

    expect(resposta.status).toBe(404);
  });

  it("o cupom herda as colunas do papel configurado", async () => {
    const imprimirCupom = vi.fn().mockResolvedValue({ tipo: "IMPRESSO" });
    const { responder } = montar({
      impressao: impressaoFalsa({ imprimirCupom }),
      colunas: 32,
    });

    await responder(
      pedido({ caminho: ROTAS.imprimirCupom, corpo: { cupom: {}, houveDinheiro: true } }),
    );

    expect(imprimirCupom).toHaveBeenCalledWith(expect.objectContaining({ colunas: 32 }));
  });
});

describe("o roteador não confia no corpo", () => {
  it("venda sem estação é 400, e não exceção", async () => {
    const iniciar = vi.fn();
    const { responder } = montar({ contingencia: contingenciaFalsa({ iniciar }) });

    const resposta = await responder(pedido({ caminho: ROTAS.iniciarVenda, corpo: {} }));

    expect(resposta.status).toBe(400);
    expect(iniciar).not.toHaveBeenCalled();
  });

  it("código que não é texto vira desfecho nomeado", async () => {
    const { responder } = montar();

    const resposta = await responder(
      pedido({ caminho: ROTAS.item, corpo: { codigo: 123 } }),
    );

    expect(resposta.corpo).toEqual({ tipo: "ERRO", mensagem: "Código inválido." });
  });

  it("pagamento malformado vira desfecho nomeado", async () => {
    const { responder } = montar();

    const resposta = await responder(
      pedido({ caminho: ROTAS.pagamento, corpo: { forma: "DINHEIRO" } }),
    );

    expect(resposta.corpo).toEqual({ tipo: "ERRO", mensagem: "Pagamento inválido." });
  });

  it("cupom sem dados não derruba a impressão", async () => {
    const { responder } = montar();

    const resposta = await responder(
      pedido({ caminho: ROTAS.imprimirCupom, corpo: undefined }),
    );

    expect(resposta.corpo).toMatchObject({ tipo: "NAO_IMPRESSO" });
  });
});

describe("nada derruba o Agente", () => {
  it("🔑 contingência que lança vira 500 com mensagem, não processo morto", async () => {
    const { responder, registrar } = montar({
      contingencia: contingenciaFalsa({
        estado: vi.fn().mockImplementation(() => {
          throw new Error("disco cheio");
        }),
      }),
    });

    const resposta = await responder(pedido({ caminho: ROTAS.estado }));

    expect(resposta.status).toBe(500);
    expect(registrar).toHaveBeenCalledWith(expect.stringContaining("disco cheio"));
  });

  it("sincronização que rejeita também é contida", async () => {
    const { responder } = montar({
      contingencia: contingenciaFalsa({
        sincronizar: vi.fn().mockRejectedValue(new Error("rede caiu")),
      }),
    });

    const resposta = await responder(pedido({ caminho: ROTAS.sincronizar, corpo: {} }));

    expect(resposta.status).toBe(500);
  });
});

describe("caminhos que faltavam ser exercitados", () => {
  it("a gaveta abre pela rota dela", async () => {
    const abrirGaveta = vi.fn().mockResolvedValue({ tipo: "IMPRESSO" });
    const { responder } = montar({ impressao: impressaoFalsa({ abrirGaveta }) });

    const resposta = await responder(pedido({ caminho: ROTAS.abrirGaveta, corpo: {} }));

    expect(resposta.status).toBe(200);
    expect(abrirGaveta).toHaveBeenCalledOnce();
  });

  it("sincronizar devolve o resumo do que subiu", async () => {
    const { responder } = montar({
      contingencia: contingenciaFalsa({
        sincronizar: vi
          .fn()
          .mockResolvedValue({ enviadas: 3, recusadas: 1, interrompida: false }),
      }),
    });

    const resposta = await responder(pedido({ caminho: ROTAS.sincronizar, corpo: {} }));

    expect(resposta.corpo).toEqual({ enviadas: 3, recusadas: 1, interrompida: false });
  });

  it("pedido de programa local, sem Origin, não recebe cabeçalho de CORS", async () => {
    // Não veio de página: não há navegador para satisfazer.
    const { responder } = montar();

    const resposta = await responder(
      pedido({ caminho: ROTAS.saude, metodo: "GET", origem: undefined }),
    );

    expect(resposta.status).toBe(200);
    expect(resposta.cabecalhos).toEqual({});
  });

  it("o roteador funciona sem quem registrar", async () => {
    // O padrão existe para o Agente poder ser montado num teste sem log.
    const responder = montarRoteador({
      contingencia: contingenciaFalsa(),
      impressao: impressaoFalsa(),
      politica: POLITICA,
      colunas: 48,
    });

    await expect(responder(pedido({ segredo: "errado" }))).resolves.toMatchObject({
      status: 403,
    });
  });
});
