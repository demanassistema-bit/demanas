import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useCatalogo } from '../contexts/CatalogoContext'
import { filtroInteiro, filtroTelefone, formatarWhatsApp, lerInteiro, limparTexto, linkWhatsApp, TAMANHO, whatsappValido } from '../lib/limites'
import Modal from '../components/Modal'
import Icone from '../components/Icone'
import { Aviso, Selo, Vazio } from '../components/ui'

export default function Fornecedores() {
  const { permissoes } = useAuth()
  const { fornecedores, carregando } = useCatalogo()
  const [aberto, setAberto] = useState(null) // fornecedor, ou {} para novo
  const [inativos, setInativos] = useState(false)
  if (!permissoes.admin) return <Navigate to="/" replace />
  const lista = fornecedores.filter((f) => f.ativo !== inativos)

  return (
    <div className="pagina pagina-estreita">
      <header className="pagina-topo">
        <div>
          <h1>Fornecedores</h1>
          <p className="texto-suave">De quem a loja compra. Aparecem na entrada de estoque e nas contas a pagar.</p>
        </div>
        <button className="botao botao-principal" onClick={() => setAberto({})}><Icone nome="somar" /> Novo fornecedor</button>
      </header>
      <div className="fichas">
        <button className={`ficha ${!inativos ? 'ativo' : ''}`} onClick={() => setInativos(false)}>Ativos</button>
        <button className={`ficha ${inativos ? 'ativo' : ''}`} onClick={() => setInativos(true)}>Inativos ({fornecedores.filter((f) => !f.ativo).length})</button>
      </div>
      {carregando ? <p className="texto-suave">Carregando…</p> : lista.length === 0 ? <Vazio icone="estoque" titulo="Nenhum fornecedor aqui" /> : (
        <ul className="cartao lista">
          {lista.map((f) => (
            <li key={f.id}>
              <button className="linha-lista linha-botao" onClick={() => setAberto(f)}>
                <span><strong>{f.nome}</strong><small>{[f.whatsapp, f.prazo_dias != null && `prazo de ${f.prazo_dias} dias`].filter(Boolean).join(' · ') || 'sem contato'}</small></span>
                {!f.ativo && <Selo>Inativo</Selo>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {aberto && <EditarFornecedor fornecedor={aberto} aoFechar={() => setAberto(null)} />}
    </div>
  )
}

function EditarFornecedor({ fornecedor, aoFechar }) {
  const { fornecedores, salvarFornecedor } = useCatalogo()
  const [f, setF] = useState({
    nome: fornecedor.nome || '', documento: fornecedor.documento || '', whatsapp: fornecedor.whatsapp || '', email: fornecedor.email || '',
    prazo: fornecedor.prazo_dias != null ? String(fornecedor.prazo_dias) : '', observacao: fornecedor.observacao || '', ativo: fornecedor.ativo ?? true,
  })
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function salvar(e) {
    e.preventDefault()
    const nome = limparTexto(f.nome)
    if (nome.length < 2) return setErro('Informe o nome do fornecedor.')
    if (fornecedores.some((x) => x.id !== fornecedor.id && limparTexto(x.nome).toLocaleLowerCase('pt-BR') === nome.toLocaleLowerCase('pt-BR'))) return setErro('Já existe um fornecedor com esse nome.')
    if (!whatsappValido(f.whatsapp)) return setErro('WhatsApp incompleto: coloque o DDD e o número.')
    if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) return setErro('O e-mail parece incompleto.')
    const prazo = lerInteiro(f.prazo, { rotulo: 'o prazo', min: 0, max: 365, obrigatorio: false })
    if (prazo.erro) return setErro(prazo.erro)
    setSalvando(true)
    const r = await salvarFornecedor({
      ...(fornecedor.id ? { id: fornecedor.id } : {}),
      nome, documento: limparTexto(f.documento), whatsapp: f.whatsapp ? formatarWhatsApp(f.whatsapp) : '', email: f.email.trim(),
      prazo_dias: f.prazo.trim() ? prazo.valor : null, observacao: limparTexto(f.observacao), ativo: f.ativo,
    })
    setSalvando(false)
    if (r.erro) return setErro(r.erro)
    aoFechar()
  }

  return (
    <Modal titulo={fornecedor.id ? fornecedor.nome : 'Novo fornecedor'} aoFechar={aoFechar}
      rodape={<><button className="botao botao-fantasma" onClick={aoFechar}>Cancelar</button><button className="botao botao-principal" form="form-fornecedor" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button></>}>
      <form id="form-fornecedor" className="formulario" onSubmit={salvar}>
        <label className="campo"><span>Nome</span><input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} maxLength={TAMANHO.fornecedor} autoFocus /></label>
        <div className="grade-campos">
          <label className="campo"><span>WhatsApp</span><input inputMode="tel" value={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: filtroTelefone(e.target.value) })} placeholder="(00) 00000-0000" /></label>
          <label className="campo"><span>E-mail</span><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} maxLength={TAMANHO.email} /></label>
          <label className="campo"><span>CNPJ ou CPF (opcional)</span><input value={f.documento} onChange={(e) => setF({ ...f, documento: e.target.value.replace(/[^0-9A-Za-z./-]/g, '') })} maxLength={18} /></label>
          <label className="campo"><span>Prazo para pagar (dias)</span><input inputMode="numeric" value={f.prazo} onChange={(e) => setF({ ...f, prazo: filtroInteiro(e.target.value, 3) })} placeholder="Ex.: 30" /></label>
        </div>
        <label className="campo"><span>Observação</span><input value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} maxLength={TAMANHO.observacao} placeholder="Ex.: pedido mínimo de R$ 500" /></label>
        {fornecedor.id && <label className="campo-check"><input type="checkbox" checked={!f.ativo} onChange={(e) => setF({ ...f, ativo: !e.target.checked })} /> Não compro mais dele (inativo)</label>}
        {fornecedor.id && fornecedor.whatsapp && <a className="botao-link" href={linkWhatsApp(fornecedor.whatsapp, 'Olá! Aqui é da deManas.')} target="_blank" rel="noreferrer"><Icone nome="conversa" tamanho={16} /> Abrir conversa</a>}
        {erro && <Aviso tom="vinho">{erro}</Aviso>}
      </form>
    </Modal>
  )
}
