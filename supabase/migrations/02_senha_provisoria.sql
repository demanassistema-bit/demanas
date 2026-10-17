-- =====================================================================
-- DEMANAS · 02 · Senha provisória no primeiro acesso
-- =====================================================================
-- Os logins podem ser criados direto no painel do Supabase
-- (Add user → Create new user), com uma senha provisória passada por
-- WhatsApp, sem e-mail de convite.
-- Como quem criou o login conhece essa senha, o sistema pede uma senha
-- nova no primeiro acesso. Quem entra pelo link do convite também cria
-- a senha na hora; nos dois casos a marca é desligada ao salvar.
-- A própria pessoa pode desligar a marca (só vale para ela mesma):
-- não é permissão, é só um lembrete da tela.
-- =====================================================================

alter table public.perfis
  add column senha_provisoria boolean not null default true;

comment on column public.perfis.senha_provisoria is
  'true até a pessoa criar a própria senha. Enquanto true, a tela pede uma senha nova.';
