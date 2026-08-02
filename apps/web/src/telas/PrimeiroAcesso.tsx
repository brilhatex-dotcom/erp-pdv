import { mensagemDe, useSessao } from "@erp/cliente-api";
import { Botao, CampoTexto } from "@erp/ui";
import { type ReactNode, type SyntheticEvent, useState } from "react";

const MINIMO_SENHA = 12;

/** Seis dígitos exatos, como a tela do balcão espera (ADR-0011). */
const DIGITOS_PIN = 6;

/**
 * Configuração da instalação — cria o primeiro administrador.
 *
 * Aparece **uma vez na vida** de cada instalação, e some para sempre depois.
 * Quem a vê é o instalador, não o lojista: alguém no meio de instalar, com a
 * caixa do computador ainda aberta e pressa para terminar.
 *
 * ### Por isso ela pede o mínimo
 *
 * Nome, matrícula, senha e PIN. Nada de endereço, CNPJ ou preferências — tudo
 * isso cabe depois, com o sistema já funcionando. Uma tela de instalação que faz
 * dez perguntas é uma tela em que se erra alguma, e o erro só aparece semanas
 * depois num relatório.
 *
 * ### Por que o PIN não pode ficar para depois
 *
 * São duas credenciais de propósito: no balcão o operador troca de turno em
 * segundos, e senha longa a cada troca não funciona; na retaguarda o risco é
 * outro e a senha é longa (ADR-0011).
 *
 * Sem pedir o PIN aqui, o administrador recém-criado entra na retaguarda e
 * **não entra no caixa** — sem nenhuma pista do porquê, logo depois de instalar.
 * É um chamado de suporte na primeira hora de uso, e o conserto seria ir a
 * Usuários e descobrir o campo sozinho. Uma pergunta a mais aqui custa menos
 * que isso.
 *
 * ### O que ela explica
 *
 * Que esta senha não dá para recuperar. Não há e-mail cadastrado, não há
 * "esqueci minha senha" — o servidor é da loja, e não existe ninguém do outro
 * lado para confirmar identidade. Dizer isso agora custa uma frase; não dizer
 * custa uma reinstalação.
 */
export function PrimeiroAcesso({
  aoConcluir,
}: {
  readonly aoConcluir: () => void;
}): ReactNode {
  const { cliente } = useSessao();
  const [nome, setNome] = useState("");
  const [matricula, setMatricula] = useState("1");
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [pin, setPin] = useState("");
  const [erro, setErro] = useState<string | undefined>(undefined);
  const [salvando, setSalvando] = useState(false);

  async function criar(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    if (salvando) return;

    if (nome.trim() === "") {
      setErro("Informe o seu nome.");
      return;
    }

    if (senha.length < MINIMO_SENHA) {
      setErro(`A senha precisa de ao menos ${String(MINIMO_SENHA)} caracteres.`);
      return;
    }

    // Conferência dupla porque não há como recuperar depois. Em toda outra tela
    // do produto ela seria atrito; aqui é a única rede de proteção que existe.
    if (senha !== confirmacao) {
      setErro("As duas senhas não são iguais.");
      return;
    }

    if (pin.length !== DIGITOS_PIN) {
      setErro(`O PIN do balcão precisa de ${String(DIGITOS_PIN)} dígitos.`);
      return;
    }

    setSalvando(true);
    setErro(undefined);

    try {
      await cliente.requisitar("/api/instalacao/primeiro-administrador", {
        metodo: "POST",
        corpo: { matricula: matricula.trim(), nome: nome.trim(), senha, pin },
      });

      aoConcluir();
    } catch (causa) {
      setErro(mensagemDe(causa));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={(evento) => void criar(evento)}
        className="flex w-full max-w-md flex-col gap-5 rounded-lg border border-borda bg-papel p-8 shadow-cartao"
        noValidate
      >
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-tinta">Configurar o sistema</h1>
          <p className="text-tinta-suave">
            Esta instalação ainda não tem usuários. Crie o seu acesso de administrador
            para começar.
          </p>
        </header>

        {erro !== undefined && (
          <p
            role="alert"
            className="rounded-md border border-erro bg-erro-suave px-3 py-2 text-tinta"
          >
            {erro}
          </p>
        )}

        <CampoTexto
          rotulo="Seu nome"
          required
          autoFocus
          value={nome}
          onChange={(evento) => {
            setNome(evento.target.value);
          }}
        />

        <CampoTexto
          rotulo="Matrícula"
          numerico
          required
          ajuda="É o que você digita para entrar. Números curtos são mais rápidos no balcão."
          value={matricula}
          onChange={(evento) => {
            setMatricula(evento.target.value.replace(/\D/g, "").slice(0, 6));
          }}
        />

        <CampoTexto
          rotulo="Senha"
          type="password"
          required
          autoComplete="new-password"
          ajuda={`Ao menos ${String(MINIMO_SENHA)} caracteres. Uma frase que você lembre é melhor que uma palavra complicada.`}
          value={senha}
          onChange={(evento) => {
            setSenha(evento.target.value);
          }}
        />

        <CampoTexto
          rotulo="Repita a senha"
          type="password"
          required
          autoComplete="new-password"
          value={confirmacao}
          onChange={(evento) => {
            setConfirmacao(evento.target.value);
          }}
        />

        <CampoTexto
          rotulo="PIN do balcão"
          type="password"
          numerico
          required
          autoComplete="off"
          ajuda={`${String(DIGITOS_PIN)} dígitos. É o que você digita na frente de caixa — a senha acima é só para a retaguarda.`}
          value={pin}
          onChange={(evento) => {
            setPin(evento.target.value.replace(/\D/g, "").slice(0, DIGITOS_PIN));
          }}
        />

        <p className="rounded-md border border-atencao bg-atencao-suave px-3 py-2 text-sm text-tinta">
          <strong>Guarde esta senha.</strong> O sistema roda no servidor da própria loja e
          não tem recuperação por e-mail — se ela se perder, a instalação precisa ser
          refeita.
        </p>

        <Botao type="submit" tamanho="grande" ocupado={salvando} rotuloOcupado="Criando…">
          Criar acesso e entrar
        </Botao>
      </form>
    </main>
  );
}
