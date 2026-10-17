import { Botao, CampoTexto, formatarDinheiro } from "@erp/ui";
import { type ReactNode, useState } from "react";

import { CampoDinheiro } from "./CampoDinheiro.js";
import { Modal } from "./Modal.js";

/**
 * Sangria (dinheiro saindo da gaveta) e suprimento (dinheiro entrando).
 *
 * Os dois existem para a conferência fechar: a retirada para o cofre que não
 * foi registrada aparece no fim do dia como falta do operador — e é a falta
 * mais injusta que existe, porque o dinheiro está no cofre.
 *
 * ### Quem faz a sangria
 *
 * O operador de caixa não sangra a gaveta, nem com o supervisor ao lado: quem
 * tira dinheiro é quem responde por ele, com a própria matrícula. A janela diz
 * isso em vez de mostrar um formulário que o servidor vai recusar.
 */

export type TipoMovimento = "sangria" | "suprimento";

const TEXTOS: Record<
  TipoMovimento,
  {
    readonly titulo: string;
    readonly confirmar: string;
    readonly motivos: readonly string[];
  }
> = {
  sangria: {
    titulo: "Sangria — tirar dinheiro da gaveta",
    confirmar: "Registrar sangria",
    motivos: [
      "Retirada para o cofre",
      "Pagamento de fornecedor",
      "Excesso de dinheiro na gaveta",
    ],
  },
  suprimento: {
    titulo: "Suprimento — pôr dinheiro na gaveta",
    confirmar: "Registrar suprimento",
    motivos: ["Reforço de troco", "Troco trazido do cofre"],
  },
};

export function ModalMovimento(props: {
  readonly tipo: TipoMovimento;
  /** Sem a permissão, a janela explica quem faz — e não mostra o formulário. */
  readonly permitido: boolean;
  readonly ocupado: boolean;
  readonly aoConfirmar: (movimento: {
    readonly valor: string;
    readonly motivo: string;
  }) => void;
  readonly aoFechar: () => void;
}): ReactNode {
  const textos = TEXTOS[props.tipo];
  const [valor, setValor] = useState("0");
  const [motivo, setMotivo] = useState("");
  const [erroValor, setErroValor] = useState<string | undefined>(undefined);
  const [erroMotivo, setErroMotivo] = useState<string | undefined>(undefined);

  if (!props.permitido) {
    return (
      <Modal titulo={textos.titulo} aoFechar={props.aoFechar}>
        <p className="text-tinta">
          A sangria é feita pelo supervisor ou pelo gerente, com a matrícula e o PIN dele:
          quem tira o dinheiro da gaveta é quem responde por ele.
        </p>
        <p className="text-sm text-tinta-suave">
          Peça para ele entrar neste caixa: menu Caixa → Trocar operador.
        </p>
        <div>
          <Botao tom="secundario" onClick={props.aoFechar}>
            Entendi (Esc)
          </Botao>
        </div>
      </Modal>
    );
  }

  function confirmar(): void {
    const semValor = valor === "0";
    const semMotivo = motivo.trim().length < 3;

    setErroValor(semValor ? "Digite o valor." : undefined);
    setErroMotivo(
      semMotivo ? "Escreva o motivo, ou toque num dos motivos prontos." : undefined,
    );

    if (semValor || semMotivo) return;

    props.aoConfirmar({ valor, motivo: motivo.trim() });
  }

  return (
    <Modal titulo={textos.titulo} aoFechar={props.aoFechar}>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(evento) => {
          evento.preventDefault();
          confirmar();
        }}
      >
        <CampoDinheiro
          rotulo="Valor"
          valor={valor}
          autoFocus
          grande
          aoMudar={(centavos) => {
            setErroValor(undefined);
            setValor(centavos);
          }}
          {...(erroValor === undefined ? {} : { erro: erroValor })}
        />

        <div role="group" aria-label="Motivos prontos" className="flex flex-wrap gap-2">
          {textos.motivos.map((texto) => (
            <Botao
              key={texto}
              tom={motivo === texto ? "primario" : "secundario"}
              aria-pressed={motivo === texto}
              onClick={() => {
                setErroMotivo(undefined);
                setMotivo(texto);
              }}
            >
              {texto}
            </Botao>
          ))}
        </div>

        <CampoTexto
          rotulo="Motivo"
          autoComplete="off"
          maxLength={120}
          value={motivo}
          {...(erroMotivo === undefined ? {} : { erro: erroMotivo })}
          onChange={(evento) => {
            setErroMotivo(undefined);
            setMotivo(evento.target.value);
          }}
        />

        <div className="flex gap-3">
          <Botao
            type="submit"
            tamanho="grande"
            ocupado={props.ocupado}
            rotuloOcupado="Registrando…"
          >
            {textos.confirmar}
            {valor === "0" ? "" : ` de ${formatarDinheiro(valor)}`}
          </Botao>
          <Botao tom="discreto" tamanho="grande" onClick={props.aoFechar}>
            Voltar (Esc)
          </Botao>
        </div>
      </form>
    </Modal>
  );
}
