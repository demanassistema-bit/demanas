# Como ligar o serviço de emissão de verdade (Focus NFe)

Só depois que as irmãs aprovarem a contratação. Até lá, a nota fiscal roda com o serviço **simulado**
(sem contratar nada, sem valor fiscal), processado pela própria tela Nota fiscal.

Tudo continua em **homologação** (teste). Produção exige uma migration nova, com ordem explícita,
depois da contadora conferir as notas de teste.

## 1. Na Focus NFe (conta com o e-mail da loja)
1. Criar a conta e escolher o plano (recomendado: Retail).
2. Cadastrar a empresa do CNPJ Day, enviar o certificado A1 e o CSC da NFC-e **no painel da Focus**
   (o sistema nunca guarda certificado, senha ou CSC).
3. Copiar o **token de homologação**.

## 2. No Supabase (projeto `demanas`)
```
npx supabase login
npx supabase link --project-ref kcrhewzxpklwevctqosx
npx supabase secrets set FOCUS_TOKEN=<token de homologação> FISCAL_CHAVE=<uma senha longa, inventada>
npx supabase functions deploy fiscal --no-verify-jwt
```
`--no-verify-jwt` porque quem chama é o agendador e o aviso da Focus; a função confere a `FISCAL_CHAVE`.

## 3. Agendar a fila (a cada minuto)
No SQL Editor, com as extensões `pg_cron` e `pg_net` ligadas (Database → Extensions):
```sql
select cron.schedule('fila-fiscal', '* * * * *', $$
  select net.http_post(
    url := 'https://kcrhewzxpklwevctqosx.supabase.co/functions/v1/fiscal/processar',
    headers := jsonb_build_object('x-chave-fiscal', '<a mesma FISCAL_CHAVE>')
  )
$$);
```

## 4. Na Focus: aviso de retorno (webhook)
URL: `https://kcrhewzxpklwevctqosx.supabase.co/functions/v1/fiscal/retorno?chave=<FISCAL_CHAVE>`

## 5. No sistema
Em Nota fiscal → Dados fiscais, trocar o serviço para **Focus NFe** (a opção é liberada no código
quando chegar a hora: `src/pages/fiscal/DadosFiscais.jsx`, `disabled={k === 'focus'}`).
Fazer algumas vendas de teste e conferir com a contadora antes de qualquer conversa sobre produção.
