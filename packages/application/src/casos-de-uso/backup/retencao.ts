import type { CopiaGuardada } from "./portas.js";

/**
 * Quantas cópias guardar — avô, pai e filho (GFS).
 *
 * As 24 últimas horas, os 7 últimos dias, as 4 últimas semanas e os 12 últimos
 * meses: perto de 47 arquivos, e a loja volta tanto ao "agora há pouco" quanto
 * ao "como estava no mês passado" (ARQUITETURA.md §10.3). Sem retenção, a cópia
 * de hora em hora enche o disco do servidor em poucos meses — e disco cheio
 * para o banco, que para o caixa.
 */
export interface PoliticaDeRetencao {
  readonly horarias: number;
  readonly diarias: number;
  readonly semanais: number;
  readonly mensais: number;
}

export const RETENCAO_PADRAO: PoliticaDeRetencao = {
  horarias: 24,
  diarias: 7,
  semanais: 4,
  mensais: 12,
};

/**
 * Por quanto tempo a cópia feita antes de uma restauração fica, de qualquer
 * jeito.
 *
 * Ela é o único caminho de volta de uma restauração errada — e a retenção
 * comum a apagaria na primeira cópia feita na mesma hora, que é exatamente o
 * que alguém faz logo depois de restaurar. Uma semana cobre o "só percebemos
 * na segunda-feira".
 */
const PROTECAO_DE_ANTES_DE_RESTAURAR_MS = 7 * 24 * 3_600_000;

/**
 * Os nomes das cópias que saem.
 *
 * Em cada escala fica a cópia mais nova de cada uma das últimas janelas que
 * tiveram cópia — a hora sem cópia não gasta lugar. Só a cópia **provada**
 * guarda lugar: uma que não restaurou não pode empurrar para fora a boa da
 * mesma hora. A que falhou sobrevive só enquanto é a mais nova de todas, para
 * a tela mostrar que a última tentativa deu errado. A de antes de uma
 * restauração fica uma semana, contada da cópia mais nova.
 *
 * As janelas são em UTC: perto da meia-noite, o "dia" da cópia pode ser o
 * seguinte no relógio da loja — o que muda qual cópia representa o dia, não
 * quantas ficam.
 */
export function copiasParaApagar(
  copias: readonly CopiaGuardada[],
  politica: PoliticaDeRetencao = RETENCAO_PADRAO,
): readonly string[] {
  const ordenadas = [...copias].sort(
    (a, b) => b.criadaEm.getTime() - a.criadaEm.getTime(),
  );
  const provadas = ordenadas.filter((copia) => copia.prova.restaurou);
  const ficam = new Set<string>();

  const escalas: readonly (readonly [number, (data: Date) => string])[] = [
    [politica.horarias, (data) => data.toISOString().slice(0, 13)],
    [politica.diarias, (data) => data.toISOString().slice(0, 10)],
    [politica.semanais, semanaIso],
    [politica.mensais, (data) => data.toISOString().slice(0, 7)],
  ];

  for (const [quantas, janelaDe] of escalas) {
    const vistas = new Set<string>();

    for (const copia of provadas) {
      const janela = janelaDe(copia.criadaEm);
      if (vistas.has(janela)) continue;
      if (vistas.size === quantas) break;

      vistas.add(janela);
      ficam.add(copia.nome);
    }
  }

  const maisNovaProvada = provadas[0]?.criadaEm.getTime() ?? Number.NEGATIVE_INFINITY;
  const protegidaDesde =
    (ordenadas[0]?.criadaEm.getTime() ?? 0) - PROTECAO_DE_ANTES_DE_RESTAURAR_MS;

  return ordenadas
    .filter((copia) => !ficam.has(copia.nome))
    .filter(
      (copia) =>
        copia.origem !== "ANTES_DE_RESTAURAR" ||
        copia.criadaEm.getTime() < protegidaDesde,
    )
    .filter(
      (copia) => copia.prova.restaurou || copia.criadaEm.getTime() < maisNovaProvada,
    )
    .map((copia) => copia.nome);
}

/** `"2026-W42"` — a semana ISO, que começa na segunda-feira. */
export function semanaIso(data: Date): string {
  const dia = new Date(
    Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate()),
  );
  // Domingo é o sétimo dia da semana ISO, e não o primeiro.
  const diaDaSemana = dia.getUTCDay() === 0 ? 7 : dia.getUTCDay();
  // A quinta-feira decide a que ano a semana pertence.
  dia.setUTCDate(dia.getUTCDate() + 4 - diaDaSemana);

  const inicioDoAno = Date.UTC(dia.getUTCFullYear(), 0, 1);
  const semana = Math.ceil(((dia.getTime() - inicioDoAno) / 86_400_000 + 1) / 7);

  return `${String(dia.getUTCFullYear())}-W${String(semana).padStart(2, "0")}`;
}
