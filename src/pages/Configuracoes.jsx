import { useEffect, useState } from 'react'
import { lerMoeda, paraCampoMoeda } from '../lib/moeda'
import { filtroInteiro, filtroPercentual, limparTexto, TAMANHO } from '../lib/limites'
import { TIPOS_TAXA } from '../lib/vendas'
import { useCatalogo } from '../contexts/CatalogoContext'
import { Aviso } from '../components/ui'

function Interruptor({ ligado, aoMudar, children, decisao, disabled }) {
  return (
    <label className="interruptor-linha">
      <span>
        {children}
        {decisao && <small className="decisao">decisão em aberto · confirmar com vocês</small>}
      </span>
      <input type="checkbox" role="switch" className="interruptor" checked={ligado} disabled={disabled} onChange={(e) => aoMudar(e.target.checked)} />
    </label>
  )
}

export default function Configuracoes() {
  const cat = useCatalogo()
  const { empresas, parametros, categorias } = cat
  const [erro, setErro] = useState('')
  const executar = async (promessa) => { const r = await promessa; setErro(r?.erro || '') }

  return (
    <div className="pagina pagina-estreita">
      <header className="pagina-topo"><h1>Configurações</h1></header>
      <p className="texto-suave">Estas regras mudam como o sistema se comporta e valem para todo mundo. As marcadas como "decisão em aberto" são perguntas para vocês.</p>
      {erro && <Aviso tom="vinho">{erro}</Aviso>}

      <section className="cartao secao">
        <h2>Vendas</h2>
        <LimiteDesconto atual={Number(parametros.limite_desconto_vendedora ?? 0)} aoSalvar={(n) => executar(cat.salvarParametro('limite_desconto_vendedora', n))} />
        <Interruptor ligado={parametros.permitir_estoque_negativo === true} aoMudar={(v) => executar(cat.salvarParametro('permitir_estoque_negativo', v))}>
          Permitir vender peça que o sistema diz estar sem estoque
          <small className="texto-suave">Útil só no começo, enquanto a contagem não estiver completa. O estoque fica negativo até a próxima entrada ou contagem.</small>
        </Interruptor>
        <p className="texto-suave pequeno">A loja não vende fiado (crediário): só Pix, cartão e dinheiro.</p>
      </section>

      <section className="cartao secao">
        <h2>Relatórios</h2>
        <p className="texto-suave pequeno">Usados no "O que recomprar" e nas peças paradas. Ajuste conforme o prazo dos fornecedores.</p>
        <div className="grade-campos">
          <NumeroEmpresa nome="Avisar para recomprar quando o estoque dura menos de (dias)" atual={Number(parametros.recomprar_dias_alerta ?? 15)} min={1} max={180} aoSalvar={(n) => executar(cat.salvarParametro('recomprar_dias_alerta', n))} />
          <NumeroEmpresa nome="Sugerir pedir o suficiente para (dias)" atual={Number(parametros.recomprar_dias_cobertura ?? 30)} min={1} max={365} aoSalvar={(n) => executar(cat.salvarParametro('recomprar_dias_cobertura', n))} />
          <NumeroEmpresa nome="Peça parada: sem vender há (dias)" atual={Number(parametros.dias_peca_parada ?? 45)} min={7} max={365} aoSalvar={(n) => executar(cat.salvarParametro('dias_peca_parada', n))} />
        </div>
      </section>

      <section className="cartao secao">
        <h2>Devolução: peça que não volta ao estoque</h2>
        <p className="texto-suave pequeno">Marque as categorias de higiene (calcinha, peça íntima): na devolução, a peça vem marcada para não voltar à prateleira.</p>
        {categorias.length === 0 ? <p className="texto-suave pequeno">As categorias aparecem aqui quando os produtos forem cadastrados.</p> : categorias.map((k) => (
          <Interruptor key={k.id} ligado={k.nao_volta_ao_estoque} aoMudar={(v) => executar(cat.marcarHigiene(k.id, v))}>{k.nome}</Interruptor>
        ))}
      </section>

      {Object.values(empresas).map((e) => (
        <section key={e.id} className="cartao secao">
          <header className="bloco-topo">
            <h2>{e.apelido}</h2>
            <span className="selos"><span className="selo selo-neutro">{e.tipo === 'me' ? 'ME · emite nota' : 'MEI · sem nota'}</span></span>
          </header>
          <label className="campo campo-estreito">
            <span>Nome que aparece no sistema</span>
            <ApelidoEmpresa id={e.id} dona={e.dona} />
          </label>
          <p className="texto-suave pequeno">Taxas da maquininha da {e.dona}. Cada venda guarda a taxa do dia em que foi feita, para o lucro de verdade.</p>
          <div className="grade-campos">
            {Object.entries(TIPOS_TAXA).map(([tipo, nome]) => (
              <Taxa key={tipo} nome={nome} atual={cat.taxas[e.id]?.[tipo] ?? 0} aoSalvar={(n) => executar(cat.salvarTaxa(e.id, tipo, n))} />
            ))}
          </div>
          <p className="texto-suave pequeno">Em quantos dias o dinheiro do cartão cai na conta. <span className="decisao">confirmar com a maquininha</span></p>
          <div className="grade-campos">
            <NumeroEmpresa nome="Débito cai em (dias)" atual={e.prazo_debito_dias} min={0} max={60} aoSalvar={(n) => executar(cat.atualizarEmpresa(e.id, { prazo_debito_dias: n }))} />
            <NumeroEmpresa nome="Crédito cai em (dias, por parcela)" atual={e.prazo_credito_dias} min={1} max={60} aoSalvar={(n) => executar(cat.atualizarEmpresa(e.id, { prazo_credito_dias: n }))} />
            <Taxa nome="Imposto sobre a venda" atual={Number(e.imposto_percentual ?? 0)} aoSalvar={(n) => executar(cat.atualizarEmpresa(e.id, { imposto_percentual: n }))} />
          </div>
          <p className="texto-suave pequeno">O imposto entra como custo variável no Resultado do mês e na Calculadora. Mude quando a contadora recomendar. O prazo vale para as próximas vendas.</p>
        </section>
      ))}

      <section className="cartao secao">
        <h2>Ainda nesta tela, mais adiante</h2>
        <ul className="lista-simples">
          <li>Política de trocas e mensagem do recibo</li>
          <li>Os dados fiscais da empresa já estão em Nota fiscal → Dados fiscais</li>
        </ul>
      </section>

    </div>
  )
}

function LimiteDesconto({ atual, aoSalvar }) {
  const [texto, setTexto] = useState(String(atual))
  useEffect(() => { setTexto(String(atual)) }, [atual])
  function salvar() {
    const n = Math.min(Number(texto) || 0, 100)
    setTexto(String(n))
    if (n !== atual) aoSalvar(n)
  }
  return (
    <label className="interruptor-linha">
      <span>
        Desconto máximo da vendedora sem aprovação
        <small className="decisao">decisão em aberto · confirmar com vocês</small>
      </span>
      <span className="campo-sufixo">
        <input inputMode="numeric" value={texto} onChange={(e) => setTexto(filtroInteiro(e.target.value, 3))} onBlur={salvar} aria-label="Limite de desconto" />
        %
      </span>
    </label>
  )
}

// Taxa salva ao sair do campo (de 0 a 30%)
function Taxa({ nome, atual, aoSalvar }) {
  const [texto, setTexto] = useState(paraCampoMoeda(atual))
  useEffect(() => { setTexto(paraCampoMoeda(atual)) }, [atual])
  const [erro, setErro] = useState('')
  function salvar() {
    const n = lerMoeda(texto) ?? 0
    if (Number.isNaN(n) || n < 0 || n > 30) return setErro('De 0 a 30%.')
    setErro('')
    setTexto(paraCampoMoeda(n))
    if (n !== atual) aoSalvar(n)
  }
  return (
    <label className="campo">
      <span>{nome} (%)</span>
      <input inputMode="decimal" value={texto} onChange={(e) => setTexto(filtroPercentual(e.target.value))} onBlur={salvar} />
      {erro && <small className="texto-alerta">{erro}</small>}
    </label>
  )
}

// Número inteiro salvo ao sair do campo (prazo da maquininha)
function NumeroEmpresa({ nome, atual, min, max, aoSalvar }) {
  const [texto, setTexto] = useState(String(atual ?? ''))
  useEffect(() => { setTexto(String(atual ?? '')) }, [atual])
  const [erro, setErro] = useState('')
  function salvar() {
    const n = Number(texto)
    if (texto === '' || !Number.isInteger(n) || n < min || n > max) return setErro(`De ${min} a ${max}.`)
    setErro('')
    if (n !== atual) aoSalvar(n)
  }
  return (
    <label className="campo">
      <span>{nome}</span>
      <input inputMode="numeric" value={texto} onChange={(e) => setTexto(filtroInteiro(e.target.value, String(max).length))} onBlur={salvar} />
      {erro && <small className="texto-alerta">{erro}</small>}
    </label>
  )
}

// O apelido do CNPJ fica no banco (vale para todo mundo). Nunca fica vazio.
function ApelidoEmpresa({ id, dona }) {
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
    setErro(r.erro || '')
  }
  return (
    <>
      <input value={texto} maxLength={TAMANHO.apelido} onChange={(ev) => setTexto(ev.target.value)} onBlur={salvar} />
      {erro && <small className="texto-alerta">{erro}</small>}
    </>
  )
}
