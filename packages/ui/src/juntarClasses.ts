/**
 * Junta classes CSS, descartando o que é falso.
 *
 * Função de três linhas em vez de dependência: `clsx` resolveria o mesmo, e
 * toda dependência nova precisa ser justificada frente aos nove papéis
 * (CLAUDE.md §9). Esta não se justifica.
 */
export function juntarClasses(
  ...partes: readonly (string | false | null | undefined)[]
): string {
  return partes.filter((parte) => typeof parte === "string" && parte !== "").join(" ");
}
