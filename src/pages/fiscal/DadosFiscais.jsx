import { useState } from 'react'
import { useDemo } from '../../demo/DemoContext'
import { useCatalogo } from '../../contexts/CatalogoContext'
import { hojeISO } from '../../lib/datas'
import { cnpjValido, erroData, filtroInteiro, formatarCNPJ, limparCNPJ, limparTexto, TAMANHO, UFS } from '../../lib/limites'
import { CAMPOS_PERFIL_FISCAL, faltasPerfilFiscal, situacaoCertificado } from '../../demo/regras'
import { Aviso, Selo } from '../../components/ui'

const REGIMES = { '': 'A confirmar com a contadora', mei: 'MEI', simples: 'Simples Nacional', presumido: 'Lucro Presumido', real: 'Lucro Real' }
const PROVEDORES = ['Focus NFe', 'Nuvem Fiscal', 'PlugNotas (Tecnospeed)', 'eNotas', 'Notaas']
const CAMPOS_BANCO = { ncm: 'ncm', cest: 'cest', origem: 'origem', cfop: 'cfop', csosn: 'csosn_ou_cst' }

export default function DadosFiscais() {
  const { dados, atualizarConfig } = useDemo()
  const { empresas, categorias, produtos, perfisFiscais } = useCatalogo()
  // provedor, certificado e "emitir sempre" ainda são da demonstração (Etapa 7)
  const fiscal = dados.config.fiscal
  const salvarDemo = (campos) => atualizarConfig({ fiscal: { ...fiscal, ...campos } })
  const certificado = situacaoCertificado(fiscal.certificadoValidade, hojeISO())
  const emissora = Object.values(empresas).find((e) => e.tipo === 'me')
  const [validadeTexto, setValidadeTexto] = useState(fiscal.certificadoValidade || '')
  const erroValidade = erroData(validadeTexto, { rotulo: 'a validade', min: '2020-01-01', max: '2040-12-31', obrigatoria: false })

  // categorias com produto que sai com nota (CNPJ da ME)
  const idsComNota = new Set(produtos.filter((p) => p.ativo && empresas[p.empresa_id]?.tipo === 'me').map((p) => p.categoria_id))
  const categoriasComNota = categorias.filter((c) => idsComNota.has(c.id))

  return (
    <div className="calculadora">
      <Aviso tom="ambar">Nada aqui deve ser inventado. Preencha com o que a contadora enviar: regime, códigos e alíquotas são decisão dela, não do sistema.</Aviso>

      <section className="cartao secao">
        <h2>Os dois CNPJs da loja</h2>
        <p className="texto-suave pequeno">No dia a dia aparece só o apelido. O número do CNPJ fica guardado aqui.</p>
        {Object.values(empresas).map((e) => <FormEmpresa key={e.id} empresa={e} />)}
      </section>

      <section className="cartao secao">
        <h2>Emissão · {emissora?.apelido}</h2>
        <Aviso tom="ambar">Ainda de demonstração: provedor, certificado e a forma de emitir passam a valer na Etapa 7.</Aviso>
        <div className="grade-campos">
          <label className="campo"><span>Serviço de emissão (provedor)</span>
            <select value={fiscal.provedor} onChange={(e) => salvarDemo({ provedor: e.target.value })}>
              <option value="">Ainda não escolhido</option>
              {PROVEDORES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="campo"><span>Validade do certificado A1 do {emissora?.apelido}</span>
            <input type="date" min="2020-01-01" max="2040-12-31" value={validadeTexto}
              onChange={(e) => { setValidadeTexto(e.target.value); if (!erroData(e.target.value, { min: '2020-01-01', max: '2040-12-31', obrigatoria: false })) salvarDemo({ certificadoValidade: e.target.value }) }} />
            {erroValidade && <small className="texto-alerta">{erroValidade}</small>}
          </label>
        </div>
        <p className="pequeno">{certificado.tom ? <Selo tom={certificado.tom}>{certificado.texto}</Selo> : <Selo tom="oliva">{certificado.texto}</Selo>}</p>
        <div className="campo">
          <span>Emitir nota <small className="decisao">decisão em aberto · confirmar com vocês e a contadora</small></span>
          <div className="segmentado">
            <button className={fiscal.emitir === 'sempre' ? 'ativo' : ''} onClick={() => salvarDemo({ emitir: 'sempre' })}>Em toda venda</button>
            <button className={fiscal.emitir === 'pedido' ? 'ativo' : ''} onClick={() => salvarDemo({ emitir: 'pedido' })}>Só quando pedirem</button>
          </div>
        </div>
        <p className="texto-suave pequeno">O arquivo e a senha do certificado e o CSC da NFC-e ficam guardados só no serviço de emissão, nunca no sistema. Aqui fica apenas a validade, para o aviso de 60, 30 e 15 dias.</p>
      </section>

      <section className="cartao secao">
        <h2>Dados fiscais por categoria</h2>
        <p className="texto-suave pequeno">Cada produto herda os dados da sua categoria. A contadora preenche uma vez e marca como validado. Só aparecem as categorias com produtos do {emissora?.apelido}, que emite nota.</p>
        {categoriasComNota.length === 0 && <p className="texto-suave">Nenhuma categoria ainda: cadastre os produtos primeiro.</p>}
        {categoriasComNota.map((c) => <FormPerfilFiscal key={c.id} categoria={c} perfil={perfisFiscais[c.id]} />)}
      </section>
    </div>
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
