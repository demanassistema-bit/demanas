import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useDemo } from '../demo/DemoContext'
import { formatarMoeda, formatarPercentual } from '../lib/moeda'
import { formatarData, formatarDataHora } from '../lib/datas'
import { emiteNota, percentual, podeApagarProduto, TIPOS_MOVIMENTO } from '../demo/regras'
import { BotaoPerigo } from '../components/Modal'
import Icone from '../components/Icone'
import { Selo, seloValidade } from '../components/ui'

const NOMES_TIPO = { lingerie: 'Lingerie', cosmetico: 'Cosmético', outro: 'Outro' }

export default function FichaProduto() {
  const { produtoId } = useParams()
  const { dados, linhas, lotesComSaldo, produtoPorId, podeVerCustos, ehProprietaria, atualizarProduto, excluirProduto, reativarProduto } = useDemo()
  const navegar = useNavigate()
  const produto = produtoPorId.get(produtoId)
  if (!produto) return <Navigate to="/produtos" replace />

  const variacoes = linhas.filter((l) => l.produto_id === produto.id)
  const ids = new Set(variacoes.map((v) => v.id))
  const lotes = lotesComSaldo.filter((l) => ids.has(l.variacao_id)).sort((a, b) => a.validade.localeCompare(b.validade))
  const historico = dados.movimentacoes.filter((m) => ids.has(m.variacao_id)).slice(-20).reverse()
  const nomeDe = new Map(variacoes.map((v) => [v.id, v.nomeVariacao]))
  const total = variacoes.reduce((s, v) => s + Math.max(v.saldo, 0), 0)

  return (
    <div className="pagina">
      <Link to="/produtos" className="botao-link voltar"><Icone nome="voltar" tamanho={18} /> Produtos</Link>
      <header className="pagina-topo">
        <div>
          <h1>{produto.nome} {!produto.ativo && <Selo>Arquivado</Selo>}</h1>
          <p className="texto-suave">{NOMES_TIPO[produto.tipo]} · {produto.categoria} · {produto.marca}</p>
        </div>
        <Link to={`/estoque?aba=entrada`} className="botao botao-secundario"><Icone nome="estoque" /> Entrada de estoque</Link>
      </header>

      <section className="cartao secao">
        <header className="bloco-topo">
          <h2>Vende por qual CNPJ</h2>
          <span className="texto-suave pequeno">{emiteNota(dados.config, produto.empresa_id) ? 'sai com nota fiscal' : 'MEI: sai sem nota'}</span>
        </header>
        <div className="segmentado">
          {Object.entries(dados.config.empresas).map(([id, e]) => (
            <button key={id} disabled={!ehProprietaria} className={produto.empresa_id === id ? 'ativo' : ''} onClick={() => atualizarProduto(produto.id, { empresa_id: id })}>{e.apelido}</button>
          ))}
        </div>
        <p className="texto-suave pequeno">O estoque é um só. O CNPJ define em qual maquininha a peça é cobrada e se a venda sai com nota.</p>
      </section>

      <section className="cartao secao">
        <header className="bloco-topo">
          <h2>Variações</h2>
          <span className="texto-suave">{total} peças no total</span>
        </header>
        <ul className="lista variacoes">
          {variacoes.map((v) => (
            <li key={v.id} className="variacao">
              <div className="variacao-nome">
                <strong>{v.nomeVariacao}</strong>
                <small>Código {v.sku}{v.codigo_barras && ` · ${v.codigo_barras}`}</small>
              </div>
              <div className="variacao-numeros">
                <span><small>Preço</small><strong>{formatarMoeda(v.preco)}</strong></span>
                {podeVerCustos && <span><small>Custo</small>{formatarMoeda(v.custo)}</span>}
                {podeVerCustos && <span><small>Margem</small>{formatarPercentual(percentual(v.preco - v.custo, v.preco))}</span>}
                <span>
                  <small>Estoque</small>
                  <strong className={v.saldo <= v.estoque_minimo ? 'texto-alerta' : ''}>{v.saldo}</strong>
                </span>
                <span><small>Mínimo</small>{v.estoque_minimo}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {produto.controla_validade && (
        <section className="cartao secao">
          <h2>Lotes e validade</h2>
          <p className="texto-suave pequeno">A venda sempre tira primeiro do lote que vence antes.</p>
          {lotes.length === 0 ? <p className="texto-suave">Nenhum lote com saldo.</p> : (
            <ul className="lista">
              {lotes.map((l) => (
                <li key={l.id} className="linha-lista">
                  <span><strong>Lote {l.numero} · {nomeDe.get(l.variacao_id)}</strong><small>vence em {formatarData(l.validade)} · {l.saldo} un</small></span>
                  {seloValidade(l.validade) || <Selo tom="neutro">Em dia</Selo>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="cartao secao">
        <h2>Histórico de movimentação</h2>
        <p className="texto-suave pequeno">Cada entrada e saída fica registrada para sempre. O estoque é a soma delas.</p>
        <ul className="lista">
          {historico.map((m) => (
            <li key={m.id} className="linha-lista">
              <span><strong>{TIPOS_MOVIMENTO[m.tipo]} · {nomeDe.get(m.variacao_id)}</strong><small>{formatarDataHora(m.data)} · {m.usuario}{m.motivo && ` · ${m.motivo}`}</small></span>
              <strong className={m.quantidade > 0 ? 'texto-positivo' : 'texto-negativo'}>{m.quantidade > 0 ? `+${m.quantidade}` : m.quantidade}</strong>
            </li>
          ))}
        </ul>
      </section>

      {ehProprietaria && (
        <section className="cartao secao">
          {produto.ativo ? (
            <>
              <h2>Excluir produto</h2>
              {podeApagarProduto(produto.id, dados) ? (
                <p className="texto-suave pequeno">Este produto nunca foi vendido nem teve estoque: pode ser apagado de vez.</p>
              ) : (
                <p className="texto-suave pequeno">
                  Este produto já tem histórico (vendas ou estoque). Ele vai ser <strong>arquivado</strong>: sai das listas e da venda, mas o histórico continua certo. Dá para reativar depois.
                  {total > 0 && ` Ainda há ${total} ${total === 1 ? 'peça' : 'peças'} em estoque: se elas não existem mais, lance uma perda no Estoque antes.`}
                </p>
              )}
              <BotaoPerigo
                texto={podeApagarProduto(produto.id, dados) ? 'Apagar produto' : 'Arquivar produto'}
                aoConfirmar={() => { if (excluirProduto(produto.id) === 'apagado') navegar('/produtos') }}
              />
            </>
          ) : (
            <>
              <h2>Produto arquivado</h2>
              <p className="texto-suave pequeno">Não aparece nas listas nem na venda. O histórico continua guardado.</p>
              <button className="botao botao-secundario" onClick={() => reativarProduto(produto.id)}>Reativar produto</button>
            </>
          )}
        </section>
      )}
    </div>
  )
}
