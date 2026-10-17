import { useState } from 'react'
import { useCatalogo } from '../../contexts/CatalogoContext'
import { hojeISO } from '../../lib/datas'
import { cnpjValido, erroData, filtroInteiro, formatarCNPJ, limparCNPJ, limparTexto, TAMANHO, UFS } from '../../lib/limites'
import { CAMPOS_PERFIL_FISCAL, faltasPerfilFiscal, situacaoCertificado } from '../../lib/fiscal'
import { Aviso, Selo } from '../../components/ui'

const REGIMES = { '': 'A confirmar com a contadora', mei: 'MEI', simples: 'Simples Nacional', presumido: 'Lucro Presumido', real: 'Lucro Real' }
const PROVEDORES = { simulado: 'Simulado (teste, sem contratar nada)', focus: 'Focus NFe (aguarda a aprovação das irmãs)' }
const CAMPOS_BANCO = { ncm: 'ncm', cest: 'cest', origem: 'origem', cfop: 'cfop', csosn: 'csosn_ou_cst' }

export default function DadosFiscais() {
  const { empresas, categorias, produtos, perfisFiscais } = useCatalogo()
  const emissora = Object.values(empresas).find((e) => e.tipo === 'me')

  // categorias com produto que sai com nota (CNPJ da ME)
  const idsComNota = new Set(produtos.filter((p) => p.ativo && empresas[p.empresa_id]?.tipo === 'me').map((p) => p.categoria_id))
  const categoriasComNota = categorias.filter((c) => idsComNota.has(c.id))
  const semCategoria = produtos.filter((p) => p.ativo && empresas[p.empresa_id]?.tipo === 'me' && !p.categoria_id)

  return (
    <div className="calculadora">
      <Aviso tom="ambar">Nada aqui deve ser inventado. Preencha com o que a contadora enviar: regime, códigos e alíquotas são decisão dela, não do sistema.</Aviso>

      <section className="cartao secao">
        <h2>Os dois CNPJs da loja</h2>
        <p className="texto-suave pequeno">No dia a dia aparece só o apelido. O número do CNPJ fica guardado aqui.</p>
        {Object.values(empresas).map((e) => <FormEmpresa key={e.id} empresa={e} />)}
      </section>

      {emissora && <Emissao empresa={emissora} />}

      <section className="cartao secao">
        <h2>Dados fiscais por categoria</h2>
        <p className="texto-suave pequeno">Cada produto herda os dados da sua categoria. A contadora preenche uma vez e marca como validado. Só aparecem as categorias com produtos do {emissora?.apelido}, que emite nota.</p>
        {semCategoria.length > 0 && <Aviso tom="vinho">{semCategoria.length} {semCategoria.length === 1 ? 'produto do' : 'produtos do'} {emissora?.apelido} sem categoria: {semCategoria.slice(0, 5).map((p) => p.nome).join(', ')}{semCategoria.length > 5 ? '…' : ''}. Sem categoria, a nota fica pendente. Escolha a categoria na ficha do produto.</Aviso>}
        {categoriasComNota.length === 0 && <p className="texto-suave">Nenhuma categoria ainda: cadastre os produtos primeiro.</p>}
        {categoriasComNota.map((c) => <FormPerfilFiscal key={c.id} categoria={c} perfil={perfisFiscais[c.id]} />)}
      </section>
    </div>
  )
}

// Como a nota sai: serviço de emissão, certificado, sempre ou só quando pedirem, série
function Emissao({ empresa }) {
  const { atualizarEmpresa } = useCatalogo()
  const [validade, setValidade] = useState(empresa.certificado_validade || '')
  const [serie, setSerie] = useState(String(empresa.nfce_serie || 1))
  const [msg, setMsg] = useState(null)
  const certificado = situacaoCertificado(empresa.certificado_validade, hojeISO())
  const erroValidade = erroData(validade, { rotulo: 'a validade', min: '2020-01-01', max: '2040-12-31', obrigatoria: false })

  async function salvar(campos) {
    const r = await atualizarEmpresa(empresa.id, campos)
    setMsg(r.erro ? { tom: 'vinho', texto: r.erro } : { tom: 'oliva', texto: 'Salvo.' })
  }

  return (
    <section className="cartao secao">
      <h2>Emissão · {empresa.apelido}</h2>
      <div className="grade-campos">
        <label className="campo"><span>Serviço de emissão</span>
          <select value={empresa.fiscal_provedor} onChange={(e) => salvar({ fiscal_provedor: e.target.value })}>
            {Object.entries(PROVEDORES).map(([k, n]) => <option key={k} value={k} disabled={k === 'focus'}>{n}</option>)}
          </select>
        </label>
        <label className="campo"><span>Validade do certificado A1</span>
          <input type="date" min="2020-01-01" max="2040-12-31" value={validade}
            onChange={(e) => setValidade(e.target.value)}
            onBlur={() => { if (!erroValidade && (validade || null) !== (empresa.certificado_validade || null)) salvar({ certificado_validade: validade || null }) }} />
          {erroValidade && <small className="texto-alerta">{erroValidade}</small>}
        </label>
        <label className="campo"><span>Série da NFC-e</span>
          <input inputMode="numeric" value={serie} onChange={(e) => setSerie(filtroInteiro(e.target.value, 3))}
            onBlur={() => { const n = Number(serie); if (n >= 1 && n <= 999 && n !== empresa.nfce_serie) salvar({ nfce_serie: n }); else setSerie(String(empresa.nfce_serie || 1)) }} />
        </label>
      </div>
      <p className="pequeno">{certificado.tom ? <Selo tom={certificado.tom}>{certificado.texto}</Selo> : <Selo tom="oliva">{certificado.texto}</Selo>}</p>
      <div className="campo">
        <span>Emitir nota <small className="decisao">decisão em aberto · confirmar com vocês e a contadora</small></span>
        <div className="segmentado">
          <button className={empresa.emitir_quando === 'sempre' ? 'ativo' : ''} onClick={() => salvar({ emitir_quando: 'sempre' })}>Em toda venda</button>
          <button className={empresa.emitir_quando === 'pedido' ? 'ativo' : ''} onClick={() => salvar({ emitir_quando: 'pedido' })}>Só quando pedirem</button>
        </div>
        <small className="texto-suave">"Só quando pedirem": a nota é pedida depois, no detalhe da venda, com CPF se a cliente quiser.</small>
      </div>
      {msg && <Aviso tom={msg.tom}>{msg.texto}</Aviso>}
      <p className="texto-suave pequeno">O ambiente fica travado em <strong>teste (homologação)</strong>: produção só com ordem explícita, depois da contadora conferir. O arquivo e a senha do certificado e o CSC da NFC-e ficam só no serviço de emissão, nunca no sistema. Aqui fica apenas a validade, para o aviso de 60, 30 e 15 dias.</p>
    </section>
  )
}


function FormEmpresa({ empresa }) {
  const { atualizarEmpresa } = useCatalogo()
  const [f, setF] = useState({ ...empresa })
  const [msg, setMsg] = useState(null)
  const mudou = ['razao_social', 'cnpj', 'inscricao_estadual', 'regime', 'endereco', 'municipio', 'uf'].some((k) => f[k] !== empresa[k])
  const cnpjTexto = limparCNPJ(f.cnpj)

  async function salvar(e) {
    e.preventDefault()
    if (cnpjTexto && !cnpjValido(cnpjTexto)) return setMsg({ tom: 'vinho', texto: 'CNPJ incompleto ou com número errado. Confira no cartão CNPJ.' })
    const r = await atualizarEmpresa(empresa.id, {
      razao_social: limparTexto(f.razao_social), cnpj: cnpjTexto ? formatarCNPJ(cnpjTexto) : '',
      inscricao_estadual: f.inscricao_estadual, regime: f.regime, endereco: limparTexto(f.endereco), municipio: limparTexto(f.municipio), uf: f.uf,
    })
    setMsg(r.erro ? { tom: 'vinho', texto: r.erro } : { tom: 'oliva', texto: 'Salvo.' })
  }

  const emite = empresa.tipo === 'me'
  return (
    <form className="perfil-fiscal formulario" onSubmit={salvar}>
      <header className="bloco-topo">
        <strong>{empresa.apelido}</strong>
        <Selo tom={emite ? 'oliva' : 'neutro'}>{emite ? 'ME · emite nota' : 'MEI · só consumidor final · sem nota'}</Selo>
      </header>
      <div className="grade-campos">
        <label className="campo"><span>Razão social</span><input value={f.razao_social} maxLength={TAMANHO.razaoSocial} onChange={(e) => setF({ ...f, razao_social: e.target.value })} /></label>
        <label className="campo">
          <span>CNPJ</span>
          <input value={f.cnpj} maxLength={18} placeholder="00.000.000/0000-00" onChange={(e) => setF({ ...f, cnpj: limparCNPJ(e.target.value) })} onBlur={() => setF({ ...f, cnpj: formatarCNPJ(f.cnpj) })} />
          {cnpjTexto && !cnpjValido(cnpjTexto) && <small className="texto-alerta">CNPJ incompleto ou com número errado.</small>}
        </label>
        {emite && (
          <>
            <label className="campo"><span>Inscrição estadual</span><input value={f.inscricao_estadual} maxLength={20} onChange={(e) => setF({ ...f, inscricao_estadual: e.target.value.toUpperCase().replace(/[^0-9A-Z./-]/g, '') })} /></label>
            <label className="campo"><span>Regime tributário</span>
              <select value={f.regime} onChange={(e) => setF({ ...f, regime: e.target.value })}>
                {Object.entries(REGIMES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
              </select>
            </label>
            <label className="campo"><span>Endereço</span><input value={f.endereco} maxLength={TAMANHO.endereco} onChange={(e) => setF({ ...f, endereco: e.target.value })} /></label>
            <label className="campo"><span>Município</span><input value={f.municipio} maxLength={TAMANHO.municipio} onChange={(e) => setF({ ...f, municipio: e.target.value })} /></label>
            <label className="campo"><span>Estado (UF)</span>
              <select value={f.uf} onChange={(e) => setF({ ...f, uf: e.target.value })}>
                <option value="">Escolha</option>
                {UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
              </select>
            </label>
          </>
        )}
      </div>
      {emite && (f.regime === 'simples' || f.regime === 'mei') && (
        <p className="texto-suave pequeno">Reforma tributária: pelas fontes do briefing, Simples e MEI passam a informar IBS e CBS na nota a partir de 4 de janeiro de 2027. Confirmar com a contadora.</p>
      )}
      {msg && <Aviso tom={msg.tom}>{msg.texto}</Aviso>}
      <button className="botao botao-secundario" disabled={!mudou}>Salvar {empresa.apelido}</button>
    </form>
  )
}

function FormPerfilFiscal({ categoria, perfil = {} }) {
  const { salvarPerfilFiscal } = useCatalogo()
  const inicial = Object.fromEntries(Object.entries(CAMPOS_BANCO).map(([tela, banco]) => [tela, perfil[banco] || '']))
  const [f, setF] = useState({ ...inicial, validado: Boolean(perfil.validado) })
  const [msg, setMsg] = useState(null)
  const faltas = faltasPerfilFiscal(f)
  const mudou = Object.keys(inicial).some((k) => f[k] !== inicial[k]) || f.validado !== Boolean(perfil.validado)

  async function salvar(e) {
    e.preventDefault()
    const r = await salvarPerfilFiscal(categoria.id, { ...Object.fromEntries(Object.entries(CAMPOS_BANCO).map(([tela, banco]) => [banco, f[tela]])), validado: f.validado })
    setMsg(r.erro ? { tom: 'vinho', texto: r.erro.includes('check') ? 'Algum código está no formato errado. Confira a quantidade de números.' : r.erro } : { tom: 'oliva', texto: 'Salvo.' })
  }

  return (
    <details className="perfil-fiscal">
      <summary>
        <strong>{categoria.nome}</strong>
        {faltas.length === 0 ? <Selo tom="oliva">Completo</Selo> : <Selo tom="ambar">Falta: {faltas.slice(0, 2).join(', ')}{faltas.length > 2 ? '…' : ''}</Selo>}
      </summary>
      <form className="formulario" onSubmit={salvar}>
        <div className="grade-campos">
          {Object.entries(CAMPOS_PERFIL_FISCAL).map(([chave, campo]) => (
            <label key={chave} className="campo">
              <span>{campo.nome} <small className="texto-suave">({campo.ajuda})</small></span>
              <input inputMode="numeric" maxLength={campo.digitos} value={f[chave]} onChange={(e) => setF({ ...f, [chave]: filtroInteiro(e.target.value, campo.digitos), validado: false })} />
            </label>
          ))}
        </div>
        <label className="campo-check">
          <input type="checkbox" checked={f.validado} onChange={(e) => setF({ ...f, validado: e.target.checked })} />
          A contadora conferiu e validou estes dados
        </label>
        {msg && <Aviso tom={msg.tom}>{msg.texto}</Aviso>}
        <button className="botao botao-secundario" disabled={!mudou}>Salvar {categoria.nome}</button>
      </form>
    </details>
  )
}
