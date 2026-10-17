import type {
  ArquivoGerado,
  CopiaGuardada,
  OrigemDaCopia,
  PastaDeCopias,
  ProvaDaCopia,
} from "@erp/application";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

/**
 * As cópias guardadas numa pasta do disco do servidor.
 *
 * Cada cópia é um par: o arquivo do `pg_dump` e uma ficha JSON ao lado, com o
 * que a conferência viu nele. A ficha é o que a tela lista; sem ela, o arquivo
 * é ignorado — um `.dump` jogado na pasta à mão não vira "cópia conferida" sem
 * ter passado pela conferência.
 *
 * O nome do arquivo segue um formato estrito, e todo nome que chega de fora é
 * conferido contra ele: o nome vem da tela, e `../../` num nome é como se tira
 * da pasta das cópias um arquivo que não é cópia.
 */

const SUFIXO_DA_ORIGEM: Readonly<Record<OrigemDaCopia, string>> = {
  AUTOMATICA: "automatica",
  MANUAL: "manual",
  FECHAMENTO_DE_CAIXA: "fechamento",
  ANTES_DE_RESTAURAR: "antes-de-restaurar",
};

/** `copia-20261017-140000-automatica.dump`, com `-2` quando o segundo repete. */
const NOME_VALIDO =
  /^copia-\d{8}-\d{6}(-\d{1,3})?-(automatica|manual|fechamento|antes-de-restaurar)\.dump$/;

const EXTENSAO = ".dump";
const EXTENSAO_DA_FICHA = ".json";

const ESQUEMA_DO_RESUMO = z.object({
  vendas: z.number().int().nonnegative(),
  produtos: z.number().int().nonnegative(),
  clientes: z.number().int().nonnegative(),
  primeiraVenda: z.iso.datetime().optional(),
  ultimaVenda: z.iso.datetime().optional(),
  // Ausente nas fichas das primeiras cópias: vale zero, que é o que importa
  // numa cópia — o aviso de caixa aberto é do banco de agora.
  caixasAbertos: z.number().int().nonnegative().default(0),
  migracoes: z.array(z.string()),
});

const ESQUEMA_DA_FICHA = z.object({
  versao: z.literal(1),
  criadaEm: z.iso.datetime(),
  origem: z.enum(["AUTOMATICA", "MANUAL", "FECHAMENTO_DE_CAIXA", "ANTES_DE_RESTAURAR"]),
  tamanhoBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  prova: z.discriminatedUnion("restaurou", [
    z.object({ restaurou: z.literal(true), resumo: ESQUEMA_DO_RESUMO }),
    z.object({ restaurou: z.literal(false), motivo: z.string() }),
  ]),
});

type Ficha = z.infer<typeof ESQUEMA_DA_FICHA>;

export class PastaDeCopiasNoDisco implements PastaDeCopias {
  constructor(private readonly pasta: string) {}

  async listar(): Promise<readonly CopiaGuardada[]> {
    // A pasta ainda não existe antes da primeira cópia: lista vazia, e não
    // erro. Qualquer outro problema (permissão, disco desligado) sobe.
    if (!(await existe(this.pasta))) return [];

    const copias: CopiaGuardada[] = [];

    for (const nome of (await readdir(this.pasta)).filter((candidato) =>
      NOME_VALIDO.test(candidato),
    )) {
      const copia = await this.#ler(nome);
      if (copia !== undefined) copias.push(copia);
    }

    return copias;
  }

  async guardar(
    gerado: ArquivoGerado,
    dados: {
      readonly origem: OrigemDaCopia;
      readonly criadaEm: Date;
      readonly prova: ProvaDaCopia;
    },
  ): Promise<CopiaGuardada> {
    await mkdir(this.pasta, { recursive: true });

    const nome = await this.#nomeLivre(dados.criadaEm, dados.origem);
    const copia: CopiaGuardada = {
      nome,
      criadaEm: dados.criadaEm,
      origem: dados.origem,
      tamanhoBytes: gerado.tamanhoBytes,
      sha256: gerado.sha256,
      prova: dados.prova,
    };

    await rename(gerado.caminho, join(this.pasta, nome));

    // A ficha nasce com outro nome e é renomeada no fim: a tela nunca lê uma
    // ficha escrita pela metade.
    const ficha = join(this.pasta, fichaDe(nome));
    await writeFile(`${ficha}.parcial`, JSON.stringify(paraFicha(copia), null, 2));
    await rename(`${ficha}.parcial`, ficha);

    return copia;
  }

  async caminhoDe(nome: string): Promise<string | undefined> {
    if (!NOME_VALIDO.test(nome)) return undefined;

    const caminho = join(this.pasta, nome);

    return (await existe(caminho)) && (await existe(join(this.pasta, fichaDe(nome))))
      ? caminho
      : undefined;
  }

  async apagar(nome: string): Promise<void> {
    if (!NOME_VALIDO.test(nome)) return;

    // A ficha sai primeiro: sem ela, o arquivo que sobrar já não aparece na
    // lista como cópia boa.
    for (const arquivo of [fichaDe(nome), nome]) {
      try {
        await rm(join(this.pasta, arquivo), { force: true });
      } catch {
        // O antivírus segurando o arquivo: ele sai na próxima retenção.
      }
    }
  }

  /** A cópia, ou `undefined` quando a ficha falta, não confere, ou o arquivo sumiu. */
  async #ler(nome: string): Promise<CopiaGuardada | undefined> {
    let ficha: Ficha;
    let tamanho: number;

    try {
      const lida = ESQUEMA_DA_FICHA.safeParse(
        JSON.parse(await readFile(join(this.pasta, fichaDe(nome)), "utf8")),
      );
      if (!lida.success) return undefined;

      ficha = lida.data;
      tamanho = (await stat(join(this.pasta, nome))).size;
    } catch {
      return undefined;
    }

    const copia = deFicha(nome, ficha);

    // O tamanho confere em toda listagem, porque custa nada. Um arquivo que
    // mudou depois de provado não é mais o que foi provado.
    return tamanho === ficha.tamanhoBytes
      ? copia
      : {
          ...copia,
          prova: {
            restaurou: false,
            motivo: `o arquivo mudou de tamanho depois de conferido (era ${String(ficha.tamanhoBytes)} bytes, está com ${String(tamanho)})`,
          },
        };
  }

  async #nomeLivre(criadaEm: Date, origem: OrigemDaCopia): Promise<string> {
    const base = `copia-${carimbo(criadaEm)}`;
    const sufixo = SUFIXO_DA_ORIGEM[origem];

    for (let vez = 1; ; vez += 1) {
      const nome =
        vez === 1
          ? `${base}-${sufixo}${EXTENSAO}`
          : `${base}-${String(vez)}-${sufixo}${EXTENSAO}`;

      if (!(await existe(join(this.pasta, nome)))) return nome;
    }
  }
}

function fichaDe(nome: string): string {
  return `${nome.slice(0, -EXTENSAO.length)}${EXTENSAO_DA_FICHA}`;
}

/**
 * `20261017-140000`, no relógio do servidor — o da loja: é o nome que o dono
 * reconhece ao abrir a pasta para levar uma cópia no pendrive.
 */
function carimbo(instante: Date): string {
  const dois = (numero: number) => String(numero).padStart(2, "0");

  return (
    `${String(instante.getFullYear())}${dois(instante.getMonth() + 1)}${dois(instante.getDate())}` +
    `-${dois(instante.getHours())}${dois(instante.getMinutes())}${dois(instante.getSeconds())}`
  );
}

function paraFicha(copia: CopiaGuardada): Ficha {
  return {
    versao: 1,
    criadaEm: copia.criadaEm.toISOString(),
    origem: copia.origem,
    tamanhoBytes: copia.tamanhoBytes,
    sha256: copia.sha256,
    prova: copia.prova.restaurou
      ? {
          restaurou: true,
          resumo: {
            vendas: copia.prova.resumo.vendas,
            produtos: copia.prova.resumo.produtos,
            clientes: copia.prova.resumo.clientes,
            primeiraVenda: copia.prova.resumo.primeiraVenda?.toISOString(),
            ultimaVenda: copia.prova.resumo.ultimaVenda?.toISOString(),
            caixasAbertos: copia.prova.resumo.caixasAbertos,
            migracoes: [...copia.prova.resumo.migracoes],
          },
        }
      : copia.prova,
  };
}

function deFicha(nome: string, ficha: Ficha): CopiaGuardada {
  return {
    nome,
    criadaEm: new Date(ficha.criadaEm),
    origem: ficha.origem,
    tamanhoBytes: ficha.tamanhoBytes,
    sha256: ficha.sha256,
    prova: ficha.prova.restaurou
      ? {
          restaurou: true,
          resumo: {
            ...ficha.prova.resumo,
            primeiraVenda: dataOpcional(ficha.prova.resumo.primeiraVenda),
            ultimaVenda: dataOpcional(ficha.prova.resumo.ultimaVenda),
          },
        }
      : ficha.prova,
  };
}

function dataOpcional(texto: string | undefined): Date | undefined {
  return texto === undefined ? undefined : new Date(texto);
}

async function existe(caminho: string): Promise<boolean> {
  try {
    await stat(caminho);
    return true;
  } catch {
    return false;
  }
}
