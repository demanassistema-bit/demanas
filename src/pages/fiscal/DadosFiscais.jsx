import { useDemo } from '../../demo/DemoContext'
import { hojeISO } from '../../lib/datas'
import { CAMPOS_PERFIL_FISCAL, faltasPerfilFiscal, situacaoCertificado } from '../../demo/regras'
import { Aviso, Selo } from '../../components/ui'

const REGIMES = { '': 'A confirmar com a contadora', mei: 'MEI', simples: 'Simples Nacional', presumido: 'Lucro Presumido', real: 'Lucro Real' }
const PROVEDORES = ['Focus NFe', 'Nuvem Fiscal', 'PlugNotas (Tecnospeed)', 'eNotas', 'Notaas']

export default function DadosFiscais() {
  const { dados, atualizarConfig } = useDemo()
  const fiscal = dados.config.fiscal
  const salvar = (campos) => atualizarConfig({ fiscal: { ...fiscal, ...campos } })
  const empresa = (chave, valor) => salvar({ empresa: { ...fiscal.empresa, [chave]: valor } })
  const perfil = (categoria, campos) => salvar({ perfis: { ...fiscal.perfis, [categoria]: { ...fiscal.perfis[categoria], ...campos } } })
  const certificado = situacaoCertificado(fiscal.certificadoValidade, hojeISO())
  const categorias = [...new Set(dados.produtos.filter((p) => p.ativo).map((p) => p.categoria))].sort()

  const campoEmpresa = (chave, nome, props = {}) => (
    <label className="campo"><span>{nome}</span><input value={fiscal.empresa[chave]} onChange={(e) => empresa(chave, e.target.value)} {...props} /></label>
  )

  return (
    <div className="calculadora">
      <Aviso tom="ambar">Nada aqui deve ser inventado. Preencha com o que a contadora enviar: regime, códigos e alíquotas são decisão dela, não do sistema.</Aviso>

      <section className="cartao secao">
        <h2>Empresa</h2>
        <div className="grade-campos">
          {campoEmpresa('razao_social', 'Razão social')}
          {campoEmpresa('cnpj', 'CNPJ', { inputMode: 'numeric' })}
          {campoEmpresa('inscricao_estadual', 'Inscrição estadual')}
          <label className="campo"><span>Regime tributário</span>
            <select value={fiscal.empresa.regime} onChange={(e) => empresa('regime', e.target.value)}>
              {Object.entries(REGIMES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </select>
          </label>
          {campoEmpresa('endereco', 'Endereço')}
          {campoEmpresa('municipio', 'Município')}
          {campoEmpresa('uf', 'Estado (UF)', { maxLength: 2 })}
        </div>
        {(fiscal.empresa.regime === 'simples' || fiscal.empresa.regime === 'mei') && (
          <p className="texto-suave pequeno">Reforma tributária: pelas fontes do briefing, Simples e MEI passam a informar IBS e CBS na nota a partir de 4 de janeiro de 2027. Confirmar com a contadora.</p>
        )}
      </section>

      <section className="cartao secao">
        <h2>Emissão</h2>
        <div className="grade-campos">
          <label className="campo"><span>Serviço de emissão (provedor)</span>
            <select value={fiscal.provedor} onChange={(e) => salvar({ provedor: e.target.value })}>
              <option value="">Ainda não escolhido</option>
              {PROVEDORES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="campo"><span>Validade do certificado digital A1</span>
            <input type="date" value={fiscal.certificadoValidade} onChange={(e) => salvar({ certificadoValidade: e.target.value })} />
          </label>
        </div>
        <p className="pequeno">{certificado.tom ? <Selo tom={certificado.tom}>{certificado.texto}</Selo> : <Selo tom="oliva">{certificado.texto}</Selo>}</p>
        <div className="campo">
          <span>Emitir nota <small className="decisao">decisão em aberto · confirmar com vocês e a contadora</small></span>
          <div className="segmentado">
            <button className={fiscal.emitir === 'sempre' ? 'ativo' : ''} onClick={() => salvar({ emitir: 'sempre' })}>Em toda venda</button>
            <button className={fiscal.emitir === 'pedido' ? 'ativo' : ''} onClick={() => salvar({ emitir: 'pedido' })}>Só quando pedirem</button>
          </div>
        </div>
        <p className="texto-suave pequeno">O arquivo e a senha do certificado e o CSC da NFC-e ficam guardados só no serviço de emissão, nunca no sistema. Aqui fica apenas a validade, para o aviso de 60, 30 e 15 dias.</p>
      </section>

      <section className="cartao secao">
        <h2>Dados fiscais por categoria</h2>
        <p className="texto-suave pequeno">Cada produto herda os dados da sua categoria. A contadora preenche uma vez e marca como validado.</p>
        {categorias.map((cat) => {
          const p = fiscal.perfis[cat] || {}
          const faltas = faltasPerfilFiscal(p)
          return (
            <details key={cat} className="perfil-fiscal">
              <summary>
                <strong>{cat}</strong>
                {faltas.length === 0 ? <Selo tom="oliva">Completo</Selo> : <Selo tom="ambar">Falta: {faltas.slice(0, 2).join(', ')}{faltas.length > 2 ? '…' : ''}</Selo>}
              </summary>
              <div className="grade-campos">
                {Object.entries(CAMPOS_PERFIL_FISCAL).map(([chave, campo]) => (
                  <label key={chave} className="campo">
                    <span>{campo.nome} <small className="texto-suave">({campo.ajuda})</small></span>
                    <input inputMode="numeric" value={p[chave] || ''} onChange={(e) => perfil(cat, { [chave]: e.target.value, validado: false })} />
                  </label>
                ))}
              </div>
              <label className="campo-check">
                <input type="checkbox" checked={Boolean(p.validado)} onChange={(e) => perfil(cat, { validado: e.target.checked })} />
                A contadora conferiu e validou estes dados
              </label>
            </details>
          )
        })}
      </section>
    </div>
  )
}
