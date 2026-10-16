import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useDemo } from '../../demo/DemoContext'
import { arred, formatarMoeda, FORMAS_PAGAMENTO } from '../../lib/moeda'
import { formatarDataHora } from '../../lib/datas'
import { empresaEmissora, nomeVariacao } from '../../demo/regras'
import Modal from '../../components/Modal'
import Icone from '../../components/Icone'
import { Aviso, Metrica, Vazio } from '../../components/ui'
import { numeroNota, SeloNota, useNotas } from './comum'

const FILTROS = { todas: 'Todas', autorizada: 'Autorizadas', pendente: 'Pendentes', cancelada: 'Canceladas' }

export default function Notas() {
  const { dados } = useDemo()
  const notas = useNotas()
  const [filtro, setFiltro] = useState('todas')
  const [aberta, setAberta] = useState(null)
  const conta = (s) => notas.filter((n) => n.status === s).length
  const lista = notas.filter((n) => filtro === 'todas' || n.status === filtro).slice(0, 60)
  const notaAberta = notas.find((n) => n.venda.id === aberta)

  return (
    <div className="calculadora">
      <section className="grade-metricas">
        <Metrica rotulo="Autorizadas" valor={conta('autorizada')} />
        <Metrica rotulo="Pendentes" valor={conta('pendente')} detalhe="venda feita, nota por corrigir" />
        <Metrica rotulo="Canceladas" valor={conta('cancelada')} />
      </section>

      <div className="fichas">
        {Object.entries(FILTROS).map(([k, n]) => <button key={k} className={`ficha ${filtro === k ? 'ativo' : ''}`} onClick={() => setFiltro(k)}>{n}</button>)}
      </div>

      {lista.length === 0 ? <Vazio icone="fiscal" titulo="Nenhuma nota neste filtro" /> : (
        <ul className="cartao lista">
          {lista.map((n) => (
            <li key={n.venda.id}>
              <button className="linha-lista" onClick={() => setAberta(n.venda.id)}>
                <span>
                  <strong>NFC-e {numeroNota(n.numero)} · {formatarMoeda(n.venda.total)}</strong>
                  <small>{formatarDataHora(n.venda.data)} · venda nº {n.venda.numero}</small>
                </span>
                <SeloNota status={n.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="texto-suave pequeno">Só as vendas do {dados.config.empresas[empresaEmissora(dados.config)]?.apelido} (ME) têm nota. As do MEI vendem só para consumidor final e saem sem nota. A nota sai sozinha a cada venda, em segundo plano. Para cancelar uma nota, cancele a venda em <Link to="/vendas">Vendas</Link>, dentro do prazo do estado.</p>

      {notaAberta && <Cupom nota={notaAberta} aoFechar={() => setAberta(null)} />}
    </div>
  )
}

// Cupom de TESTE no formato da NFC-e (sem valor fiscal)
function Cupom({ nota, aoFechar }) {
  const { dados, variacaoPorId, produtoPorId, clientePorId, reenviarNota } = useDemo()
  const v = nota.venda
  // dados do CNPJ que emitiu (só a ME emite) + endereço e inscrição da área fiscal
  const empresa = { ...dados.config.fiscal.empresa, ...dados.config.empresas[v.empresa_id] }
  const cliente = clientePorId.get(v.cliente_id)
  const texto = `deMana's · NFC-e ${numeroNota(nota.numero)} (teste) · ${formatarMoeda(v.total)} · ${formatarDataHora(v.data)}`

  return (
    <Modal titulo={`NFC-e ${numeroNota(nota.numero)}`} aoFechar={aoFechar} largura={460}>
      {nota.status === 'pendente' && (
        <>
          <Aviso tom="vinho">{nota.motivo || 'A nota não foi autorizada.'}</Aviso>
          <button className="botao botao-principal" onClick={() => reenviarNota(v.id)}>Reenviar nota</button>
        </>
      )}
      {nota.status === 'cancelada' && <Aviso tom="neutro">Nota cancelada junto com a venda. O registro fica guardado.</Aviso>}

      <div className={`cupom ${nota.status !== 'autorizada' ? 'apagado' : ''}`}>
        <p className="cupom-marca">SEM VALOR FISCAL · AMBIENTE DE TESTE</p>
        <strong>{empresa.razao_social || "deMana's"}</strong>
        <small>CNPJ {empresa.cnpj || '(preencher em Dados fiscais)'}</small>
        <small>{empresa.endereco || '(endereço da loja)'}{empresa.municipio && ` · ${empresa.municipio}/${empresa.uf}`}</small>
        <p className="cupom-titulo">Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica</p>
        <table>
          <tbody>
            {v.itens.map((i) => {
              const vr = variacaoPorId.get(i.variacao_id)
              return (
                <tr key={i.variacao_id}>
                  <td>{i.quantidade}x {produtoPorId.get(vr.produto_id).nome} {nomeVariacao(vr)}</td>
                  <td>{formatarMoeda(arred(i.preco_unitario * i.quantidade))}</td>
                </tr>
              )
            })}
            {v.desconto > 0 && <tr><td>Desconto</td><td>− {formatarMoeda(v.desconto)}</td></tr>}
            <tr className="cupom-total"><td>Total</td><td>{formatarMoeda(v.total)}</td></tr>
            {v.pagamentos.map((p, i) => <tr key={i}><td>{FORMAS_PAGAMENTO[p.forma]}{p.parcelas > 1 ? ` ${p.parcelas}x` : ''}</td><td>{formatarMoeda(p.valor)}</td></tr>)}
          </tbody>
        </table>
        <small>NFC-e nº {numeroNota(nota.numero)} · série {nota.serie} · {formatarDataHora(v.data)}</small>
        <small>{cliente ? `Consumidora: ${cliente.nome}` : 'Consumidor não identificado'}</small>
        <div className="cupom-qr" aria-hidden="true">QR Code</div>
        <small>A chave de acesso (44 números) e o QR Code de consulta aparecem aqui na versão real.</small>
      </div>

      {nota.status === 'autorizada' && (
        <a className="botao botao-secundario" href={`https://wa.me/?text=${encodeURIComponent(texto)}`} target="_blank" rel="noreferrer">
          <Icone nome="conversa" /> Enviar cupom por WhatsApp
        </a>
      )}
    </Modal>
  )
}
