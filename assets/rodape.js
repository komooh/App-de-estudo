// Rodapé comum a todas as páginas. Lê o contato de assets/config.js.
(function () {
  const C = window.APP_CONFIG || {};
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const mail = (assunto) => `mailto:${C.CONTATO_EMAIL}?subject=${encodeURIComponent(assunto)}`;
  const zap = C.CONTATO_WHATSAPP ? `https://wa.me/${C.CONTATO_WHATSAPP}` : "";
  const col = (titulo, links) => `<nav class="rd-col" aria-label="${esc(titulo)}"><h4>${esc(titulo)}</h4>${links.filter(Boolean).map(([t, h, ext]) => `<a href="${esc(h)}"${ext ? ' target="_blank" rel="noopener"' : ""}>${esc(t)}</a>`).join("")}</nav>`;
  // Créditos (config.js): cada linha só aparece se o campo estiver preenchido
  const insp = C.CREDITO_INSPIRACAO || {};
  const handle = String(insp.instagram || "").trim().replace(/^@/, "");
  const handleOk = /^[A-Za-z0-9._]{1,30}$/.test(handle);
  const creditos = [
    C.CRIADOR && `<p>Ideia e criação do projeto: ${esc(C.CRIADOR)}</p>`,
    C.DESENVOLVIDO_COM && `<p>${esc(C.DESENVOLVIDO_COM)}</p>`,
    String(insp.nome || "").trim() && `<p>Inspirado no trabalho de ${esc(String(insp.nome).trim())}${handleOk ? ` (<a href="https://instagram.com/${encodeURIComponent(handle)}" target="_blank" rel="noopener noreferrer">@${esc(handle)}</a> no Instagram)` : ""}</p>`,
  ].filter(Boolean);
  const html = `<footer class="rodape"><div class="rd-in">
    <div class="rd-marca"><a class="brand" href="/">${esc(C.NOME_PRODUTO || "Painel de Estudos")}</a>
      <p>Organize matérias, provas, notas e revisões do seu semestre em um só lugar.</p></div>
    ${col("Produto", [["Entrar", "/"], ["Meu painel", "/app.html"]])}
    ${col("Ajuda", [zap && ["Quero assinar", zap + "?text=" + encodeURIComponent("Olá! Quero assinar o Painel de Estudos."), true], C.CONTATO_EMAIL && ["Ajuda por e-mail", mail("Ajuda com o Painel de Estudos")]])}
    ${col("Legal", [["Termos de uso", "/termos.html"], ["Política de privacidade", "/privacidade.html"], C.CONTATO_EMAIL && ["Excluir minha conta", mail("Excluir minha conta e meus dados")]])}
    ${col("Contato", [zap && ["WhatsApp", zap, true], C.CONTATO_EMAIL && [C.CONTATO_EMAIL, "mailto:" + C.CONTATO_EMAIL]])}
  </div>${creditos.length ? `<div class="rd-creditos">${creditos.join("")}</div>` : ""}<div class="rd-base"><span>© ${new Date().getFullYear()} ${esc(C.RESPONSAVEL || "")}</span><span>Resumos e questões são gerados por IA e podem conter erros.</span></div></footer>`;
  const alvo = document.getElementById("rodape");
  if (alvo) alvo.outerHTML = html; else document.body.insertAdjacentHTML("beforeend", html);
  document.querySelectorAll("[data-contato=email]").forEach((el) => { el.innerHTML = `<a href="mailto:${esc(C.CONTATO_EMAIL)}">${esc(C.CONTATO_EMAIL)}</a>`; });
  document.querySelectorAll("[data-contato=telefone]").forEach((el) => { el.innerHTML = zap ? `<a href="${zap}" target="_blank" rel="noopener">pelo WhatsApp</a>` : ""; });
  document.querySelectorAll("[data-contato=responsavel]").forEach((el) => { el.textContent = C.RESPONSAVEL || ""; });
})();
