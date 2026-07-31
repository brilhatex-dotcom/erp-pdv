import { mensagemDe, useSessao } from "@erp/cliente-api";
import { Botao, CampoTexto } from "@erp/ui";
import { type ReactNode, type SyntheticEvent, useRef, useState } from "react";

/**
 * Entrada no balcão — matrícula e PIN.
 *
 * A credencial aqui é **PIN numérico**, não senha longa (ADR-0011): a troca de
 * operador acontece com fila esperando, e senha de doze caracteres nesse
 * contexto tem uma consequência previsível — a equipe passa a compartilhar um
 * login, e a auditoria deixa de valer. O PIN é seguro no balcão porque o ataque
 * exige presença física, e o bloqueio progressivo cobre o resto.
 *
 * Os dois campos são numéricos e o foco começa na matrícula: dá para entrar sem
 * tirar a mão do teclado numérico, terminando em Enter.
 */
export function Login(): ReactNode {
  const { entrar } = useSessao();
  const [matricula, setMatricula] = useState("");
  const [pin, setPin] = useState("");
  const [erro, setErro] = useState<string | undefined>(undefined);
  const [enviando, setEnviando] = useState(false);
  const campoMatricula = useRef<HTMLInputElement>(null);

  async function aoEnviar(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    setErro(undefined);
    setEnviando(true);

    try {
      await entrar(matricula, pin);
    } catch (causa) {
      setErro(mensagemDe(causa));
      // O PIN some, a matrícula fica: quem errou o PIN redigita só ele.
      setPin("");
      campoMatricula.current?.focus();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={(evento) => void aoEnviar(evento)}
        className="flex w-full max-w-sm flex-col gap-5 rounded-lg border border-borda bg-papel p-6 shadow-cartao"
        noValidate
      >
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-tinta">Caixa</h1>
          <p className="text-sm text-tinta-suave">Matrícula e PIN para começar.</p>
        </header>

        {erro !== undefined && (
          <p
            role="alert"
            className="rounded-md border border-erro bg-erro-suave px-3 py-2 text-sm text-tinta"
          >
            {erro}
          </p>
        )}

        <CampoTexto
          ref={campoMatricula}
          rotulo="Matrícula"
          numerico
          required
          autoFocus
          value={matricula}
          onChange={(evento) => {
            setMatricula(evento.target.value);
          }}
        />

        <CampoTexto
          rotulo="PIN"
          type="password"
          numerico
          required
          autoComplete="off"
          value={pin}
          onChange={(evento) => {
            setPin(evento.target.value);
          }}
        />

        <Botao
          type="submit"
          tamanho="grande"
          ocupado={enviando}
          rotuloOcupado="Entrando…"
        >
          Entrar
        </Botao>
      </form>
    </main>
  );
}
