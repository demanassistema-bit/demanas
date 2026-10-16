import { useState } from 'react'
import { useDemo } from '../demo/DemoContext'
import { lerMoeda, paraCampoMoeda } from '../lib/moeda'
import { BotaoPerigo } from '../components/Modal'
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
  const c = dados.config
  const [taxas, setTaxas] = useState(() => Object.fromEntries(Object.entries(c.taxas).map(([k, v]) => [k, paraCampoMoeda(v)])))
  const [restaurado, setRestaurado] = useState(false)

  const salvarTaxa = (chave, texto) => {
    setTaxas({ ...taxas, [chave]: texto })
    const n = lerMoeda(texto)
    if (n != null && !Number.isNaN(n)) atualizarConfig({ taxas: { ...c.taxas, [chave]: n } })
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
            <input inputMode="numeric" value={c.limiteDescontoVendedora} onChange={(e) => atualizarConfig({ limiteDescontoVendedora: Number(e.target.value.replace(/\D/g, '')) || 0 })} aria-label="Limite de desconto" />
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

      <section className="cartao secao">
        <h2>Taxas da maquininha</h2>
        <p className="texto-suave pequeno">Usadas para calcular o lucro de verdade de cada venda.</p>
        <div className="grade-campos">
          {[['pix', 'Pix'], ['debito', 'Débito'], ['credito', 'Crédito à vista'], ['credito_parcelado', 'Crédito parcelado']].map(([k, n]) => (
            <label key={k} className="campo"><span>{n} (%)</span><input inputMode="decimal" value={taxas[k]} onChange={(e) => salvarTaxa(k, e.target.value)} /></label>
          ))}
        </div>
      </section>

      <section className="cartao secao">
        <h2>Ainda nesta tela, na versão real</h2>
        <ul className="lista-simples">
          <li>Equipe: convidar pessoas e definir quem vê custo, financeiro e nota fiscal</li>
          <li>Dados fiscais da empresa (CNPJ, regime, inscrição estadual)</li>
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
