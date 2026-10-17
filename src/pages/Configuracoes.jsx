import { useEffect, useState } from 'react'
import { useDemo } from '../demo/DemoContext'
import { lerMoeda, paraCampoMoeda } from '../lib/moeda'
import { filtroInteiro, filtroPercentual, limparTexto, TAMANHO } from '../lib/limites'
import { BotaoPerigo } from '../components/Modal'
import { useCatalogo } from '../contexts/CatalogoContext'
import { Aviso } from '../components/ui'

function Interruptor({ ligado, aoMudar, children, decisao }) {
  return (
    <label className="interruptor-linha">
      <span>
        {children}
        {decisao && <small className="decisao">decisão em aberto · confirmar com vocês</small>}
      </span>
      <input type="checkbox" role="switch" className="interruptor" checked={ligado} onChange={(e) => aoMudar(e.target.checked)} />
    </label>
  )
}

export default function Configuracoes() {
  const { dados, atualizarConfig, restaurar } = useDemo()
  const { empresas } = useCatalogo()
  const c = dados.config
  // textos digitados das taxas, por CNPJ: { day: { debito: '1,99' }, fe: {...} }
  const [taxas, setTaxas] = useState(() => Object.fromEntries(Object.entries(c.empresas).map(([id, e]) => [id,
    Object.fromEntries(Object.entries(e.taxas).map(([k, v]) => [k, paraCampoMoeda(v)]))])))
  const [restaurado, setRestaurado] = useState(false)

  const mudarEmpresa = (id, campos) => atualizarConfig({ empresas: { ...c.empresas, [id]: { ...c.empresas[id], ...campos } } })
  const salvarTaxa = (id, chave, digitado) => {
    const texto = filtroPercentual(digitado)
    setTaxas({ ...taxas, [id]: { ...taxas[id], [chave]: texto } })
    const n = lerMoeda(texto)
    if (n != null && !Number.isNaN(n)) mudarEmpresa(id, { taxas: { ...c.empresas[id].taxas, [chave]: n } })
  }

  return (
    <div className="pagina pagina-estreita">
      <header className="pagina-topo"><h1>Configurações</h1></header>
      <p className="texto-suave">Estas regras mudam como o sistema se comporta. As marcadas como "decisão em aberto" são perguntas para vocês.</p>

      <section className="cartao secao">
        <h2>Vendas</h2>
        <label className="interruptor-linha">
          <span>
            Desconto máximo da vendedora sem aprovação
            <small className="decisao">decisão em aberto · confirmar com vocês</small>
          </span>
          <span className="campo-sufixo">
            <input inputMode="numeric" value={c.limiteDescontoVendedora} onChange={(e) => atualizarConfig({ limiteDescontoVendedora: Math.min(Number(filtroInteiro(e.target.value, 3)) || 0, 100) })} aria-label="Limite de desconto" />
            %
          </span>
        </label>
        <Interruptor ligado={c.permitirEstoqueNegativo} aoMudar={(v) => atualizarConfig({ permitirEstoqueNegativo: v })} decisao>
          Permitir vender peça que o sistema diz estar sem estoque
        </Interruptor>
        <Interruptor ligado={c.aceitaCrediario} aoMudar={(v) => atualizarConfig({ aceitaCrediario: v })} decisao>
          Aceitar crediário (fiado)
        </Interruptor>
        <Interruptor ligado={c.intimaNaoRetorna} aoMudar={(v) => atualizarConfig({ intimaNaoRetorna: v })} decisao>
          Peça íntima devolvida não volta ao estoque (higiene)
        </Interruptor>
      </section>

      {Object.entries(c.empresas).map(([id, e]) => (
        <section key={id} className="cartao secao">
          <header className="bloco-topo">
            <h2>{empresas[id]?.apelido || e.apelido}</h2>
            <span className="selos"><span className="selo selo-neutro">{e.tipo === 'me' ? 'ME · emite nota' : 'MEI · sem nota'}</span></span>
          </header>
          <label className="campo campo-estreito">
            <span>Nome que aparece no sistema</span>
            <ApelidoEmpresa id={id} dona={e.dona} aoSalvar={(apelido) => mudarEmpresa(id, { apelido })} />
          </label>
          <p className="texto-suave pequeno">Taxas da maquininha da {e.dona}, usadas para calcular o lucro de verdade de cada venda.</p>
          <div className="grade-campos">
            {[['pix', 'Pix'], ['debito', 'Débito'], ['credito', 'Crédito à vista'], ['credito_parcelado', 'Crédito parcelado']].map(([k, n]) => (
              <label key={k} className="campo"><span>{n} (%)</span><input inputMode="decimal" value={taxas[id]?.[k] ?? ''} onChange={(ev) => salvarTaxa(id, k, ev.target.value)} /></label>
            ))}
          </div>
        </section>
      ))}

      <section className="cartao secao">
        <h2>Ainda nesta tela, na versão real</h2>
        <ul className="lista-simples">
          <li>Equipe: convidar pessoas e definir quem vê custo, financeiro e nota fiscal</li>
          <li>Os dados fiscais da empresa já estão em Nota fiscal → Dados fiscais</li>
          <li>Política de trocas e mensagem do recibo</li>
        </ul>
      </section>

      <section className="cartao secao">
        <h2>Demonstração</h2>
        <p className="texto-suave pequeno">Volta tudo para os dados de exemplo originais: apaga as vendas e entradas feitas durante a apresentação.</p>
        {restaurado ? <Aviso tom="oliva">Dados de exemplo restaurados.</Aviso> : (
          <BotaoPerigo texto="Restaurar dados de exemplo" aoConfirmar={() => { restaurar(); setRestaurado(true) }} />
        )}
      </section>
    </div>
  )
}

// O apelido do CNPJ fica no banco (vale para todo mundo). Nunca fica vazio.
function ApelidoEmpresa({ id, dona, aoSalvar }) {
  const { empresas, atualizarEmpresa } = useCatalogo()
  const atual = empresas[id]?.apelido || ''
  const [texto, setTexto] = useState(atual)
  useEffect(() => { setTexto(atual) }, [atual]) // o catálogo pode chegar depois
  const [erro, setErro] = useState('')
  async function salvar() {
    const apelido = limparTexto(texto) || `CNPJ ${dona}`
    setTexto(apelido)
    if (apelido === atual) return
    const r = await atualizarEmpresa(id, { apelido })
    if (r.erro) return setErro(r.erro)
    setErro('')
    aoSalvar(apelido)
  }
  return (
    <>
      <input value={texto} maxLength={TAMANHO.apelido} onChange={(ev) => setTexto(ev.target.value)} onBlur={salvar} />
      {erro && <small className="texto-alerta">{erro}</small>}
    </>
  )
}
