import { mensagemDe, useSessao } from "@erp/cliente-api";
import {
  Botao,
  CampoSelecao,
  CampoTexto,
  Carregando,
  ErroDeTela,
  type OpcaoDeSelecao,
} from "@erp/ui";
import { type ReactNode, type SyntheticEvent, useEffect, useRef, useState } from "react";

/**
 * Cadastro da empresa da instalação.
 *
 * É uma só por instalação (ADR-0024), então a tela não tem lista nem busca:
 * abre já no formulário, preenchido quando há cadastro e em branco quando é a
 * primeira vez. Lista de um item só obriga um clique a mais para chegar ao
 * único lugar onde há o que fazer.
 *
 * ### O CNPJ trava depois de salvo
 *
 * Não é capricho de tela: o servidor ignora o CNPJ na alteração. Deixar o campo
 * editável faria o lojista digitar, salvar, ver "salvo com sucesso" e continuar
 * com o CNPJ antigo — pior do que não deixar mexer.
 *
 * ### O aviso de inscrição estadual não bloqueia
 *
 * O módulo fiscal é opcional (ADR-0016): a loja vende sem ele. O aviso existe
 * para o lojista descobrir agora, e não na primeira tentativa de emissão.
 */

interface EnderecoDaEmpresa {
  readonly logradouro: string;
  readonly numero: string;
  readonly complemento?: string;
  readonly bairro: string;
  readonly municipio: string;
  readonly codigoMunicipioIbge?: string;
  readonly uf: string;
  readonly cep: string;
}

interface EmpresaCadastrada {
  readonly razaoSocial: string;
  readonly nomeFantasia?: string;
  readonly exibicao: string;
  readonly cnpj: string;
  readonly cnpjFormatado: string;
  readonly inscricaoEstadual?: string;
  readonly inscricaoMunicipal?: string;
  readonly regimeTributario: string;
  readonly endereco: EnderecoDaEmpresa;
  readonly telefone?: string;
  readonly email?: string;
  readonly aptaAEmitir: boolean;
}

type Estado =
  | { readonly fase: "CARREGANDO" }
  | { readonly fase: "PRONTO"; readonly empresa: EmpresaCadastrada | undefined }
  | { readonly fase: "FALHOU"; readonly mensagem: string };

const REGIMES: readonly OpcaoDeSelecao[] = [
  { valor: "SIMPLES_NACIONAL", rotulo: "Simples Nacional" },
  {
    valor: "SIMPLES_EXCESSO_SUBLIMITE",
    rotulo: "Simples Nacional — excesso de sublimite",
  },
  { valor: "REGIME_NORMAL", rotulo: "Regime normal (Lucro Presumido ou Real)" },
  { valor: "MEI", rotulo: "MEI — Microempreendedor Individual" },
];

const UFS: readonly OpcaoDeSelecao[] = [
  "AC",
  "AL",
  "AM",
  "AP",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MG",
  "MS",
  "MT",
  "PA",
  "PB",
  "PE",
  "PI",
  "PR",
  "RJ",
  "RN",
  "RO",
  "RR",
  "RS",
  "SC",
  "SE",
  "SP",
  "TO",
].map((sigla) => ({ valor: sigla, rotulo: sigla }));

export function Empresa(): ReactNode {
  const { cliente: api, pode } = useSessao();
  const [estado, setEstado] = useState<Estado>({ fase: "CARREGANDO" });
  const jaCarregou = useRef(false);

  async function carregar(): Promise<void> {
    setEstado({ fase: "CARREGANDO" });

    try {
      // `204` na instalação recém-feita: sem cadastro, e não "não encontrado".
      const empresa = await api.requisitar<EmpresaCadastrada | undefined>("/api/empresa");
      setEstado({ fase: "PRONTO", empresa: empresa ?? undefined });
    } catch (causa) {
      setEstado({ fase: "FALHOU", mensagem: mensagemDe(causa) });
    }
  }

  useEffect(() => {
    if (jaCarregou.current) return;
    jaCarregou.current = true;
    void carregar();
  });

  if (estado.fase === "CARREGANDO") return <Carregando oQue="o cadastro da empresa" />;

  if (estado.fase === "FALHOU") {
    return (
      <ErroDeTela mensagem={estado.mensagem} aoTentarDeNovo={() => void carregar()} />
    );
  }

  return (
    <Formulario
      empresa={estado.empresa}
      somenteLeitura={!pode("config:empresa")}
      aoSalvar={(salva) => {
        setEstado({ fase: "PRONTO", empresa: salva });
      }}
    />
  );
}

interface PropsFormulario {
  readonly empresa: EmpresaCadastrada | undefined;
  readonly somenteLeitura: boolean;
  readonly aoSalvar: (empresa: EmpresaCadastrada) => void;
}

function Formulario({ empresa, somenteLeitura, aoSalvar }: PropsFormulario): ReactNode {
  const { cliente: api } = useSessao();
  const cadastrada = empresa !== undefined;

  const [razaoSocial, setRazaoSocial] = useState(empresa?.razaoSocial ?? "");
  const [nomeFantasia, setNomeFantasia] = useState(empresa?.nomeFantasia ?? "");
  const [cnpj, setCnpj] = useState(empresa?.cnpj ?? "");
  const [inscricaoEstadual, setInscricaoEstadual] = useState(
    empresa?.inscricaoEstadual ?? "",
  );
  const [inscricaoMunicipal, setInscricaoMunicipal] = useState(
    empresa?.inscricaoMunicipal ?? "",
  );
  const [regime, setRegime] = useState(empresa?.regimeTributario ?? "SIMPLES_NACIONAL");
  const [logradouro, setLogradouro] = useState(empresa?.endereco.logradouro ?? "");
  const [numero, setNumero] = useState(empresa?.endereco.numero ?? "");
  const [complemento, setComplemento] = useState(empresa?.endereco.complemento ?? "");
  const [bairro, setBairro] = useState(empresa?.endereco.bairro ?? "");
  const [municipio, setMunicipio] = useState(empresa?.endereco.municipio ?? "");
  const [codigoIbge, setCodigoIbge] = useState(
    empresa?.endereco.codigoMunicipioIbge ?? "",
  );
  const [uf, setUf] = useState(empresa?.endereco.uf ?? "SP");
  const [cep, setCep] = useState(empresa?.endereco.cep ?? "");
  const [telefone, setTelefone] = useState(empresa?.telefone ?? "");
  const [email, setEmail] = useState(empresa?.email ?? "");

  const [erro, setErro] = useState<string | undefined>(undefined);
  const [salvo, setSalvo] = useState(false);
  const [salvando, setSalvando] = useState(false);

  async function salvar(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    if (salvando) return;

    // A validação de verdade é do servidor. Estas duas conferências existem só
    // para não gastar uma ida à rede com um campo obviamente incompleto.
    if (!cadastrada && cnpj.replace(/\D/g, "").length !== 14) {
      setErro("Informe os 14 dígitos do CNPJ da empresa.");
      return;
    }

    if (cep.replace(/\D/g, "").length !== 8) {
      setErro("Informe os 8 dígitos do CEP.");
      return;
    }

    setSalvando(true);
    setErro(undefined);
    setSalvo(false);

    const corpo = {
      razaoSocial: razaoSocial.trim(),
      regimeTributario: regime,
      ...(cadastrada ? {} : { cnpj: cnpj.replace(/\D/g, "") }),
      ...opcional("nomeFantasia", nomeFantasia),
      ...opcional("inscricaoEstadual", inscricaoEstadual),
      ...opcional("inscricaoMunicipal", inscricaoMunicipal),
      ...opcional("telefone", telefone),
      ...opcional("email", email),
      endereco: {
        logradouro: logradouro.trim(),
        numero: numero.trim(),
        bairro: bairro.trim(),
        municipio: municipio.trim(),
        uf,
        cep: cep.replace(/\D/g, ""),
        ...opcional("complemento", complemento),
        ...opcional("codigoMunicipioIbge", codigoIbge),
      },
    };

    try {
      const salva = await api.requisitar<EmpresaCadastrada>("/api/empresa", {
        metodo: "PUT",
        corpo,
      });

      setSalvo(true);
      aoSalvar(salva);
    } catch (causa) {
      setErro(mensagemDe(causa));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold text-tinta">Dados da empresa</h1>
        <p className="text-sm text-tinta-suave">
          É o que sai no cupom, na nota e no cabeçalho de todo relatório impresso.
        </p>
      </header>

      {somenteLeitura && (
        <p className="rounded-md border border-borda bg-papel px-3 py-2 text-sm text-tinta-suave">
          Você pode consultar estes dados, mas só o gerente pode alterá-los.
        </p>
      )}

      {cadastrada && !empresa.aptaAEmitir && (
        <p className="rounded-md border border-atencao bg-atencao-suave px-3 py-2 text-tinta">
          Falta a inscrição estadual. A loja continua vendendo normalmente — mas a emissão
          de nota, quando for habilitada, vai precisar dela.
        </p>
      )}

      <form
        onSubmit={(evento) => void salvar(evento)}
        className="flex flex-col gap-4"
        noValidate
      >
        {erro !== undefined && (
          <p
            role="alert"
            className="rounded-md border border-erro bg-erro-suave px-3 py-2 text-tinta"
          >
            {erro}
          </p>
        )}

        {salvo && erro === undefined && (
          <p
            role="status"
            className="rounded-md border border-borda bg-papel px-3 py-2 text-tinta"
          >
            Dados da empresa salvos.
          </p>
        )}

        <CampoTexto
          rotulo="Razão social"
          required
          autoFocus
          maxLength={60}
          disabled={somenteLeitura}
          ajuda="Como está no cartão CNPJ. No máximo 60 caracteres — é o limite da nota fiscal."
          value={razaoSocial}
          onChange={(evento) => {
            setRazaoSocial(evento.target.value);
          }}
        />

        <CampoTexto
          rotulo="Nome fantasia"
          maxLength={60}
          disabled={somenteLeitura}
          ajuda="Como a loja é conhecida. É o que aparece no cupom."
          value={nomeFantasia}
          onChange={(evento) => {
            setNomeFantasia(evento.target.value);
          }}
        />

        <CampoTexto
          rotulo="CNPJ"
          numerico
          required
          disabled={somenteLeitura || cadastrada}
          ajuda={
            cadastrada
              ? "O CNPJ não muda. Outra empresa é outra instalação."
              : "Só os números. Não poderá ser alterado depois."
          }
          value={cadastrada ? empresa.cnpjFormatado : cnpj}
          onChange={(evento) => {
            setCnpj(evento.target.value.replace(/\D/g, "").slice(0, 14));
          }}
        />

        <CampoSelecao
          rotulo="Regime tributário"
          required
          opcoes={REGIMES}
          disabled={somenteLeitura}
          ajuda="Na dúvida, confirme com o contador."
          valor={regime}
          aoMudar={setRegime}
        />

        <CampoTexto
          rotulo="Inscrição estadual"
          disabled={somenteLeitura}
          maxLength={20}
          ajuda="Deixe em branco se for isento. O MEI normalmente não tem."
          value={inscricaoEstadual}
          onChange={(evento) => {
            setInscricaoEstadual(evento.target.value);
          }}
        />

        <CampoTexto
          rotulo="Inscrição municipal"
          disabled={somenteLeitura}
          maxLength={20}
          value={inscricaoMunicipal}
          onChange={(evento) => {
            setInscricaoMunicipal(evento.target.value);
          }}
        />

        <h2 className="mt-2 text-base font-semibold text-tinta">Endereço</h2>

        <CampoTexto
          rotulo="Logradouro"
          required
          maxLength={120}
          disabled={somenteLeitura}
          value={logradouro}
          onChange={(evento) => {
            setLogradouro(evento.target.value);
          }}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <CampoTexto
            rotulo="Número"
            required
            maxLength={10}
            disabled={somenteLeitura}
            value={numero}
            onChange={(evento) => {
              setNumero(evento.target.value);
            }}
          />

          <CampoTexto
            rotulo="Complemento"
            maxLength={60}
            disabled={somenteLeitura}
            value={complemento}
            onChange={(evento) => {
              setComplemento(evento.target.value);
            }}
          />
        </div>

        <CampoTexto
          rotulo="Bairro"
          required
          maxLength={60}
          disabled={somenteLeitura}
          value={bairro}
          onChange={(evento) => {
            setBairro(evento.target.value);
          }}
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <CampoTexto
            rotulo="Município"
            required
            maxLength={60}
            disabled={somenteLeitura}
            value={municipio}
            onChange={(evento) => {
              setMunicipio(evento.target.value);
            }}
          />

          <CampoSelecao
            rotulo="UF"
            required
            opcoes={UFS}
            disabled={somenteLeitura}
            valor={uf}
            aoMudar={setUf}
          />

          <CampoTexto
            rotulo="CEP"
            numerico
            required
            disabled={somenteLeitura}
            value={cep}
            onChange={(evento) => {
              setCep(evento.target.value.replace(/\D/g, "").slice(0, 8));
            }}
          />
        </div>

        <CampoTexto
          rotulo="Código IBGE do município"
          numerico
          disabled={somenteLeitura}
          ajuda="Sete dígitos. Necessário só quando a emissão de nota for habilitada."
          value={codigoIbge}
          onChange={(evento) => {
            setCodigoIbge(evento.target.value.replace(/\D/g, "").slice(0, 7));
          }}
        />

        <h2 className="mt-2 text-base font-semibold text-tinta">Contato</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <CampoTexto
            rotulo="Telefone"
            numerico
            disabled={somenteLeitura}
            value={telefone}
            onChange={(evento) => {
              setTelefone(evento.target.value.replace(/\D/g, "").slice(0, 11));
            }}
          />

          <CampoTexto
            rotulo="E-mail"
            type="email"
            maxLength={160}
            disabled={somenteLeitura}
            value={email}
            onChange={(evento) => {
              setEmail(evento.target.value);
            }}
          />
        </div>

        {!somenteLeitura && (
          <div className="flex gap-3">
            <Botao type="submit" ocupado={salvando} rotuloOcupado="Salvando…">
              Salvar
            </Botao>
          </div>
        )}
      </form>
    </section>
  );
}

/** Campo em branco não vai no corpo: o servidor trata ausente como "sem valor". */
function opcional(campo: string, valor: string): Record<string, string> {
  const texto = valor.trim();
  return texto === "" ? {} : { [campo]: texto };
}
