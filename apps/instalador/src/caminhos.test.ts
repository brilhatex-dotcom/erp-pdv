import { describe, expect, it } from "vitest";

import { caminhosDeDados, PASTA_DE_DADOS_PADRAO } from "./caminhos.js";

/**
 * Onde os dados moram.
 *
 * O defeito que motivou este módulo apareceu numa instalação de verdade: o
 * `initbd` cria um token restrito ao rodar como administrador, e `Program
 * Files` só concede escrita a Administradores — o grupo que o token acabou de
 * perder. O cluster precisa nascer fora dali.
 */

describe("raiz dos dados", () => {
  it("🔑 fica fora de `Program Files`", () => {
    // É a regra inteira. Se um dia alguém apontar isto de volta para a pasta do
    // programa, o `initdb` volta a falhar em toda instalação — depois de já ter
    // copiado 450 MB na máquina do cliente.
    expect(PASTA_DE_DADOS_PADRAO).not.toMatch(/Program Files/i);
  });

  it("usa `ProgramData`, que é o lugar do Windows para dado de serviço", () => {
    expect(PASTA_DE_DADOS_PADRAO).toBe("C:\\ProgramData\\ERP PDV");
  });
});

describe("caminhos derivados", () => {
  it("põe cluster, log e backup sob a mesma raiz", () => {
    const caminhos = caminhosDeDados("C:\\ProgramData\\ERP PDV");

    expect(caminhos).toEqual({
      cluster: "C:\\ProgramData\\ERP PDV\\dados",
      log: "C:\\ProgramData\\ERP PDV\\log",
      backup: "C:\\ProgramData\\ERP PDV\\backup",
      senhaInicial: "C:\\ProgramData\\ERP PDV\\senha-inicial.txt",
    });
  });

  it("🔑 a senha inicial não fica dentro do cluster", () => {
    // O `initdb` exige que a pasta do cluster esteja vazia. Um arquivo nosso lá
    // dentro faria o próprio passo que ele precisa executar falhar.
    const caminhos = caminhosDeDados("C:\\ProgramData\\ERP PDV");

    expect(caminhos.senhaInicial.startsWith(caminhos.cluster)).toBe(false);
  });

  it("tolera barra sobrando no fim, venha de onde vier", () => {
    expect(caminhosDeDados("D:\\dados\\ERP\\").cluster).toBe("D:\\dados\\ERP\\dados");
    expect(caminhosDeDados("D:\\dados\\ERP").cluster).toBe("D:\\dados\\ERP\\dados");
  });

  it("aceita raiz escolhida pelo técnico, não só a padrão", () => {
    // Máquina com C: pequeno e D: grande é caso real neste público.
    expect(caminhosDeDados("D:\\ERP PDV").log).toBe("D:\\ERP PDV\\log");
  });
});
