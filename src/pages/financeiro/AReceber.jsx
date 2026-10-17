import { useCallback, useEffect, useState } from 'react'
import { useCatalogo } from '../../contexts/CatalogoContext'
import { buscarTudo, supabase, traduzirErro } from '../../lib/supabase'
import { formatarMoeda } from '../../lib/moeda'
import { diasAte, formatarData, hojeISO, paraISO, somarDias } from '../../lib/datas'
import { agruparPorDia, somar } from '../../lib/financeiro'
import { Aviso, Metrica, Selo, Vazio } from '../../components/ui'

// O que a maquininha ainda vai depositar (já sem a taxa) e o que caiu nos últimos 30 dias.
export default function AReceber() {
  const { empresas } = useCatalogo()
  const [empresa, setEmpresa] = useState('todas')
  const [lista, setLista] = useState(null)
  const [erro, setErro] = useState('')
  const hoje = hojeISO()

  const carregar = useCallback(async () => {
    const desde = paraISO(somarDias(new Date(), -30))
    const { data, error } = await buscarTudo(() => supabase.from('recebiveis')
      .select('*, vendas(numero)')
      .or(`status.eq.a_receber,and(status.eq.recebido,recebido_em.gte.${desde})`)
      .order('data_prevista').order('id'))
    if (error) return setErro(traduzirErro(error))
    setLista(data.map((r) => ({ ...r, bruto: Number(r.bruto), taxa: Number(r.taxa), liquido: Number(r.liquido) })))
  }, [])
  useEffect(() => { carregar() }, [carregar])

  async function marcar(grupo, recebido) {
    setErro('')
    const { error } = await supabase.rpc('marcar_recebidos', { p_ids: grupo.itens.map((r) => r.id), p_recebido: recebido })
    if (error) return setErro(traduzirErro(error))
    carregar()
  }

  if (!lista) return <div className="calculadora">{erro ? <Aviso tom="vinho">{erro}</Aviso> : <p className="texto-suave">Carregando…</p>}</div>

  const doCNPJ = empresa === 'todas' ? lista : lista.filter((r) => r.empresa_id === empresa)
  const aReceber = doCNPJ.filter((r) => r.status === 'a_receber')
  const atrasados = agruparPorDia(aReceber.filter((r) => r.data_prevista < hoje))
  const proximos = agruparPorDia(aReceber.filter((r) => r.data_prevista >= hoje))
  const caidos = agruparPorDia(doCNPJ.filter((r) => r.status === 'recebido')).reverse()
  const ate = (dias) => somar(aReceber.filter((r) => r.data_prevista >= hoje && diasAte(r.data_prevista) <= dias), 'liquido')
  const apelido = (id) => empresas[id]?.apelido || id

  const linhaGrupo = (g, acao) => (
    <li key={`${g.data}-${g.empresa_id}`} className="linha-lista conta">
      <span>
        <strong>{formatarData(g.data)}{g.data === hoje ? ' · hoje' : ''} · {apelido(g.empresa_id)}</strong>
        <small>
          {g.itens.length} {g.itens.length === 1 ? 'lançamento' : 'lançamentos'} · bruto {formatarMoeda(g.bruto)} · taxa {formatarMoeda(g.taxa)}
          {g.itens.some((r) => r.forma === 'estorno') && ' · com estorno'}
          {' · venda '}{[...new Set(g.itens.map((r) => r.vendas?.numero))].sort((a, b) => a - b).map((n) => `nº ${n}`).join(', ')}
        </small>
      </span>
      <span className="conta-direita">
        <strong className={g.liquido < 0 ? 'texto-negativo' : ''}>{formatarMoeda(g.liquido)}</strong>
        {acao}
      </span>
    </li>
  )

  return (
    <div className="calculadora">
      <div className="fichas">
        <button className={`ficha ${empresa === 'todas' ? 'ativo' : ''}`} onClick={() => setEmpresa('todas')}>As duas maquininhas</button>
        {Object.values(empresas).map((e) => (
          <button key={e.id} className={`ficha ${empresa === e.id ? 'ativo' : ''}`} onClick={() => setEmpresa(e.id)}>{e.apelido}</button>
        ))}
      </div>
      <section className="grade-metricas">
        <Metrica rotulo="Cai em 7 dias" valor={formatarMoeda(ate(7))} />
        <Metrica rotulo="Cai em 30 dias" valor={formatarMoeda(ate(30))} />
        <Metrica rotulo="Total a receber" valor={formatarMoeda(somar(aReceber, 'liquido'))} detalhe={`taxas: ${formatarMoeda(somar(aReceber, 'taxa'))}`} />
      </section>
      {erro && <Aviso tom="vinho">{erro}</Aviso>}

      {atrasados.length > 0 && (
        <section className="cartao secao">
          <h2>Já deveria ter caído</h2>
          <p className="texto-suave pequeno">Confira no extrato da maquininha. Se caiu, marque; se não caiu, fale com a operadora.</p>
          <ul className="lista">
            {atrasados.map((g) => linhaGrupo(g, <><Selo tom="vinho">atrasado {-diasAte(g.data)} d</Selo><button className="botao-link" onClick={() => marcar(g, true)}>Caiu na conta</button></>))}
          </ul>
        </section>
      )}

      <section className="cartao secao">
        <h2>Próximos recebimentos do cartão</h2>
        <p className="texto-suave pequeno">Já sem a taxa da maquininha. O prazo de cada maquininha fica em Configurações; venda cancelada ou devolvida no cartão aparece como estorno, descontando do repasse.</p>
        {proximos.length === 0 ? <Vazio icone="financeiro" titulo="Nada a receber" /> : (
          <ul className="lista">
            {proximos.slice(0, 40).map((g) => linhaGrupo(g, <>
              {diasAte(g.data) <= 7 && <Selo tom="oliva">{diasAte(g.data) === 0 ? 'hoje' : `em ${diasAte(g.data)} d`}</Selo>}
              {g.data <= hoje && <button className="botao-link" onClick={() => marcar(g, true)}>Caiu na conta</button>}
            </>))}
          </ul>
        )}
      </section>

      <section className="cartao secao">
        <header className="bloco-topo">
          <h2>Caiu nos últimos 30 dias</h2>
          <strong>{formatarMoeda(somar(caidos, 'liquido'))}</strong>
        </header>
        <p className="texto-suave pequeno">Pagos de taxa nesse período: <strong>{formatarMoeda(somar(caidos, 'taxa'))}</strong>.</p>
        {caidos.length > 0 && (
          <ul className="lista">
            {caidos.slice(0, 30).map((g) => linhaGrupo(g, <button className="botao-link" onClick={() => marcar(g, false)}>Desfazer</button>))}
          </ul>
        )}
      </section>
    </div>
  )
}
