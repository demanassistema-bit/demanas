# deManas | Sistema de Gestão e Estoque

Sistema web para a loja deManas, de cosméticos e lingeries (poucos usuários, uma loja). Celular primeiro.
Briefing completo em `docs/ESPECIFICACAO.md`. Siga as etapas na ordem, sem antecipar.

## Independência
O deManas é um sistema totalmente independente dos sistemas da B Mídia (Baluarte e Belarte).
Projeto Supabase próprio (`demanas`), repositório próprio, endereço próprio, usuários próprios.
Nunca compartilhar projeto, chaves, usuários, organização ou dados com outro sistema.
Nunca usar o nome, a paleta ou a identidade da B Mídia: a marca aqui é deManas.

## Plano do Supabase
Começa no plano grátis para teste e vai para o Pro antes do uso real. Nada no código pode
depender do plano grátis. Limites ficam numa configuração fácil de trocar.

## Referência de código (só leitura)
O Baluarte é referência de stack e de padrões de código, apenas para ler e copiar a forma de fazer.
Antes de escrever qualquer coisa, leia: `C:\Users\bruna\baluarte`
(cópia em `Segundo Cérebro\Projetos\Baluarte\código`). Repita os padrões: React + Vite (.jsx),
react-router-dom, Supabase com RLS, migrations numeradas e comentadas, `src/lib` (supabase.js com
traduzirErro, moeda.js, datas.js, useAutoSalvar, useTempoReal), AreaProtegida, tema claro e escuro,
convite por e-mail sem cadastro aberto, publicação por GitHub Actions no GitHub Pages.

## Princípios
- Tudo em português: tela, tabelas, colunas, funções, comentários. Sem jargão à vista.
- Simples e rápido. Registrar uma venda deve levar menos de 30 segundos.
- Estoque é livro-razão: saldo sempre calculado de `movimentacoes_estoque`. Nunca editar saldo,
  nunca alterar movimentação antiga. Corrigir é lançar nova movimentação.
- Dinheiro em `numeric(12,2)`, nunca float. Fuso America/Sao_Paulo. Moeda BRL.
- Nunca apagar vendas, compras ou movimentações. Cancelar gera estorno.
- Custo e preço são copiados para o item da venda no momento da venda.
- Permissões garantidas pelo banco (RLS), não só pela tela.

## Fiscal
- Nunca implementar assinatura de XML nem comunicação com SEFAZ à mão. Usar serviço de emissão
  por API, atrás da interface ProvedorFiscal, chamado por Supabase Edge Functions.
- Chave do provedor só em secrets do Supabase. O certificado A1 fica só no provedor.
- Regime, alíquotas e códigos tributários são configuração validada pela contabilidade.
- Padrão é homologação. Nunca emitir em produção sem ordem explícita.
- Emissão assíncrona: a venda nunca depende da SEFAZ responder.
- Segredo, senha, token ou certificado jamais em código, log, tela, .env versionado ou repositório.

## Identidade visual
Caramelo #9B5504 (ação principal), creme #F3D7B2 (apoio), fundo creme claro, cartões branco quente.
Fonte sans serif geométrica. Logo em /public. Alertas em tons terrosos. Contraste WCAG AA.
Confira a cor renderizada contra o hex.

## Como trabalhar
- Antes de cada etapa: propor plano curto e esperar aprovação.
- Mudança de banco sempre por migration nova, numerada, com cabeçalho explicando o módulo.
- Regras de estoque, venda e financeiro têm teste. Avise quando algo só puder ser testado por mim.
- Não instalar dependência nova sem justificar.
- Ao terminar: o que foi feito, como testar, o que falta. Atualize a nota do projeto no Obsidian.
- Os passos que dependem das minhas contas (Supabase, GitHub, publicar) são meus. Explique cada
  clique, um de cada vez, com o caminho exato do menu.

## Fora do escopo por enquanto
Integração com Instagram, comissões, multi-loja, NFS-e.
