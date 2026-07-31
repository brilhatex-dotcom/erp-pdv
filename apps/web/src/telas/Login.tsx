import { Botao, CampoTexto } from "@erp/ui";
import { type SyntheticEvent, type ReactNode, useRef, useState } from "react";

import { mensagemDe } from "../api/cliente.js";
import { useSessao } from "../sessao/ContextoSessao.js";

/**
 * Tela de entrada da retaguarda.
 *
 * Aqui a credencial é **senha longa**, não PIN: a retaguarda expõe dados
 * financeiros e fiscais, e o ataque não exige presença física na loja
 * (ARQUITETURA.md §8.1). O PIN de seis dígitos é do balcão, onde o contexto de
 * ameaça é outro.
 *
 * O formulário é `<form>` de verdade, com `type="submit"`: Enter no campo de
 * senha entra, que é como todo mundo espera e como o gerenciador de senhas do
 * navegador reconhece a tela.
 */
export function Login(): ReactNode {
  const { entrar } = useSessao();
  const [matricula, setMatricula] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | undefined>(undefined);
  const [enviando, setEnviando] = useState(false);
  const campoMatricula = useRef<HTMLInputElement>(null);

  async function aoEnviar(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    setErro(undefined);
    setEnviando(true);

    try {
      await entrar(matricula, senha);
    } catch (causa) {
      setErro(mensagemDe(causa));
      // A senha some, a matrícula fica: quem errou a senha vai redigitar só
      // ela, e quem errou a matrícula a corrige sem apagar tudo.
      setSenha("");
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
        // `noValidate`: as mensagens nativas do navegador são genéricas e não
        // seguem o idioma da loja. As nossas vêm do domínio.
        noValidate
      >
        <header className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-tinta">Retaguarda</h1>
          <p className="text-sm text-tinta-suave">Entre com sua matrícula e senha.</p>
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
          rotulo="Senha"
          type="password"
          required
          autoComplete="current-password"
          value={senha}
          onChange={(evento) => {
            setSenha(evento.target.value);
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
