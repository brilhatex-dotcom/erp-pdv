import { describe, expect, it } from "vitest";

import {
  conteudoDoEnv,
  conteudoDoEnvDoAgente,
  type DadosDaInstalacao,
  gerarSegredos,
  lerSegredosDoEnv,
  PORTA_POSTGRES_PADRAO,
  PORTA_SERVIDOR_PADRAO,
  urlDoBanco,
} from "./configuracao.js";

/**
 * A configuração que a instalação gera.
 *
 * Nada aqui é digitado pelo lojista, e é essa a defesa: senha escolhida por
 * humano no servidor da loja produz `123456` em metade da base instalada — e um
 * segredo fraco ali é a chave de todas as sessões.
 */

function dados(sobrescritas: Partial<DadosDaInstalacao> = {}): DadosDaInstalacao {
  return {
    raiz: "C:\\Program Files\\ERP PDV",
    portaServidor: PORTA_SERVIDOR_PADRAO,
    portaPostgres: PORTA_POSTGRES_PADRAO,
    segredos: {
      senhaBanco: "senha-de-teste",
      segredoToken: "token-de-teste-com-mais-de-32-caracteres",
      segredoAgente: "agente-de-teste",
    },
    estacao: "BALCAO-01",
    ...sobrescritas,
  };
}

describe("segredos", () => {
  it("🔑 gera segredos diferentes a cada instalação", () => {
    // Segredo igual em toda a base instalada significa que quem comprar uma
    // licença consegue forjar sessão na loja do vizinho.
    const primeira = gerarSegredos();
    const segunda = gerarSegredos();

    expect(primeira.segredoToken).not.toBe(segunda.segredoToken);
    expect(primeira.senhaBanco).not.toBe(segunda.senhaBanco);
    expect(primeira.segredoAgente).not.toBe(segunda.segredoAgente);
  });

  it("🔑 o token tem tamanho suficiente para o servidor aceitar", () => {
    // O `ambiente.ts` exige 32 caracteres. Gerar menos faria o servidor recusar
    // subir logo depois de instalar, com uma mensagem que ninguém liga ao
    // instalador.
    const segredos = gerarSegredos();

    expect(segredos.segredoToken.length).toBeGreaterThanOrEqual(32);
  });

  it("🔑 a senha do banco não tem caractere que quebre a URL de conexão", () => {
    // Ela entra numa URL. `:` `@` `/` precisariam de escape em três lugares
    // diferentes, e é aí que o defeito mora — a conexão falha na instalação de
    // um cliente em cada vinte, sem padrão aparente.
    for (let i = 0; i < 50; i += 1) {
      expect(gerarSegredos().senhaBanco).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("usa o gerador que recebe, para o teste ser determinístico", () => {
    const segredos = gerarSegredos(() => Buffer.alloc(32, 7));

    expect(segredos.senhaBanco).toBe(segredos.segredoToken);
  });
});

describe("URL do banco", () => {
  it("aponta para o Postgres embarcado, na porta dedicada", () => {
    expect(urlDoBanco({ portaPostgres: 55433, senhaBanco: "abc" })).toBe(
      "postgresql://erp:abc@localhost:55433/erp_pdv?schema=public",
    );
  });

  it("🔑 a porta padrão fica longe da 5432", () => {
    // A máquina do cliente pode já ter um Postgres. Subir na 5432 conflitaria,
    // e o instalador falharia numa mensagem que ninguém entende.
    expect(PORTA_POSTGRES_PADRAO).not.toBe(5432);
  });
});

describe("arquivo de configuração do servidor", () => {
  it("declara tudo o que o servidor exige para subir", () => {
    const env = conteudoDoEnv(dados());

    expect(env).toContain("NODE_ENV=production");
    expect(env).toContain("PORTA=3000");
    expect(env).toContain(
      "DATABASE_URL=postgresql://erp:senha-de-teste@localhost:55433/",
    );
    expect(env).toContain("SEGREDO_TOKEN=token-de-teste");
  });

  it("🔑 escuta na rede, não só em si mesmo", () => {
    // As estações do balcão precisam alcançar o servidor. Com `127.0.0.1`, o
    // sistema funcionaria só na máquina onde foi instalado — e o defeito
    // apareceria na segunda estação, no dia da implantação.
    expect(conteudoDoEnv(dados())).toContain("ENDERECO=0.0.0.0");
  });

  it("🔑 permite a origem pelo nome da máquina e pelo localhost", () => {
    // O balcão acessa por um, a retaguarda pelo outro. Origem faltando aparece
    // como tela em branco, sem explicação nenhuma.
    const env = conteudoDoEnv(dados());

    expect(env).toContain("http://localhost:3000");
    expect(env).toContain("http://BALCAO-01:3000");
  });

  it("🔑 aponta as pastas das telas — sem isso a PWA não registra", () => {
    const env = conteudoDoEnv(dados());

    expect(env).toContain("PASTA_PDV=C:/Program Files/ERP PDV/telas/pdv");
    expect(env).toContain("PASTA_RETAGUARDA=C:/Program Files/ERP PDV/telas/retaguarda");
  });

  it("🔑 converte a barra invertida do Windows", () => {
    // Barra invertida num arquivo de configuração vira escape na primeira
    // biblioteca que interpretar `\n` — e o caminho aponta para lugar nenhum.
    expect(conteudoDoEnv(dados({ raiz: "C:\\ERP" }))).not.toContain("C:\\ERP");
  });

  it("termina com quebra de linha", () => {
    // Arquivo sem quebra final é o que faz a última linha sumir quando alguém
    // acrescenta outra pelo Bloco de Notas.
    expect(conteudoDoEnv(dados()).endsWith("\n")).toBe(true);
  });

  it("avisa que não é para editar à mão", () => {
    expect(conteudoDoEnv(dados())).toContain("suporte");
  });
});

describe("configuração do agente na estação", () => {
  it("aponta para o servidor da loja e leva o segredo", () => {
    const env = conteudoDoEnvDoAgente({
      servidor: "SERVIDOR-LOJA",
      portaServidor: 3000,
      segredoAgente: "abc123",
    });

    expect(env).toContain("ERP_SERVIDOR=http://SERVIDOR-LOJA:3000");
    expect(env).toContain("ERP_SEGREDO_AGENTE=abc123");
  });
});

describe("reinstalação por cima de uma loja em operação", () => {
  it("🔑 recupera os segredos do `.env` que já existe", () => {
    // Gerar segredos novos numa reinstalação deixaria a senha do `.env` sem
    // casar com a do cluster já criado: o sistema sobe, o banco não abre, e
    // todas as vendas ficam intactas e inalcançáveis. Nem o backup resolve —
    // ele tem o dado, não a chave.
    const gravado = conteudoDoEnv(dados());

    expect(lerSegredosDoEnv(gravado)).toEqual({
      senhaBanco: "senha-de-teste",
      segredoToken: "token-de-teste-com-mais-de-32-caracteres",
      segredoAgente: "agente-de-teste",
    });
  });

  it("sobrevive a segredo com base64url de verdade", () => {
    const segredos = gerarSegredos();

    expect(lerSegredosDoEnv(conteudoDoEnv(dados({ segredos })))).toEqual(segredos);
  });

  it("🔑 pede segredos novos quando o arquivo está truncado", () => {
    // Queda de energia no meio da escrita deixa um `.env` pela metade.
    // Preservar meio segredo é pior que gerar tudo de novo: produz uma
    // instalação que parece configurada e não abre nada.
    const truncado = "NODE_ENV=production\nDATABASE_URL=postgresql://erp:abc@localhost";

    expect(lerSegredosDoEnv(truncado)).toBeUndefined();
  });

  it("pede segredos novos quando não há `.env` nenhum", () => {
    expect(lerSegredosDoEnv("")).toBeUndefined();
  });

  it("grava o segredo do Agente, para não desemparelhar as estações", () => {
    // O servidor não lê este segredo, mas o instalador da estação lê. Se ele
    // sumisse do `.env`, a reinstalação geraria outro e o caixa pararia de
    // imprimir.
    expect(conteudoDoEnv(dados())).toContain("SEGREDO_AGENTE=agente-de-teste");
  });
});
