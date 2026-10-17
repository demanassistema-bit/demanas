import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCatalogo } from '../../contexts/CatalogoContext'
import { supabase, traduzirErro } from '../../lib/supabase'
import { formatarMoeda } from '../../lib/moeda'
import { formatarDataHora } from '../../lib/datas'
import { NOMES_FORMAS } from '../../lib/vendas'
import { textoCupom } from '../../lib/fiscal'
import Modal from '../../components/Modal'
import Icone from '../../components/Icone'
import { Aviso, Metrica, Vazio } from '../../components/ui'
import { numeroNota, SeloNota, useNotas } from './comum'

const FILTROS = {
  todas: ['Todas', () => true],
  autorizada: ['Autorizadas', (n) => n.status === 'autorizada'],
  pendente: ['Pendentes', (n) => n.status === 'pendente'],
  fila: ['Na fila', (n) => ['na_fila', 'enviando', 'a_cancelar', 'cancelando'].includes(n.status)],
  cancelada: ['Canceladas', (n) => n.status === 'cancelada' || n.status === 'descartada'],
}

export default function Notas() {
  const { empresas } = useCatalogo()
  const { notas, erro, processar } = useNotas()
  const [filtro, setFiltro] = useState('todas')
  const [aberta, setAberta] = useState(null)
  const [processando, setProcessando] = useState(false)
  if (!notas) return <div className="calculadora">{erro ? <Aviso tom="vinho">{erro}</Aviso> : <p className="texto-suave">Carregando…</p>}</div>

  const conta = (f) => notas.filter(FILTROS[f][1]).length
  const lista = notas.filter(FILTROS[filtro][1]).slice(0, 100)
  const notaAberta = notas.find((n) => n.id === aberta)
  const emissora = Object.values(empresas).find((e) => e.tipo === 'me')

  async function processarAgora() {
    setProcessando(true)
    await processar()
    setProcessando(false)
  }

  return (
    <div className="calculadora">
      <section className="grade-metricas">
        <Metrica rotulo="Autorizadas" valor={conta('autorizada')} />
        <Metrica rotulo="Pendentes" valor={conta('pendente')} detalhe="venda feita, nota por corrigir" />
        <Metrica rotulo="Na fila" valor={conta('fila')} />
      </section>
      {erro && <Aviso tom="vinho">{erro}</Aviso>}

      <div className="pagina-topo">
        <div className="fichas">
          {Object.entries(FILTROS).map(([k, [n]]) => <button key={k} className={`ficha ${filtro === k ? 'ativo' : ''}`} onClick={() => setFiltro(k)}>{n}</button>)}
        </div>
        {conta('fila') > 0 && <button className="botao botao-secundario" onClick={processarAgora} disabled={processando}>{processando ? 'Processando…' : 'Processar a fila agora'}</button>}
      </div>

      {lista.length === 0 ? <Vazio icone="fiscal" titulo="Nenhuma nota neste filtro" /> : (
        <ul className="cartao lista">
          {lista.map((n) => (
            <li key={n.id}>
              <button className="linha-lista" onClick={() => setAberta(n.id)}>
                <span>
                  <strong>NFC-e {numeroNota(n.numero)} · {formatarMoeda(n.valor_total)}</strong>
                  <small>{formatarDataHora(n.criado_em)} · venda nº {n.vendas?.numero}{n.vendas?.clientes?.nome && ` · ${n.vendas.clientes.nome}`}{n.status === 'pendente' && n.motivo_simples && ` · ${n.motivo_simples.slice(0, 90)}${n.motivo_simples.length > 90 ? '…' : ''}`}</small>
                </span>
                <SeloNota status={n.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="texto-suave pequeno">Só as vendas do {emissora?.apelido} (ME) têm nota. As do MEI saem sem nota. A nota sai sozinha a cada venda, em segundo plano. Para cancelar uma nota, cancele a venda em <Link to="/vendas">Vendas</Link> em até 30 minutos (regra da NFC-e).</p>

      {notaAberta && <Cupom nota={notaAberta} aoFechar={() => setAberta(null)} aoMudar={processar} />}
    </div>
  )
}

// Cupom (DANFE NFC-e) montado do instantâneo da venda guardado na nota
function Cupom({ nota, aoFechar, aoMudar }) {
  const [eventos, setEventos] = useState([])
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const d = nota.documento
  const teste = nota.provedor === 'simulado'

  useEffect(() => {
    supabase.from('documento_fiscal_eventos').select('*').eq('documento_id', nota.id).order('id')
      .then(({ data }) => setEventos(data || []))
  }, [nota.id, nota.status])

  async function reenviar() {
    setErro('')
    setEnviando(true)
    const { error } = await supabase.rpc('reenviar_nota', { p_doc: nota.id })
    if (error) { setEnviando(false); return setErro(traduzirErro(error)) }
    await aoMudar()
    setEnviando(false)
  }

  return (
    <Modal titulo={`NFC-e ${numeroNota(nota.numero)}`} aoFechar={aoFechar} largura={460}>
      {nota.status === 'pendente' && (
        <>
          <Aviso tom="vinho">{nota.motivo_simples || 'A nota não foi autorizada.'}</Aviso>
          <p className="texto-suave pequeno">Corrigiu o que faltava (em Dados fiscais)? Reenvie: a nota é montada de novo com os dados atuais, mantendo os valores da venda.</p>
          <button className="botao botao-principal" onClick={reenviar} disabled={enviando}>{enviando ? 'Reenviando…' : 'Reenviar nota'}</button>
        </>
      )}
      {nota.status === 'autorizada' && nota.motivo_simples && <Aviso tom="vinho">{nota.motivo_simples}</Aviso>}
      {nota.status === 'cancelada' && <Aviso tom="neutro">Nota cancelada junto com a venda. O registro fica guardado.</Aviso>}
      {nota.status === 'descartada' && <Aviso tom="neutro">A venda foi cancelada antes de a nota sair: nenhuma nota foi emitida.</Aviso>}
      {erro && <Aviso tom="vinho">{erro}</Aviso>}

      <div className={`cupom ${nota.status !== 'autorizada' ? 'apagado' : ''}`}>
        {teste && <p className="cupom-marca">SEM VALOR FISCAL · TESTE SIMULADO</p>}
        <strong>{d.emitente.razao_social || "deMana's"}</strong>
        <small>CNPJ {d.emitente.cnpj ? d.emitente.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : '(preencher em Dados fiscais)'} · IE {d.emitente.inscricao_estadual || '—'}</small>
        <small>{d.emitente.endereco || '(endereço da loja)'}{d.emitente.municipio && ` · ${d.emitente.municipio}/${d.emitente.uf}`}</small>
        <p className="cupom-titulo">Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica</p>
        <table>
          <tbody>
            {d.itens.map((i, n) => (
              <tr key={n}><td>{i.quantidade}x {i.descricao}</td><td>{formatarMoeda(i.valor_bruto)}</td></tr>
            ))}
            {Number(d.venda.desconto) > 0 && <tr><td>Desconto</td><td>− {formatarMoeda(d.venda.desconto)}</td></tr>}
            <tr className="cupom-total"><td>Total</td><td>{formatarMoeda(d.venda.total)}</td></tr>
            {d.pagamentos.map((p, i) => <tr key={i}><td>{NOMES_FORMAS[p.forma] || p.forma}{p.parcelas > 1 ? ` ${p.parcelas}x` : ''}</td><td>{formatarMoeda(p.valor)}</td></tr>)}
          </tbody>
        </table>
        <small>NFC-e nº {numeroNota(nota.numero)} · série {nota.serie} · {formatarDataHora(nota.emitida_em || nota.criado_em)}</small>
        <small>{d.consumidor?.cpf ? `CPF da consumidora: ${d.consumidor.cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')}` : 'Consumidor não identificado'}</small>
        {nota.chave && <small className="cupom-chave">Chave de acesso: {nota.chave.replace(/(\d{4})/g, '$1 ')}</small>}
        {nota.protocolo && <small>Protocolo: {nota.protocolo}</small>}
        {nota.qrcode_url ? <a href={nota.qrcode_url} target="_blank" rel="noreferrer">Consultar a nota na SEFAZ</a> : teste && <small>No teste simulado não há QR Code de consulta.</small>}
      </div>

      {nota.status === 'autorizada' && (
        <div className="acoes-coluna">
          <a className="botao botao-secundario" href={`https://wa.me/?text=${encodeURIComponent(textoCupom(nota))}`} target="_blank" rel="noreferrer"><Icone nome="conversa" /> Enviar cupom por WhatsApp</a>
          {nota.url_cupom && <a className="botao-link" href={nota.url_cupom} target="_blank" rel="noreferrer">Abrir o cupom do serviço de emissão</a>}
        </div>
      )}

      {eventos.length > 0 && (
        <details className="perfil-fiscal">
          <summary><strong>Histórico da nota</strong></summary>
          <ul className="lista lista-compacta">
            {eventos.map((ev) => (
              <li key={ev.id} className="linha-lista">
                <span><strong>{ev.tipo} · {ev.resultado}</strong><small>{formatarDataHora(ev.criado_em)}{ev.mensagem && ` · ${ev.mensagem}`}</small></span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Modal>
  )
}
