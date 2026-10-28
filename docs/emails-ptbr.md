# Textos dos e-mails do Supabase em português

Supabase → Authentication → Emails → Templates. Cole o assunto e o corpo de cada um.

## Reauthentication (código para trocar a senha)
**Assunto:** Seu código para trocar a senha

```html
<h2>Código para trocar a senha</h2>
<p>Use este código no Painel de Estudos para criar sua senha nova:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
<p>O código vale por pouco tempo. Se não foi você que pediu, ignore este e-mail: sua senha continua a mesma.</p>
```

## Change Email Address (confirmar a troca de e-mail)
**Assunto:** Confirme a troca do seu e-mail

```html
<h2>Confirme a troca de e-mail</h2>
<p>Pediram para trocar o e-mail da sua conta no Painel de Estudos de <b>{{ .Email }}</b> para <b>{{ .NewEmail }}</b>.</p>
<p>A troca só vale depois de confirmar nos dois e-mails (o atual e o novo).</p>
<p><a href="{{ .ConfirmationURL }}">Confirmar a troca</a></p>
<p>Se não foi você, não clique: o e-mail continua o mesmo. Depois troque sua senha.</p>
```
