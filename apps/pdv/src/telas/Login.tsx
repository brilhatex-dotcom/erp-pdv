import { mensagemDe, useSessao } from "@erp/cliente-api";
import { Botao, CampoTexto } from "@erp/ui";
import { type ReactNode, type SyntheticEvent, useEffect, useRef, useState } from "react";

import type { TreinoNoFio } from "../api/tipos.js";
import { CodigosParaTreinar } from "../componentes/CodigosParaTreinar.js";
import { FaixaDoTreino } from "../componentes/FaixaDoTreino.js";
import { useModo } from "../modo.js";

/** O PIN do balcão tem seis dígitos (ADR-0011). */
const TAMANHO_PIN = 6;

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
 *
 * ### O treino entra por aqui
 *
 * Quando o servidor tem treino (ADR-0026), a entrada da loja oferece
 * "Treinar". No treino, a mesma tela mostra com quem entrar e o que digitar —
 * e entrar é digitar matrícula e PIN, como no caixa de verdade: o primeiro
 * gesto que se treina é o de todo dia.
 */
export function Login(): ReactNode {
  const { entrar } = useSessao();
  const { treinamento, entrarNoTreino, sairDoTreino, consultarTreino } = useModo();
  const [matricula, setMatricula] = useState("");
  const [pin, setPin] = useState("");
  const [erro, setErro] = useState<string | undefined>(undefined);
  const [enviando, setEnviando] = useState(false);
  const [treino, setTreino] = useState<TreinoNoFio | undefined>(undefined);
  const [semTreino, setSemTreino] = useState<string | undefined>(undefined);
  const campoMatricula = useRef<HTMLInputElement>(null);
  const campoPin = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let vivo = true;

    consultarTreino().then(
      (consultado) => {
        if (vivo) setTreino(consultado);
      },
      (causa: unknown) => {
        // Na loja, servidor sem treino é só não oferecer o botão. No treino, é
        // dizer por que não dá — e deixar voltar.
        if (vivo) setSemTreino(mensagemDe(causa));
      },
    );

    return (): void => {
      vivo = false;
    };
  }, [consultarTreino]);

  async function aoEnviar(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();

    // Tentativa que já se sabe inválida **não vai ao servidor**. O bloqueio
    // progressivo conta poucas tentativas por hora: gastar uma delas com um
    // campo pela metade travaria o operador no meio do movimento, por engano
    // dele mesmo e sem ter errado o PIN uma vez. Isto é conveniência — quem
    // decide continua sendo o servidor.
    if (matricula.trim() === "") {
      setErro("Informe a matrícula.");
      campoMatricula.current?.focus();
      return;
    }

    if (pin.length < TAMANHO_PIN) {
      setErro(`O PIN tem ${String(TAMANHO_PIN)} números.`);
      campoPin.current?.focus();
      return;
    }

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
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 py-6">
      {treinamento && <FaixaDoTreino />}

      <form
        onSubmit={(evento) => void aoEnviar(evento)}
        className="flex w-full max-w-sm flex-col gap-5 rounded-lg border border-borda bg-papel p-6 shadow-cartao"
        noValidate
      >
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-tinta">
            {treinamento ? "Treinamento" : "Caixa"}
          </h1>
          <p className="text-sm text-tinta-suave">
            {treinamento
              ? "Entre com uma das pessoas de treino, abaixo."
              : "Matrícula e PIN para começar."}
          </p>
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
          ref={campoPin}
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

        {treinamento ? (
          <Botao tom="secundario" onClick={sairDoTreino}>
            Voltar ao caixa de verdade
          </Botao>
        ) : (
          treino !== undefined && (
            <Botao tom="discreto" onClick={entrarNoTreino}>
              Treinar, sem valer de verdade
            </Botao>
          )
        )}
      </form>

      {treinamento && semTreino !== undefined && (
        <p
          role="alert"
          className="w-full max-w-sm rounded-md border border-erro bg-erro-suave px-3 py-2 text-sm text-tinta"
        >
          {semTreino}
        </p>
      )}

      {treinamento && treino !== undefined && <ComQuemTreinar treino={treino} />}
    </main>
  );
}

/** As pessoas de treino e os códigos para treinar sem leitor. */
function ComQuemTreinar(props: { readonly treino: TreinoNoFio }): ReactNode {
  return (
    <section
      aria-label="Pessoas de treino"
      className="flex w-full max-w-2xl flex-col gap-4 rounded-lg border border-borda bg-papel p-6 shadow-cartao"
    >
      <table className="w-full text-left text-sm">
        <caption className="pb-2 text-left font-semibold text-tinta">
          Com quem entrar
        </caption>
        <thead>
          <tr className="border-b border-borda text-tinta-suave">
            <th scope="col" className="py-1 pr-3 font-normal">
              Matrícula
            </th>
            <th scope="col" className="py-1 pr-3 font-normal">
              PIN
            </th>
            <th scope="col" className="py-1 font-normal">
              Quem é
            </th>
          </tr>
        </thead>
        <tbody>
          {props.treino.pessoas.map((pessoa) => (
            <tr key={pessoa.matricula} className="border-b border-borda">
              <td className="py-1 pr-3 font-numero text-lg">{pessoa.matricula}</td>
              <td className="py-1 pr-3 font-numero text-lg">{pessoa.pin}</td>
              <td className="py-1">
                <span className="text-tinta">{pessoa.nome}</span>
                <span className="block text-tinta-suave">{pessoa.oQueFaz}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <CodigosParaTreinar exemplos={props.treino.exemplos} />
    </section>
  );
}
