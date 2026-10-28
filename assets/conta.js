// Minha conta (Configurações → Minha conta e Meu perfil): o aluno apaga os próprios dados e começa do zero,
// ou exclui a conta. Tudo pelo site, na hora (antes era um e-mail para o administrador).
//   - banco: funções apagar_meus_dados() e excluir_minha_conta() (supabase/13_minha_conta.sql), que só
//     mexem no aluno logado (auth.uid()). O uso de IA do mês, o aceite dos termos e o perfil ficam.
//   - arquivos (Storage): o navegador lista e apaga a pasta do aluno em cada pasta do site
//     (o Supabase não deixa apagar arquivos pelo SQL).
//   - este navegador: a fila de envios (IndexedDB) e as marcações do painel (localStorage/sessionStorage).
// A confirmação pede para escrever APAGAR. A conta de administrador não pode ser excluída por aqui.
(function () {
  const { sb, esc, toast } = App;
  const PASTAS = ["avatares", "laminas", "tarefas"]; // buckets do Storage com pasta por aluno (02, 06 e 08 .sql)
  const PALAVRA = "APAGAR";
  let PERFIL = null, ocupado = false;

  const APAGA = [
    "Matérias, semestres, conteúdos (temas), provas, notas e calendário",
    "Aulas e horários, vida acadêmica (eventos, ligas e horas complementares)",
    "Resumos, mapas mentais, painéis, questões, flash cards e o histórico das questões",
    "Materiais enviados, documentos importados e as tarefas da IA",
    "A ligação com o Google Drive (os arquivos no seu Drive continuam lá) e os livros enviados",
    "Lâminas, foto de perfil e imagens enviadas",
    "Memória de estudo e preferências",
    "O que este navegador guarda do painel: fila de envios, marcações e escolhas",
  ];
  const FICA = [
    "Seu login (e-mail e senha), seu nome e seu nome de usuário",
    "Seu plano, o vencimento e os limites de IA",
    "O aceite dos termos e o uso de IA deste mês (o limite do mês não volta ao zero)",
  ];

  /** Conteúdo do cartão "Minha conta" */
  function html(P) {
    PERFIL = P || PERFIL;
    const admin = !!(PERFIL && PERFIL.is_admin);
    return `<div class="conta stack">
      <p style="margin:0">Conta: <b>${esc(PERFIL?.email || "")}</b></p>
      <div class="conta-op"><h3>Apagar todos os meus dados e começar do zero</h3>
        <p>Apaga tudo o que você colocou no site e deixa o painel como no primeiro dia. Seu login continua: você entra com o mesmo e-mail e a mesma senha e monta o painel de novo.</p>
        <div class="row"><button type="button" class="btn conta-perigo" data-conta="apagar">Apagar meus dados e começar do zero</button></div></div>
      <div class="conta-op"><h3>Excluir minha conta</h3>
        ${admin ? `<div class="msg" style="margin:0">A conta de administrador não pode ser excluída por aqui. Você pode usar "Apagar meus dados e começar do zero".</div>`
          : `<p>Apaga tudo e também o seu login: você não consegue mais entrar. Para voltar a usar o site, precisa de uma conta nova.</p>
        <div class="row"><button type="button" class="btn conta-perigo" data-conta="excluir">Excluir minha conta</button></div>`}</div>
      <p class="muted" style="margin:0;font-size:13px">As duas opções valem na hora e não podem ser desfeitas. Antes, o site mostra tudo o que vai ser apagado e pede para você escrever ${PALAVRA}.</p></div>`;
  }

  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-conta]"); if (!b) return;
    abrir(b.dataset.conta);
  });

  /* ---------- a janela de confirmação ---------- */
  function abrir(modo) {
    if (ocupado || !PERFIL || document.getElementById("contaGate")) return;
    if (modo !== "apagar" && modo !== "excluir") return;
    if (modo === "excluir" && PERFIL.is_admin) return toast("A conta de administrador não pode ser excluída por aqui");
    const excluir = modo === "excluir";
    const fundo = [...document.body.children].filter((x) => !x.inert);
    fundo.forEach((x) => { x.inert = true; x.setAttribute("aria-hidden", "true"); });
    const voltarFoco = document.activeElement;
    const g = document.createElement("div");
    g.className = "gate conta-gate"; g.id = "contaGate";
    g.setAttribute("role", "dialog"); g.setAttribute("aria-modal", "true"); g.setAttribute("aria-labelledby", "contaTit"); g.setAttribute("aria-describedby", "contaDesc");
    g.innerHTML = `<div class="gate-in"><span class="brand">${esc(App.C.NOME_PRODUTO || "Painel de Estudos")}</span>
      <h1 id="contaTit" tabindex="-1">${excluir ? "Excluir minha conta" : "Apagar meus dados"}</h1>
      <p id="contaDesc" style="margin:0 0 4px">${excluir ? "Sua conta e tudo o que você colocou no site vão ser apagados agora." : "Tudo o que você colocou no site vai ser apagado agora. Depois, o site mostra a configuração inicial, como no primeiro dia."} <b>Isso não pode ser desfeito.</b></p>`
      + App.win(excluir ? "Excluir minha conta" : "Apagar meus dados e começar do zero", `<form id="fConta" novalidate>
        <p style="margin:0 0 6px"><b>O que é apagado:</b></p>
        <ul class="conta-lista">${APAGA.map((t) => `<li>${esc(t)}</li>`).join("")}${excluir ? `<li>Seu login: você não consegue mais entrar com este e-mail</li>` : ""}</ul>
        <p class="muted" id="contaResumo" style="margin:6px 0 0;font-size:13.5px"></p>
        <p style="margin:14px 0 6px"><b>O que continua:</b></p>
        ${excluir ? `<p style="margin:0">Nada. Para voltar a usar o site, peça uma conta nova ao administrador.</p>` : `<ul class="conta-lista fica">${FICA.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`}
        <label class="field" style="margin-top:16px"><span class="mono">Para confirmar, escreva ${PALAVRA}</span>
          <input id="contaConf" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="20" aria-describedby="contaFalta"></label>
        <p class="gate-falta" id="contaFalta" aria-live="polite">Escreva ${PALAVRA} para liberar o botão.</p>
        <div id="contaProg" role="status" aria-live="polite"></div>
        <div class="gate-acoes"><button type="button" class="gate-recusar" id="contaCancelar">Cancelar</button>
          <button class="btn solid conta-perigo" id="contaOk" disabled aria-describedby="contaFalta">${excluir ? "Excluir minha conta" : "Apagar tudo e começar do zero"}</button></div></form>`) + `</div>`;
    document.body.appendChild(g);
    const q = (s) => g.querySelector(s);
    const inp = q("#contaConf"), ok = q("#contaOk"), falta = q("#contaFalta");
    let pronto = true; // false: falta o 13_minha_conta.sql
    const confere = () => { const certo = inp.value.trim().toUpperCase() === PALAVRA; ok.disabled = !certo || !pronto || ocupado;
      falta.textContent = !pronto ? "" : certo ? "Confirmado. O botão está liberado." : `Escreva ${PALAVRA} para liberar o botão.`; };
    inp.addEventListener("input", confere);
    const fechar = () => { if (ocupado) return; g.remove(); fundo.forEach((x) => { x.inert = false; x.removeAttribute("aria-hidden"); }); document.removeEventListener("keydown", tecla); voltarFoco?.focus?.(); };
    const tecla = (e) => { if (e.key === "Escape") fechar(); };
    document.addEventListener("keydown", tecla);
    q("#contaCancelar").onclick = fechar;
    q("#fConta").onsubmit = (e) => { e.preventDefault(); if (!ok.disabled) executar(excluir, g, confere); };
    q("#contaTit").focus();
    // quanto tem no banco (e se o 13_minha_conta.sql já rodou)
    sb.rpc("minha_conta_resumo").then(({ data, error }) => {
      if (!document.body.contains(g)) return;
      if (error) {
        if (faltaSql(error)) { pronto = false; q("#contaResumo").innerHTML = `<span class="conta-falta">Ainda não dá para apagar: falta o administrador rodar o arquivo 13_minha_conta.sql no Supabase.</span>`; confere(); }
        return;
      }
      const n = Number(data?.total) || 0;
      q("#contaResumo").textContent = n ? `No banco, isso é ${n.toLocaleString("pt-BR")} ${n === 1 ? "registro" : "registros"} seus, fora as imagens.` : "No banco, você ainda não tem dados guardados.";
    }).catch(() => { });
  }
  const faltaSql = (e) => /minha_conta_resumo|apagar_meus_dados|excluir_minha_conta|schema cache|could not find/i.test(e?.message || "");

  async function executar(excluir, g, confere) {
    const q = (s) => g.querySelector(s), prog = q("#contaProg");
    const passo = (t) => { prog.innerHTML = `<div class="msg" style="margin:10px 0 0">${esc(t)}</div>`; };
    ocupado = true; confere(); q("#contaConf").disabled = true; q("#contaCancelar").disabled = true;
    const uid = PERFIL.id;
    try {
      passo("Parando a fila de envios deste aparelho…");
      try { if (window.Fila && Fila.esvaziar) await Fila.esvaziar(); } catch (_) { }
      if (excluir) { // a conta some no fim: os arquivos saem antes (depois não há mais login para apagar)
        passo("Apagando suas imagens (lâminas, foto e páginas enviadas)…"); await apagarArquivos(uid);
        passo("Excluindo sua conta…"); await rpc("excluir_minha_conta");
      } else {
        passo("Apagando seus dados…"); await rpc("apagar_meus_dados");
        passo("Apagando suas imagens (lâminas, foto e páginas enviadas)…"); await apagarArquivos(uid);
      }
      limparNavegador();
      if (excluir) {
        App.vaiSair();
        try { await sb.auth.signOut({ scope: "local" }); } catch (_) { }
        prog.innerHTML = `<div class="msg" style="margin:10px 0 0"><b>Sua conta foi excluída.</b> Obrigado por ter usado o ${esc(App.C.NOME_PRODUTO || "Painel de Estudos")}. Indo para o início…</div>`;
        q(".gate-acoes").innerHTML = `<span></span><a class="btn solid" href="/" id="contaFim">Ir para o início</a>`;
        q("#contaFim").focus();
        setTimeout(() => { location.href = "/"; }, 4000);
      } else {
        prog.innerHTML = `<div class="msg" style="margin:10px 0 0"><b>Pronto: seus dados foram apagados.</b> Agora você monta o painel do zero, como no primeiro dia.</div>`;
        q(".gate-acoes").innerHTML = `<span></span><a class="btn solid" href="/app.html" id="contaFim">Começar do zero</a>`;
        q("#contaFim").focus();
      }
    } catch (e) {
      ocupado = false;
      prog.innerHTML = `<div class="msg bad" style="margin:10px 0 0">${esc(e.message || "Não consegui apagar agora. Tente de novo.")}</div>`;
      q("#contaConf").disabled = false; q("#contaCancelar").disabled = false; confere();
    }
  }
  async function rpc(nome) {
    const { error } = await sb.rpc(nome);
    if (!error) return;
    if (App.erroDeSessao(error)) { App.conferirSessao(true, "minha_conta"); throw new Error(App.MSG_FIM); }
    if (faltaSql(error)) throw new Error("Falta o administrador rodar o arquivo 13_minha_conta.sql no Supabase. Nada foi apagado do banco.");
    if (/administrador/i.test(error.message || "")) throw new Error("A conta de administrador não pode ser excluída por aqui.");
    throw new Error("Não consegui apagar agora: " + (error.message || "tente de novo em instantes."));
  }
  /** Apaga a pasta do aluno em cada bucket do Storage (lista e remove de 100 em 100) */
  async function apagarArquivos(uid) {
    for (const b of PASTAS) {
      let caminhos;
      try { caminhos = await listar(b, uid, 0); }
      catch (e) { if (/not found|não encontrado|bucket/i.test(e?.message || "")) continue; throw new Error("Não consegui apagar suas imagens: " + App.msgErro(e)); }
      for (let i = 0; i < caminhos.length; i += 100) {
        const { error } = await sb.storage.from(b).remove(caminhos.slice(i, i + 100));
        if (error) throw new Error("Não consegui apagar suas imagens: " + App.msgErro(error));
      }
    }
  }
  async function listar(b, pasta, fundo) {
    const out = [];
    for (let off = 0; ; off += 1000) {
      const { data, error } = await sb.storage.from(b).list(pasta, { limit: 1000, offset: off });
      if (error) throw error;
      for (const it of data || []) {
        const c = `${pasta}/${it.name}`;
        if (it.id == null && !it.metadata && fundo < 4) out.push(...await listar(b, c, fundo + 1)); else out.push(c);
      }
      if ((data || []).length < 1000) break;
    }
    return out;
  }
  /** Tira deste navegador o que o painel guardou (o login fica, para quem só apagou os dados) */
  function limparNavegador() {
    const limpa = (st) => { try { const ks = []; for (let i = 0; i < st.length; i++) { const k = st.key(i); if (/^(painel|tarefas):/.test(k) || k === "recuperando") ks.push(k); } ks.forEach((k) => st.removeItem(k)); } catch (_) { } };
    try { limpa(window.localStorage); } catch (_) { }
    try { limpa(window.sessionStorage); } catch (_) { }
  }

  window.Conta = { html, abrir };
})();
