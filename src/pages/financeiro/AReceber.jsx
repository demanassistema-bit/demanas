import { useMemo, useState } from 'react'
import { useDemo } from '../../demo/DemoContext'
import { arred, formatarMoeda } from '../../lib/moeda'
import { diaDe, diasAte, formatarData, hojeISO } from '../../lib/datas'
import { recebiveisDaVenda, taxasDe } from '../../demo/regras'
import { Metrica, Selo, Vazio } from '../../components/ui'

// Recebíveis de todas as vendas concluídas (cartão). Na versão real, viram registros conferidos com o extrato.
export function useRecebiveis() {
  const { dados } = useDemo()
  return useMemo(() => dados.vendas
    .filter((v) => v.status === 'concluida')
    .flatMap((v) => recebiveisDaVenda(v, taxasDe(dados.config, v.empresa_id), diaDe(v.data)).map((r) => ({ ...r, empresa_id: v.empresa_id })))
    .sort((a, b) => a.data.localeCompare(b.data)), [dados.vendas, dados.config])
}

const soma = (lista, campo) => arred(lista.reduce((s, r) => s + r[campo], 0))

export default function AReceber() {
  const { dados } = useDemo()
  const [empresa, setEmpresa] = useState('todas')
  const todos = useRecebiveis()
  const recebiveis = empresa === 'todas' ? todos : todos.filter((r) => r.empresa_id === empresa)
  const hoje = hojeISO()
  const futuros = recebiveis.filter((r) => r.data >= hoje)
  const caidos = recebiveis.filter((r) => r.data < hoje && diasAte(r.data) >= -30)

  const porDia = useMemo(() => {
    const mapa = new Map()
    for (const r of futuros) {
      const atual = mapa.get(r.data) || []
      mapa.set(r.data, [...atual, r])
    }
    return [...mapa.entries()]
  }, [futuros])

  const crediario = dados.vendas
    .filter((v) => v.status === 'concluida')
    .flatMap((v) => v.pagamentos.filter((p) => p.forma === 'crediario').map((p) => ({ venda: v, valor: p.valor })))

  return (
    <div className="calculadora">
      <div className="fichas">
        <button className={`ficha ${empresa === 'todas' ? 'ativo' : ''}`} onClick={() => setEmpresa('todas')}>As duas maquininhas</button>
        {Object.entries(dados.config.empresas).map(([id, e]) => (
          <button key={id} className={`ficha ${empresa === id ? 'ativo' : ''}`} onClick={() => setEmpresa(id)}>{e.apelido}</button>
        ))}
      </div>
      <section className="grade-metricas">
        <Metrica rotulo="Cai em 7 dias" valor={formatarMoeda(soma(futuros.filter((r) => diasAte(r.data) <= 7), 'liquido'))} />
        <Metrica rotulo="Cai em 30 dias" valor={formatarMoeda(soma(futuros.filter((r) => diasAte(r.data) <= 30), 'liquido'))} />
        <Metrica rotulo="Total a receber" valor={formatarMoeda(soma(futuros, 'liquido'))} detalhe={`taxas: ${formatarMoeda(soma(futuros, 'taxa'))}`} />
      </section>

      <section className="cartao secao">
        <h2>Próximos recebimentos do cartão</h2>
        <p className="texto-suave pequeno">Já sem a taxa da maquininha. Débito cai no dia seguinte; crédito, 30 dias depois de cada parcela.</p>
        {porDia.length === 0 ? <Vazio icone="financeiro" titulo="Nada a receber" /> : (
          <ul className="lista">
            {porDia.slice(0, 20).map(([data, lista]) => (
              <li key={data} className="linha-lista">
                <span>
                  <strong>{formatarData(data)}{data === hoje ? ' · hoje' : ''}</strong>
                  <small>{empresa === 'todas' && `${[...new Set(lista.map((r) => dados.config.empresas[r.empresa_id]?.apelido))].join(' + ')} · `}{lista.length} {lista.length === 1 ? 'parcela' : 'parcelas'} · bruto {formatarMoeda(soma(lista, 'bruto'))} · taxa {formatarMoeda(soma(lista, 'taxa'))}</small>
                </span>
                <span className="selos">
                  {diasAte(data) > 0 && diasAte(data) <= 7 && <Selo tom="oliva">em {diasAte(data)} d</Selo>}
                  <strong>{formatarMoeda(soma(lista, 'liquido'))}</strong>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {crediario.length > 0 && (
        <section className="cartao secao">
          <h2>Crediário</h2>
          <ul className="lista">
            {crediario.map(({ venda, valor }) => (
              <li key={venda.id} className="linha-lista">
                <span><strong>Venda nº {venda.numero}</strong><small>{formatarData(diaDe(venda.data))}</small></span>
                <strong>{formatarMoeda(valor)}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="cartao secao">
        <header className="bloco-topo">
          <h2>Caiu nos últimos 30 dias</h2>
          <strong>{formatarMoeda(soma(caidos, 'liquido'))}</strong>
        </header>
        <p className="texto-suave pequeno">
          Pagos de taxa nesse período: <strong>{formatarMoeda(soma(caidos, 'taxa'))}</strong>.
          Na versão real, cada valor é conferido com o extrato da maquininha, para pegar taxa cobrada a mais.
        </p>
      </section>
    </div>
  )
}
