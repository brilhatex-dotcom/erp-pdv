import { mensagemDe, useSessao } from "@erp/cliente-api";
import { Botao } from "@erp/ui";
import { type ReactNode, useId, useState } from "react";

/**
 * Escolher uma foto do computador e mandá-la ao servidor.
 *
 * A foto vai em base64 dentro de um JSON, e quem decide se é imagem é o
 * servidor, pelos bytes — a extensão do arquivo não prova nada. O tamanho é
 * conferido **aqui, antes de enviar**: foto de celular passa fácil do limite,
 * e esperar o envio inteiro para ouvir "grande demais" é o tipo de espera que
 * faz o usuário achar que o sistema travou.
 *
 * O que a tela guarda é só o identificador. A foto antiga continua no
 * servidor — o conteúdo de um identificador nunca muda, e é isso que deixa o
 * caixa guardá-la em cache para sempre.
 */

/** O servidor aceita até 800 KB em base64, o que dá uns 600 KB de arquivo. */
const LIMITE_BYTES = 600 * 1024;

export function EnviarImagem(props: {
  readonly rotulo: string;
  readonly imagemId: string | undefined;
  readonly aoMudar: (imagemId: string | undefined) => void;
  readonly desabilitado?: boolean;
}): ReactNode {
  const { cliente: api } = useSessao();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | undefined>(undefined);
  const id = useId();
  const desabilitado = props.desabilitado === true || enviando;

  async function enviar(arquivo: File): Promise<void> {
    if (arquivo.size > LIMITE_BYTES) {
      setErro("A foto passa de 600 KB. Use uma foto menor, ou recorte a que tem.");
      return;
    }

    setEnviando(true);
    setErro(undefined);

    try {
      const conteudo = await paraBase64(arquivo);

      if (conteudo === undefined) {
        setErro("Não foi possível ler a foto. Tente outra.");
        return;
      }

      const enviada = await api.requisitar<{ readonly id: string }>("/api/imagens", {
        metodo: "POST",
        corpo: { conteudo },
      });
      props.aoMudar(enviada.id);
    } catch (causa) {
      setErro(mensagemDe(causa));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div role="group" aria-labelledby={`${id}-rotulo`} className="flex flex-col gap-2">
      <span id={`${id}-rotulo`} className="text-sm font-medium text-tinta">
        {props.rotulo}
      </span>

      <div className="flex flex-wrap items-center gap-3">
        {props.imagemId === undefined ? (
          <span className="flex size-16 items-center justify-center rounded-md border border-dashed border-borda text-xs text-tinta-suave">
            Sem foto
          </span>
        ) : (
          <img
            src={`/api/imagens/${props.imagemId}`}
            alt={`${props.rotulo} atual`}
            className="size-16 rounded-md border border-borda object-cover"
          />
        )}

        <label
          className={`inline-flex min-h-alvo cursor-pointer items-center rounded-md border border-borda bg-papel px-4 text-tinta hover:bg-papel-fundo ${
            desabilitado ? "cursor-not-allowed opacity-55" : ""
          }`}
        >
          {enviando
            ? "Enviando…"
            : props.imagemId === undefined
              ? "Escolher foto"
              : "Trocar foto"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            disabled={desabilitado}
            onChange={(evento) => {
              const arquivo = evento.target.files?.[0];
              // Limpar o campo deixa escolher a mesma foto de novo depois de um erro.
              evento.target.value = "";
              if (arquivo !== undefined) void enviar(arquivo);
            }}
          />
        </label>

        {props.imagemId !== undefined && (
          <Botao
            tom="discreto"
            disabled={desabilitado}
            onClick={() => {
              props.aoMudar(undefined);
            }}
          >
            Tirar foto
          </Botao>
        )}
      </div>

      {erro !== undefined && (
        <p role="alert" className="text-sm text-erro">
          {erro}
        </p>
      )}
    </div>
  );
}

/**
 * O conteúdo do arquivo em base64, sem o prefixo `data:…;base64,`.
 *
 * `undefined` quando o arquivo não pôde ser lido — o pendrive que saiu no meio,
 * o arquivo que sumiu da pasta.
 */
function paraBase64(arquivo: File): Promise<string | undefined> {
  return new Promise((resolver) => {
    const leitor = new FileReader();
    leitor.onload = (): void => {
      // `readAsDataURL` sempre entrega texto.
      const texto = leitor.result as string;
      resolver(texto.slice(texto.indexOf(",") + 1));
    };
    leitor.onerror = (): void => {
      resolver(undefined);
    };
    leitor.readAsDataURL(arquivo);
  });
}
