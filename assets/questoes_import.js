// Questões: responder cada tipo (marcar X com uma ou mais corretas, verdadeiro ou falso, relacionar, aberta e
// caso clínico com várias perguntas) e "Importar do professor" (o aluno manda as questões que o professor passou,
// a IA só copia para o site, o aluno confere e salva).
// O painel (assets/painel.js) chama window.Questoes com um "ctx" (o estado e as funções dele); nada aqui guarda
// dados do aluno fora da tela. Todo texto do aluno, do professor ou da IA passa por esc() ou pelo DOMPurify (md).
//
// Para outras partes do site: window.Painel.importarQuestoes(files, opts) abre a importação já com os arquivos
// (opts: {disciplina_id, tema_id, tema, texto, ler: true para começar a leitura na hora}).
(function () {
  "use strict";
  const LET = "abcdefghijklmn";
  const TIPOS = { mc: "Marcar X", vf: "Verdadeiro ou falso", rel: "Relacionar", dis: "Aberta", caso: "Caso clínico" };
  const SUBTIPOS = ["mc", "vf", "rel", "dis"];
  const esc = (s) => window.App.esc(s);

  /* ================= estilos (ficam aqui para não mexer no style.css) ================= */
  function estilos() {
    if (document.getElementById("questoes-css")) return;
    const st = document.createElement("style"); st.id = "questoes-css";
    st.textContent = `
.qmix{grid-template-columns:repeat(5,minmax(0,1fr))}
.qprof{background:var(--navy-s);color:var(--navy)}
.qsem{background:#F6E9CC;color:var(--warn)}
.qfiltros{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.qfiltros select{max-width:260px}
.qcaso-txt{white-space:pre-line;overflow-wrap:anywhere;font-size:15.5px;line-height:1.55;background:var(--card2);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:8px 0 4px}
.qsub{border-top:1px dashed var(--line);margin-top:16px;padding-top:12px}
.qsub h4{font-size:15.5px;line-height:1.4;margin:0;white-space:pre-line;overflow-wrap:anywhere}
.qsub h4 .mono{margin-right:6px}
.qsug{margin-top:12px;padding:12px 14px;border-radius:10px;border:1px dashed var(--line);font-size:14px;overflow-wrap:anywhere}
.qsug b{display:block;margin-bottom:4px}
.qia{background:var(--navy-s)}
.qauto{display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:flex-end;margin-top:10px}
.qpontos{margin:6px 0 0;padding-left:20px}
.opt[aria-pressed="true"]{border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink)}
.opt.picked{border-color:var(--navy);background:var(--navy-s)}
.qi-form{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.qi-form .full{grid-column:1/-1}
.qi-arqs{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.qi-arq{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:8px;padding:3px 4px 3px 9px;font-size:13px;max-width:100%;overflow-wrap:anywhere}
.qi-arq button{border:0;background:none;font-size:16px;line-height:1;padding:2px 6px;color:var(--muted)}
.qi-rev{margin-top:18px;border-top:1px solid var(--line);padding-top:14px;display:flex;flex-direction:column;gap:12px}
.qi-top{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
.qi-card{border:1px solid var(--line);border-radius:12px;padding:12px;background:var(--card);display:flex;flex-direction:column;gap:8px;min-width:0}
.qi-card.off{opacity:.55}
.qi-card.erro{border-color:var(--bad)}
.qi-card .linha{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.qi-card textarea,.qi-card input[type=text],.qi-card select{background:var(--card2);border:1px solid var(--line);border-radius:8px;padding:7px 9px;width:100%;min-width:0;font:inherit;font-size:14px}
.qi-card select{width:auto}
.qi-card label.campo{display:flex;flex-direction:column;gap:3px;min-width:0;font-size:13px}
.qi-sub{border:1px dashed var(--line);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px}
.qi-erro{color:var(--bad);font-size:13px}
@media (max-width:760px){.qmix{grid-template-columns:repeat(2,minmax(0,1fr))}.qi-form{grid-template-columns:1fr}}`;
    document.head.appendChild(st);
  }

  /* ================= responder ================= */
  // Itens de uma questão: a própria questão, ou as perguntas do caso clínico.
  function itensDe(q) {
    if (q.tipo === "caso") return (Array.isArray(q.subs) ? q.subs : []).map((s, i) => ({ ...s, k: "s" + i, sub: i }));
    return [{ ...q, tipo: TIPOS[q.tipo] && q.tipo !== "caso" ? q.tipo : (Array.isArray(q.opcoes) ? "mc" : "dis"), k: "m", sub: null }];
  }
  /** Gabarito que vale para o item: o do professor/IA geradora; sem ele, a sugestão da IA (se o aluno pediu); senão null. */
  function gabarito(q, it) {
    if (!it.sem_gabarito) {
      if (it.tipo === "mc") return Array.isArray(it.corretas) && it.corretas.length > 1 ? { corretas: it.corretas } : Number.isInteger(it.correta) ? { correta: it.correta } : null;
      if (it.tipo === "vf") return (it.afirmativas || []).every((a) => typeof a.v === "boolean") ? { v: (it.afirmativas || []).map((a) => a.v) } : null;
      if (it.tipo === "rel") return Array.isArray(it.pares) && it.pares.length === (it.colA || []).length ? { pares: it.pares } : null;
      if (it.tipo === "dis") return it.resposta ? { resposta: it.resposta, pontos: it.pontos || [] } : null;
      return null;
    }
    const s = q.sugestao_ia ? (it.sub == null ? q.sugestao_ia : (q.sugestao_ia.subs || [])[it.sub]) : null;
    if (!s) return null;
    return { ...s, porIA: true, pontos: s.pontos || [] };
  }
  const temSugestaoPendente = (q) => !!(q.sem_gabarito && !q.sugestao_ia);
  function estado(ctx, q) {
    const ui = ctx.ui;
    if (!ui.qst || ui.qst.id !== q.id || !ui.qst.it) ui.qst = { id: q.id, it: {}, final: false };
    return ui.qst;
  }
  function est(st, k) { return st.it[k] || (st.it[k] = { pick: null, picks: [], vf: {}, rel: {}, txt: "", done: false, res: null, ver: false, ia: null }); }
  const fb = (ok, html) => `<div class="fb ${ok ? "" : "bad"}">${html}</div>`;
  const fbNeutro = (html) => `<div class="qsug">${html}</div>`;
  const rotIA = `<span class="qtipo qia">sugestão da IA</span>`;
  const notaTxt = { certo: "Acertei", parcial: "Acertei em parte", errado: "Errei" };

  function itemHTML(ctx, q, it, st) {
    const s = est(st, it.k), g = gabarito(q, it), k = it.k, md = ctx.md;
    const expl = (it.explicacao || (it.sub == null ? q.explicacao : "")) || "";
    const porIA = g && g.porIA ? ` ${rotIA}` : "";
    const explHTML = (g && g.porIA ? g.explicacao : expl) ? ` ${esc(g && g.porIA ? g.explicacao : expl)}` : "";
    if (it.tipo === "mc") {
      const multi = !!(g && Array.isArray(g.corretas));
      const certas = g ? (multi ? g.corretas : [g.correta]) : [];
      const opts = (it.opcoes || []).map((o, i) => {
        let c = "", pressed = "";
        if (multi && !s.done) pressed = ` aria-pressed="${s.picks.includes(i)}"`;
        if (s.done && g) { if (certas.includes(i)) c = "right"; else if (multi ? s.picks.includes(i) : i === s.pick) c = "wrong"; }
        else if (s.done && i === s.pick) c = "picked";
        return `<button type="button" class="opt ${c}" data-a="qxMc" data-k="${k}" data-i="${i}"${pressed} ${s.done ? "disabled" : ""}><span class="l">${LET[i].toUpperCase()}</span><span>${esc(o)}</span></button>`;
      }).join("");
      let fim = "";
      if (multi && !s.done) fim = `<div class="qauto"><span class="muted" style="font-size:13.5px">Mais de uma correta: marque todas.</span><button type="button" class="btn solid" data-a="qxMcCheck" data-k="${k}" ${s.picks.length ? "" : "disabled"}>Corrigir</button></div>`;
      else if (s.done && g) fim = fb(s.res === "certo", `<b>${s.res === "certo" ? "Correto!" : "Não foi dessa vez."}</b>${porIA}${multi ? ` Corretas: ${certas.map((i) => LET[i].toUpperCase()).join(", ")}.` : ""}${explHTML}`);
      else if (s.done) fim = fbNeutro(`<b>Sem gabarito do professor.</b>Você marcou ${LET[s.pick].toUpperCase()}. ${temSugestaoPendente(q) ? "Peça uma sugestão à IA abaixo, se quiser." : ""}`);
      return opts + fim;
    }
    if (it.tipo === "vf") {
      const af = it.afirmativas || [], all = af.every((_, i) => s.vf[i] != null), v = g ? g.v || [] : null;
      const rows = af.map((a, i) => {
        const pick = s.vf[i], cls = s.done && v ? (pick === !!v[i] ? "right" : "wrong") : "";
        const porque = a.porque || "";
        return `<div class="vfrow ${cls}"><span class="l mono" style="flex:none;padding-top:2px">${af.length > 1 ? i + 1 : ""}</span><span class="txt">${esc(a.texto)}${s.done && v ? `<span class="why"><b>${v[i] ? "Verdadeira" : "Falsa"}.</b> ${esc(porque)}</span>` : ""}</span>
        <span class="vfb"><button type="button" data-a="qxVf" data-k="${k}" data-i="${i}" data-v="1" aria-pressed="${pick === true}" ${s.done ? "disabled" : ""} aria-label="Verdadeiro">V</button><button type="button" data-a="qxVf" data-k="${k}" data-i="${i}" data-v="0" aria-pressed="${pick === false}" ${s.done ? "disabled" : ""} aria-label="Falso">F</button></span></div>`;
      }).join("");
      const nOk = v ? af.filter((_, i) => s.vf[i] === !!v[i]).length : 0;
      return rows + (!s.done ? `<div class="qauto"><button type="button" class="btn solid" data-a="qxVfCheck" data-k="${k}" ${all ? "" : "disabled"}>${g ? "Corrigir" : "Conferir"}</button></div>`
        : v ? fb(nOk === af.length, `<b>${af.length > 1 ? `${nOk} de ${af.length} certas.` : nOk ? "Correto!" : "Não foi dessa vez."}</b>${porIA}${explHTML}`)
        : fbNeutro(`<b>Sem gabarito do professor.</b>${temSugestaoPendente(q) ? "Peça uma sugestão à IA abaixo, se quiser." : ""}`));
    }
    if (it.tipo === "rel") {
      const A = it.colA || [], B = it.colB || [], P = g ? g.pares : null; const all = A.every((_, i) => s.rel[i] != null && s.rel[i] !== "");
      const left = A.map((a, i) => {
        const pick = s.rel[i], ok = s.done && P && +pick === P[i];
        return `<div class="relitem ${s.done && P ? (ok ? "right" : "wrong") : ""}"><select data-a="qxRel" data-k="${k}" data-i="${i}" aria-label="Par de ${esc(a)}" ${s.done ? "disabled" : ""}><option value="">—</option>${B.map((_, j) => `<option value="${j}" ${pick !== undefined && pick !== "" && +pick === j ? "selected" : ""}>${LET[j]}</option>`).join("")}</select><span style="flex:1;min-width:0">${esc(a)}${s.done && P && !ok ? `<span class="why" style="display:block;font-size:12.5px;color:var(--muted)">Certo: ${LET[P[i]]}</span>` : ""}</span></div>`;
      }).join("");
      const right = B.map((b, j) => `<div class="relitem"><span class="lt">${LET[j]}</span><span style="flex:1;min-width:0">${esc(b)}</span></div>`).join("");
      const nOk = P ? A.filter((_, i) => +s.rel[i] === P[i]).length : 0;
      return `<div class="relgrid"><div class="relcol"><span class="mono">Coluna 1 · escolha a letra</span>${left}</div><div class="relcol"><span class="mono">Coluna 2</span>${right}</div></div>`
        + (!s.done ? `<div class="qauto"><button type="button" class="btn solid" data-a="qxRelCheck" data-k="${k}" ${all ? "" : "disabled"}>${P ? "Corrigir" : "Conferir"}</button></div>`
          : P ? fb(nOk === A.length, `<b>${nOk} de ${A.length} pares certos.</b>${porIA}${explHTML}`) : fbNeutro(`<b>Sem gabarito do professor.</b>${temSugestaoPendente(q) ? "Peça uma sugestão à IA abaixo, se quiser." : ""}`));
    }
    // aberta (dissertativa)
    const idTxt = `disTxt-${k}`;
    const txt = `<textarea class="distxt" id="${idTxt}" data-a="qxTxt" data-k="${k}" data-qid="${q.id}" aria-label="Sua resposta" placeholder="Escreva sua resposta como na prova…" ${s.done || s.ver ? "readonly" : ""}>${esc(s.txt)}</textarea>`;
    let corpo = "";
    if (s.ia) corpo += `<div class="fb ${s.ia.nota === "certo" ? "" : "bad"}"><b>Correção da IA: ${esc(notaTxt[s.ia.nota] || s.ia.nota)}.</b> ${esc(s.ia.feedback)}${s.ia.faltou && s.ia.faltou.length ? `<ul class="qpontos">${s.ia.faltou.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</div>`;
    if (s.ver || s.done) {
      corpo += g ? `<div class="fb"><b>Resposta esperada${g.porIA ? "" : ":"}</b>${porIA}<div class="resumo" style="font-size:14px">${md(g.resposta || "")}</div>${(g.pontos || []).length ? `<b style="display:block;margin-top:6px">Pontos-chave:</b><ul class="qpontos">${g.pontos.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}${explHTML ? `<p style="margin:6px 0 0">${explHTML.trim()}</p>` : ""}</div>`
        : fbNeutro(`<b>Sem gabarito do professor.</b>${temSugestaoPendente(q) ? "Peça uma sugestão à IA abaixo, ou use “Corrigir com IA”." : ""}`);
    }
    const busy = ctx.ui.qxBusy === `${q.id}:${k}`;
    const botIA = typeof q.id === "number" || /^\d+$/.test(String(q.id)) ? `<button type="button" class="btn" data-a="qxCorrigir" data-k="${k}" ${busy ? "disabled" : ""} title="Gasta 1 do limite de questões do mês">${busy ? "Corrigindo…" : "Corrigir com IA"}</button>` : "";
    let acoes = "";
    if (!s.done && !s.ver) acoes = `<div class="qauto">${botIA}<button type="button" class="btn solid" data-a="qxVer" data-k="${k}">Ver resposta</button></div>`;
    else if (!s.done) acoes = `<div class="qauto">${s.ia ? "" : botIA}<span class="muted" style="font-size:13.5px">Compare com a sua resposta:</span>`
      + (g ? `<button type="button" class="btn" data-a="qxNota" data-k="${k}" data-v="errado" style="color:var(--bad);border-color:var(--bad)">Errei</button><button type="button" class="btn" data-a="qxNota" data-k="${k}" data-v="parcial">Acertei em parte</button><button type="button" class="btn solid" data-a="qxNota" data-k="${k}" data-v="certo">Acertei</button>`
        : `<button type="button" class="btn solid" data-a="qxNota" data-k="${k}" data-v="sem">Marcar como respondida</button>`) + `</div>`;
    return txt + corpo + acoes;
  }

  /** O corpo da questão (abaixo do enunciado, ou o caso clínico inteiro). */
  function corpo(ctx, q) {
    estilos();
    const st = estado(ctx, q), its = itensDe(q);
    let h = "";
    if (q.tipo === "caso") {
      h = its.map((it, i) => `<section class="qsub" aria-label="Pergunta ${i + 1} do caso"><h4><span class="mono">${i + 1}.</span>${esc(it.enunciado)}<span class="qtipo">${TIPOS[it.tipo] || ""}</span></h4>${itemHTML(ctx, q, it, st)}</section>`).join("");
    } else h = itemHTML(ctx, q, its[0], st);
    // fim: resumo do caso e a sugestão da IA para o que veio sem gabarito
    const feitos = its.filter((it) => est(st, it.k).res);
    if (q.tipo === "caso" && feitos.length === its.length) {
      const avaliados = its.filter((it) => est(st, it.k).res !== "sem"), certos = avaliados.filter((it) => est(st, it.k).res === "certo").length;
      h += avaliados.length ? fb(certos === avaliados.length, `<b>Caso: ${certos} de ${avaliados.length} ${avaliados.length === 1 ? "pergunta certa" : "perguntas certas"}.</b> ${esc(q.explicacao || "")}`) : (q.explicacao ? fbNeutro(esc(q.explicacao)) : "");
    }
    if (q.sem_gabarito) {
      const busy = ctx.ui.qxBusy === `${q.id}:sug`;
      h += q.sugestao_ia
        ? `<p class="muted" style="font-size:13px;margin:10px 0 0">Esta questão veio sem gabarito do professor. O que aparece como ${rotIA} é uma sugestão, não o gabarito oficial.</p>`
        : `<div class="qsug"><b>Esta questão veio sem gabarito do professor.</b>Você pode responder e marcar como respondida, ou pedir uma sugestão de resposta à IA (é só uma sugestão, não o gabarito do professor; gasta 1 do limite de questões).
          <div class="qauto"><button type="button" class="btn" data-a="qxSugerir" ${busy ? "disabled" : ""}>${busy ? "Pedindo…" : "Sugerir resposta com IA"}</button></div></div>`;
    }
    return h;
  }

  /** Todos os itens respondidos: grava acerto/erro (uma vez). Só "sem gabarito": só marca como respondida. */
  function talvezFechar(ctx, q, st) {
    if (st.final) return;
    const its = itensDe(q), rs = its.map((it) => est(st, it.k).res);
    if (rs.some((r) => !r)) return;
    st.final = true;
    const av = rs.filter((r) => r !== "sem");
    if (!av.length) return ctx.respondida(q);
    ctx.registrar(q, av.every((r) => r === "certo"));
  }
  function achar(ctx) { const q = ctx.atual(); if (!q) return null; return { q, st: estado(ctx, q) }; }
  function itemPorK(q, k) { return itensDe(q).find((x) => x.k === k); }

  async function clique(a, b, ctx) {
    const x = achar(ctx); if (!x) return;
    const { q, st } = x, k = b.dataset.k, it = k ? itemPorK(q, k) : null, s = k ? est(st, k) : null;
    if (k && !it) return;
    const g = it ? gabarito(q, it) : null;
    switch (a) {
      case "qxMc": {
        if (s.done) return;
        const i = +b.dataset.i;
        if (g && Array.isArray(g.corretas)) { s.picks = s.picks.includes(i) ? s.picks.filter((y) => y !== i) : [...s.picks, i].sort((m, n) => m - n); return ctx.render(); }
        s.pick = i; s.done = true; s.res = g ? (i === g.correta ? "certo" : "errado") : "sem";
        break;
      }
      case "qxMcCheck": if (s.done || !s.picks.length) return; s.done = true; s.res = g && JSON.stringify(s.picks) === JSON.stringify([...g.corretas].sort((m, n) => m - n)) ? "certo" : "errado"; break;
      case "qxVf": if (s.done) return; s.vf[+b.dataset.i] = b.dataset.v === "1"; return ctx.render();
      case "qxVfCheck": s.done = true; s.res = g ? ((it.afirmativas || []).every((_, i) => s.vf[i] === !!g.v[i]) ? "certo" : "errado") : "sem"; break;
      case "qxRelCheck": s.done = true; s.res = g ? ((it.colA || []).every((_, i) => +s.rel[i] === g.pares[i]) ? "certo" : "errado") : "sem"; break;
      case "qxVer": { const el = document.getElementById(`disTxt-${k}`); if (el) s.txt = el.value; s.ver = true; return ctx.render(); }
      case "qxNota": if (s.done) return; s.done = true; s.res = ["certo", "parcial", "errado", "sem"].includes(b.dataset.v) ? b.dataset.v : "errado"; break;
      case "qxCorrigir": {
        const el = document.getElementById(`disTxt-${k}`); if (el) s.txt = el.value;
        if (String(s.txt || "").trim().length < 2) { ctx.toast("Escreva sua resposta antes de pedir a correção."); return; }
        ctx.ui.qxBusy = `${q.id}:${k}`; ctx.render();
        try {
          const r = await ctx.chamar("ia", { acao: "questoes_corrigir", questao_id: q.id, ...(it.sub != null ? { sub: it.sub } : {}), resposta: String(s.txt).slice(0, 4000) });
          if (r && r.correcao) { s.ia = r.correcao; s.ver = true; if (!s.done) { s.done = true; s.res = r.correcao.nota; } }
        } catch (e) { ctx.toast(e.message || "Não consegui corrigir agora. Tente de novo."); }
        finally { ctx.ui.qxBusy = null; ctx.atualizarUso(); }
        break;
      }
      case "qxSugerir": {
        ctx.ui.qxBusy = `${q.id}:sug`; ctx.render();
        try {
          const r = await ctx.chamar("ia", { acao: "questoes_sugerir", questao_id: q.id });
          if (r && r.questao && r.questao.dados) {
            Object.assign(q, r.questao.dados); q.dados = r.questao.dados;
            // o que já foi respondido "sem gabarito" volta a ser conferido com a sugestão
            itensDe(q).forEach((y) => { const e2 = est(st, y.k); if (e2.res === "sem") { e2.done = false; e2.res = null; e2.ver = false; } });
            st.final = false;
            ctx.toast("Sugestão da IA pronta");
          }
        } catch (e) { ctx.toast(e.message || "Não consegui sugerir agora. Tente de novo."); }
        finally { ctx.ui.qxBusy = null; ctx.atualizarUso(); }
        break;
      }
      default: return;
    }
    talvezFechar(ctx, q, st);
    ctx.render();
  }
  function mudou(el, ctx) {
    if (el.dataset.a !== "qxRel") return false;
    const x = achar(ctx); if (!x) return true;
    est(x.st, el.dataset.k).rel[+el.dataset.i] = el.value; ctx.render(); return true;
  }
  function digitou(el, ctx) {
    if (!el || el.dataset.a !== "qxTxt") return false;
    const st = ctx.ui.qst; if (st && String(st.id) === el.dataset.qid) est(st, el.dataset.k).txt = el.value;
    return true;
  }

  /* ================= importar do professor ================= */
  const MAX_ARQ = 10;
  function I(ctx) { return ctx.ui.imp || (ctx.ui.imp = { disc: null, tema: "", temaTxt: "", files: [], texto: "", lote: null, rev: [], msg: null, salvando: false, tarefas: [], salvo: null }); }

  // ---- questão lida <-> campos de edição (texto simples: uma alternativa por linha etc.) ----
  const letras = (s) => String(s || "").toLowerCase().match(/[a-n]/g) || [];
  function campos(q) {
    const c = { opcoes: (q.opcoes || []).join("\n"), gab: "", afirm: "", colA: (q.colA || []).join("\n"), colB: (q.colB || []).join("\n"), pares: "", resposta: q.resposta || "" };
    if (Array.isArray(q.corretas)) c.gab = q.corretas.map((i) => LET[i].toUpperCase()).join(", ");
    else if (Number.isInteger(q.correta)) c.gab = LET[q.correta].toUpperCase();
    c.afirm = (q.afirmativas || []).map((a) => `(${a.v === true ? "V" : a.v === false ? "F" : " "}) ${a.texto}`).join("\n");
    if (Array.isArray(q.pares)) c.pares = q.pares.map((p, i) => `${i + 1}-${LET[p]}`).join(", ");
    return c;
  }
  function paraEdicao(q, arquivo) {
    const e = { sel: true, arquivo, numero: q.numero || "", tipo: TIPOS[q.tipo] ? q.tipo : "dis", enunciado: q.enunciado || "", explicacao: q.explicacao || "", c: campos(q), subs: [], erro: "" };
    if (q.tipo === "caso") e.subs = (q.subs || []).map((s) => ({ tipo: SUBTIPOS.includes(s.tipo) ? s.tipo : "dis", enunciado: s.enunciado || "", explicacao: s.explicacao || "", c: campos(s) }));
    return e;
  }
  /** Campos de edição -> questão (o mesmo formato do servidor). Lança Error com o motivo. */
  function montarItem(tipo, enunciado, c, explicacao) {
    const q = { tipo, enunciado: String(enunciado || "").trim(), explicacao: String(explicacao || "").trim() };
    if (!q.enunciado) throw new Error("Falta o enunciado.");
    const linhas = (s) => String(s || "").split("\n").map((x) => x.trim()).filter(Boolean);
    if (tipo === "mc") {
      q.opcoes = linhas(c.opcoes).slice(0, 8);
      if (q.opcoes.length < 2) throw new Error("Marcar X precisa de pelo menos 2 alternativas (uma por linha).");
      const ls = [...new Set(letras(c.gab).map((l) => LET.indexOf(l)))].filter((i) => i >= 0 && i < q.opcoes.length);
      if (String(c.gab || "").trim() && !ls.length) throw new Error("Resposta inválida: use a letra da alternativa (ex.: B).");
      if (ls.length > 1) q.corretas = ls.sort((m, n) => m - n); else if (ls.length) q.correta = ls[0];
    } else if (tipo === "vf") {
      q.afirmativas = linhas(c.afirm).slice(0, 15).map((l) => {
        const m = l.match(/^\(\s*([VvFfCc]?)\s*\)\s*(.*)$/) || l.match(/^([VvFf])\s*[-:.)]\s+(.*)$/);
        const v = m ? (/^[VvCc]$/.test(m[1]) ? true : /^[Ff]$/.test(m[1]) ? false : null) : null;
        return { texto: (m ? m[2] : l).trim(), v };
      }).filter((a) => a.texto);
      if (!q.afirmativas.length) throw new Error("Escreva pelo menos uma afirmativa (uma por linha).");
    } else if (tipo === "rel") {
      q.colA = linhas(c.colA).slice(0, 12); q.colB = linhas(c.colB).slice(0, 14);
      if (q.colA.length < 2 || q.colB.length < 2) throw new Error("Relacionar precisa de pelo menos 2 itens em cada coluna.");
      const ps = String(c.pares || "").trim();
      if (ps) {
        const mapa = {};
        for (const m of ps.matchAll(/(\d{1,2})\s*[-–=:>]*\s*([a-nA-N])/g)) mapa[+m[1] - 1] = LET.indexOf(m[2].toLowerCase());
        const pares = q.colA.map((_, i) => mapa[i]);
        if (pares.some((p) => p == null || p < 0 || p >= q.colB.length)) throw new Error("Pares incompletos: escreva um para cada item (ex.: 1-b, 2-a).");
        q.pares = pares;
      }
    } else if (tipo === "dis") {
      if (String(c.resposta || "").trim()) q.resposta = String(c.resposta).trim();
    }
    return q;
  }
  function montar(e) {
    if (e.tipo !== "caso") return montarItem(e.tipo, e.enunciado, e.c, e.explicacao);
    if (!String(e.enunciado || "").trim()) throw new Error("Falta o texto do caso clínico.");
    if (!e.subs.length) throw new Error("O caso clínico precisa de pelo menos uma pergunta.");
    const subs = e.subs.map((s, i) => { try { return montarItem(s.tipo, s.enunciado, s.c, s.explicacao); } catch (err) { throw new Error(`Pergunta ${i + 1}: ${err.message}`); } });
    return { tipo: "caso", enunciado: e.enunciado.trim(), explicacao: String(e.explicacao || "").trim(), subs };
  }
  const semGab = (e) => { try { const q = montar(e); const f = (x) => x.tipo === "mc" ? !(Number.isInteger(x.correta) || x.corretas) : x.tipo === "vf" ? x.afirmativas.some((a) => a.v == null) : x.tipo === "rel" ? !x.pares : x.tipo === "dis" ? !x.resposta : false; return q.tipo === "caso" ? q.subs.some(f) : f(q); } catch (_) { return false; } };

  function adicionar(ctx, res, arquivo, tarefaId) {
    const st = I(ctx);
    if (tarefaId != null) { if (st.tarefas.includes(tarefaId)) return 0; st.tarefas.push(tarefaId); }
    if (res && res.disciplina_id && !st.disc && ctx.discById(res.disciplina_id)) st.disc = res.disciplina_id;
    const qs = (res && Array.isArray(res.questoes) ? res.questoes : []).map((q) => paraEdicao({ ...q, ...(q.dados || {}) }, arquivo));
    st.rev.push(...qs);
    if (res && res.aviso) st.avisos = [...(st.avisos || []), `${arquivo}: ${res.aviso}`].slice(-6);
    st.salvo = null;
    return qs.length;
  }

  function campoTxt(nome, rot, valor, attrs = "", linhas = 3, dica = "") {
    return `<label class="campo"><span class="mono">${rot}</span><textarea rows="${linhas}" data-a="qiCampo" data-qf="${nome}" ${attrs}>${esc(valor)}</textarea>${dica ? `<span class="muted" style="font-size:12px">${dica}</span>` : ""}</label>`;
  }
  function campoLinha(nome, rot, valor, ph, attrs = "") {
    return `<label class="campo"><span class="mono">${rot}</span><input type="text" data-a="qiCampo" data-qf="${nome}" value="${esc(valor)}" placeholder="${esc(ph)}" maxlength="200" ${attrs}></label>`;
  }
  function camposHTML(tipo, c, ref) {
    if (tipo === "mc") return campoTxt("opcoes", "Alternativas (uma por linha)", c.opcoes, ref, 4) + campoLinha("gab", "Resposta certa", c.gab, "Ex.: B (ou A, C). Vazio = sem gabarito", ref);
    if (tipo === "vf") return campoTxt("afirm", "Afirmativas (uma por linha)", c.afirm, ref, 4, "Comece cada linha com (V), (F) ou ( ) quando não houver gabarito.");
    if (tipo === "rel") return `<div class="qi-form">${campoTxt("colA", "Coluna 1 (uma por linha)", c.colA, ref, 4)}${campoTxt("colB", "Coluna 2 (uma por linha: a, b, c…)", c.colB, ref, 4)}</div>` + campoLinha("pares", "Pares certos", c.pares, "Ex.: 1-b, 2-a, 3-c. Vazio = sem gabarito", ref);
    if (tipo === "dis") return campoTxt("resposta", "Resposta esperada", c.resposta, ref, 3, "Vazio = sem gabarito.");
    return "";
  }
  const selTipo = (tipo, ref, comCaso, rot) => `<label class="linha" style="gap:6px;font-size:13px"><span class="mono">${rot}</span><select data-a="qiCampo" data-qf="tipo" ${ref}>${Object.entries(TIPOS).filter(([kk]) => comCaso || kk !== "caso").map(([kk, l]) => `<option value="${kk}" ${kk === tipo ? "selected" : ""}>${l}</option>`).join("")}</select></label>`;
  function cartao(e, i) {
    const ref = `data-qi="${i}"`;
    const sem = semGab(e);
    const subs = e.tipo === "caso" ? e.subs.map((s, j) => {
      const r2 = `data-qi="${i}" data-qs="${j}"`;
      return `<div class="qi-sub"><div class="linha" style="justify-content:space-between"><b style="font-size:14px">Pergunta ${j + 1}</b>${selTipo(s.tipo, r2, false, "Tipo")}<button type="button" class="btn ghost" data-a="qiSubTirar" data-i="${i}" data-j="${j}">Tirar</button></div>
        ${campoTxt("enunciado", "Pergunta", s.enunciado, r2, 2)}${camposHTML(s.tipo, s.c, r2)}</div>`;
    }).join("") + `<div><button type="button" class="btn ghost" data-a="qiSubMais" data-i="${i}">+ Pergunta</button></div>` : "";
    return `<article class="qi-card ${e.sel ? "" : "off"} ${e.erro ? "erro" : ""}" id="qi-${i}">
      <div class="linha" style="justify-content:space-between"><label class="check"><input type="checkbox" data-a="qiSel" data-i="${i}" ${e.sel ? "checked" : ""}><span>Salvar esta${e.numero ? ` (nº ${esc(e.numero)})` : ""}</span></label>
        <span class="linha">${sem ? `<span class="qtipo qsem">sem gabarito</span>` : ""}<span class="muted" style="font-size:12px;overflow-wrap:anywhere">${esc(e.arquivo || "")}</span></span></div>
      ${selTipo(e.tipo, ref, true, "Tipo")}
      ${campoTxt("enunciado", e.tipo === "caso" ? "Caso clínico" : "Enunciado", e.enunciado, ref, e.tipo === "caso" ? 5 : 3)}
      ${e.tipo === "caso" ? subs : camposHTML(e.tipo, e.c, ref)}
      ${e.erro ? `<p class="qi-erro" role="alert">${esc(e.erro)}</p>` : ""}</article>`;
  }

  function vImportar(ctx) {
    estilos();
    const st = I(ctx), S = ctx.S, P = ctx.P;
    if (!S.disc.length) return `<h2 style="font-size:19px">Importar questões do professor</h2><div class="empty">Adicione uma matéria primeiro.</div>`;
    if (!st.disc || !ctx.discById(st.disc)) st.disc = S.disc[0].id;
    const temas = ctx.temasDe(st.disc);
    const lendo = !!(st.lote && st.lote.some((x) => !["pronto", "erro"].includes(x.st)));
    const temArq = st.files.length || String(st.texto || "").trim().length >= 30;
    const marcadas = st.rev.filter((e) => e.sel).length;
    const uso = `${(ctx.S.uso && ctx.S.uso.questoes) || 0} de ${P.limite_questoes_mes ?? "?"}`;
    const rev = st.rev.length ? `<section class="qi-rev" aria-label="Conferir as questões lidas">
      <div class="qi-top"><h3 style="font-size:16px;margin:0">Confira antes de salvar <span class="muted tnum">(${st.rev.length} ${st.rev.length === 1 ? "questão" : "questões"} · ${st.rev.filter(semGab).length} sem gabarito)</span></h3>
        <span class="row" style="gap:4px"><button type="button" class="btn ghost qtemas-b" data-a="qiTodas" data-v="1">Todas</button><button type="button" class="btn ghost qtemas-b" data-a="qiTodas" data-v="0">Nenhuma</button></span></div>
      <p class="muted" style="margin:0;font-size:13.5px">O texto é o do professor. Corrija o que a leitura errou (principalmente em fotos), escolha o tipo e a resposta certa. Sem resposta, a questão fica "sem gabarito": você responde e marca como respondida, ou pede uma sugestão à IA.</p>
      ${(st.avisos || []).length ? `<div class="msg" style="background:var(--card2)">${st.avisos.map((a) => esc(a)).join("<br>")}</div>` : ""}
      ${st.rev.map(cartao).join("")}
      <div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="btn solid" data-a="qiSalvar" ${st.salvando || !marcadas ? "disabled" : ""}>${st.salvando ? "Salvando…" : `Salvar ${marcadas} ${marcadas === 1 ? "questão" : "questões"}`}</button><button type="button" class="btn ghost" data-a="qiDescartar" ${st.salvando ? "disabled" : ""}>Descartar a leitura</button></div></section>` : "";
    const temaVal = st.tema;
    return `<h2 style="font-size:19px">Importar questões do professor</h2>
      <p class="muted" style="margin:6px 0 14px">Mande as questões que o professor passou: PDF (também escaneado), Word, PowerPoint, foto, texto… A IA só copia para o site, do jeito que está: não reescreve e não inventa gabarito. Nada é salvo antes de você conferir.</p>
      <div class="qi-form" id="qiForm">
        <label class="field"><span class="mono">Matéria</span><select data-a="qiDisc">${S.disc.map((d) => `<option value="${d.id}" ${d.id == st.disc ? "selected" : ""}>${esc(d.nome)}</option>`).join("")}</select></label>
        <label class="field"><span class="mono">Conteúdo (opcional)</span><select data-a="qiTema"><option value="">Sem conteúdo específico</option>${temas.map((t) => `<option value="${t.id}" ${String(t.id) === String(temaVal) ? "selected" : ""}>${esc(t.nome)}</option>`).join("")}<option value="outro" ${temaVal === "outro" ? "selected" : ""}>Outro conteúdo (escrever)</option></select></label>
        ${temaVal === "outro" ? `<label class="field full"><span class="mono">Qual conteúdo</span><input class="inp" id="qiTemaTxt" data-a="qiTemaTxt" maxlength="200" value="${esc(st.temaTxt)}" placeholder="Ex.: Antibióticos"></label>` : ""}
        <div class="field full"><span class="mono">Arquivos (até ${MAX_ARQ})</span>
          <input type="file" id="qiArq" data-a="qiArq" multiple accept="${esc(window.ImportarDoc ? ImportarDoc.aceitar() : ".pdf")}" aria-label="Escolher os arquivos com as questões">
          ${st.files.length ? `<div class="qi-arqs">${st.files.map((f, i) => `<span class="qi-arq">${esc(f.name)}<button type="button" data-a="qiTirar" data-i="${i}" aria-label="Tirar ${esc(f.name)}">×</button></span>`).join("")}</div>` : ""}</div>
        <label class="field full"><span class="mono">Ou cole o texto das questões</span><textarea class="inp" id="qiTexto" data-a="qiTexto" rows="4" maxlength="140000" placeholder="Cole aqui as questões (e o gabarito, se tiver)">${esc(st.texto)}</textarea></label>
      </div>
      <div class="row" style="margin-top:10px;gap:8px;flex-wrap:wrap;align-items:center"><button type="button" class="btn solid" data-a="qiLer" ${lendo || !temArq ? "disabled" : ""}>${lendo ? "Lendo…" : "Ler as questões"}</button>
        <span class="muted" style="font-size:13px">Gasta 1 do limite de questões a cada 10 questões encontradas (${esc(uso)} usadas este mês).</span></div>
      ${st.msg ? `<p class="${st.msg.bad ? "qi-erro" : ""}" style="margin-top:10px" aria-live="polite">${esc(st.msg.t)}</p>` : ""}
      ${st.salvo ? `<div class="msg" aria-live="polite">${esc(st.salvo)} <button type="button" class="lnk" data-a="qiPraticar">Praticar agora</button></div>` : ""}
      <div id="qiProg">${st.lote ? ImportarDoc.progressoHTML(st.lote) : ""}</div>
      ${rev}`;
  }

  function escolherArquivos(ctx, files) {
    const st = I(ctx), recusados = [];
    for (const f of [...(files || [])]) {
      const r = window.ImportarDoc ? ImportarDoc.recusa(f) : "";
      if (r) { recusados.push(`${f.name}: ${r}`); continue; }
      st.files.push(f);
    }
    if (st.files.length > MAX_ARQ) { recusados.push(`Até ${MAX_ARQ} arquivos por vez: mande os outros depois.`); st.files = st.files.slice(0, MAX_ARQ); }
    st.msg = recusados.length ? { bad: true, t: recusados.join(" ") } : null;
  }
  function destino(ctx) {
    const st = I(ctx);
    const t = st.tema && st.tema !== "outro" ? ctx.temaById(st.tema) : null;
    const tema = t ? t.nome : st.tema === "outro" ? String(st.temaTxt || "").replace(/\s+/g, " ").trim().slice(0, 200) : "";
    return { disciplina_id: +st.disc, tema_id: t ? t.id : null, tema };
  }
  function ler(ctx) {
    const st = I(ctx);
    const files = st.files.splice(0);
    const txt = String(st.texto || "").trim();
    if (txt.length >= 30) { files.push(new File([txt], "Texto colado.txt", { type: "text/plain" })); st.texto = ""; }
    if (!files.length) { st.msg = { bad: true, t: "Escolha um arquivo ou cole o texto das questões (pelo menos uma linha)." }; return ctx.render(); }
    const d = destino(ctx);
    if (st.tema === "outro" && !d.tema) { st.files = files.filter((f) => f.name !== "Texto colado.txt"); st.msg = { bad: true, t: "Escreva o conteúdo ou escolha um da lista." }; return ctx.render(); }
    st.msg = null; st.salvo = null; st.destino = d;
    const pintar = () => { const el = document.getElementById("qiProg"); if (el && st.lote) el.innerHTML = ImportarDoc.progressoHTML(st.lote); };
    const lote = ImportarDoc.lerArquivos(files, {
      sb: ctx.sb, uid: ctx.P.id, carregarPdfjs: ctx.carregarPdfjs, carregarJSZip: ctx.carregarJSZip,
      extra: { acao: "questoes_importar", ...d },
      criar: (corpo) => window.Tarefas.criar(corpo), buscar: async () => { await window.Tarefas.buscar(); return window.Tarefas.lista(); }, vista: (ids) => window.Tarefas.vista(ids),
      aoMudar: pintar,
      aoPronto: (it, res) => { const n = adicionar(ctx, res, it.nome, it.tarefa); if (!n && !(res && res.aviso)) it.msg = "Não achei questões neste arquivo."; else if (!n) it.msg = res.aviso; ctx.renderSe(); },
    });
    st.lote = (st.lote || []).filter((x) => !["pronto", "erro"].includes(x.st)).concat(lote.itens);
    ctx.render();
    lote.fim.then(() => {
      const n = st.rev.length, er = (st.lote || []).filter((x) => x.st === "erro").length;
      if (!n) st.msg = { bad: true, t: er ? "Não consegui ler os arquivos. Veja o motivo em cada um." : "Não achei questões nesses arquivos." };
      else st.msg = { t: `Leitura terminada: ${n} ${n === 1 ? "questão" : "questões"} para conferir. Nada foi salvo ainda.` };
      ctx.atualizarUso(); ctx.renderSe();
    });
  }
  async function salvar(ctx) {
    const st = I(ctx);
    const marcadas = st.rev.map((e, i) => [e, i]).filter(([e]) => e.sel);
    let primeiroErro = null; const qs = [];
    for (const [e, i] of marcadas) { try { qs.push(montar(e)); e.erro = ""; } catch (err) { e.erro = err.message; if (primeiroErro == null) primeiroErro = i; } }
    if (primeiroErro != null) { st.msg = { bad: true, t: "Confira as questões marcadas em vermelho." }; ctx.render(); document.getElementById("qi-" + primeiroErro)?.scrollIntoView({ block: "center" }); return; }
    const d = destino(ctx);
    if (I(ctx).tema === "outro" && !d.tema) { st.msg = { bad: true, t: "Escreva o conteúdo ou escolha um da lista." }; return ctx.render(); }
    st.salvando = true; st.msg = null; ctx.render();
    let salvas = 0, repetidas = 0, invalidas = 0;
    try {
      for (let i = 0; i < qs.length; i += 100) {
        const r = await ctx.chamar("ia", { acao: "questoes_salvar", ...d, questoes: qs.slice(i, i + 100) });
        salvas += (r.salvas || []).length; repetidas += r.repetidas || 0; invalidas += r.invalidas || 0;
      }
      st.rev = st.rev.filter((e) => !e.sel); st.avisos = [];
      st.salvo = `${salvas} ${salvas === 1 ? "questão salva" : "questões salvas"} em ${ctx.discById(d.disciplina_id)?.nome || "a matéria"}${repetidas ? ` (${repetidas} ${repetidas === 1 ? "já estava" : "já estavam"} no site)` : ""}${invalidas ? ` (${invalidas} com problema não ${invalidas === 1 ? "entrou" : "entraram"})` : ""}.`;
      st.ultimaDisc = d.disciplina_id;
      await ctx.carregarQuestoes().catch(() => { });
    } catch (e) { st.msg = { bad: true, t: e.message || "Não consegui salvar. Tente de novo." }; }
    finally { st.salvando = false; ctx.render(); }
  }

  async function cliqueImp(a, b, ctx) {
    const st = I(ctx);
    switch (a) {
      case "qiLer": return ler(ctx);
      case "qiTirar": st.files.splice(+b.dataset.i, 1); return ctx.render();
      case "qiSel": { const e = st.rev[+b.dataset.i]; if (e) { e.sel = b.checked; const card = document.getElementById("qi-" + b.dataset.i); if (card) card.classList.toggle("off", !e.sel); atualizarBotao(st); } return; }
      case "qiTodas": st.rev.forEach((e) => { e.sel = b.dataset.v === "1"; }); return ctx.render();
      case "qiSubTirar": { const e = st.rev[+b.dataset.i]; if (e) e.subs.splice(+b.dataset.j, 1); return ctx.render(); }
      case "qiSubMais": { const e = st.rev[+b.dataset.i]; if (e) e.subs.push({ tipo: "mc", enunciado: "", explicacao: "", c: campos({}) }); return ctx.render(); }
      case "qiSalvar": return salvar(ctx);
      case "qiDescartar": st.rev = []; st.avisos = []; st.lote = (st.lote || []).filter((x) => !["pronto", "erro"].includes(x.st)); st.msg = null; return ctx.render();
      case "qiPraticar": return ctx.praticar(st.ultimaDisc || st.disc);
    }
  }
  function atualizarBotao(st) {
    const b = document.querySelector('[data-a="qiSalvar"]'); if (!b) return;
    const n = st.rev.filter((e) => e.sel).length; b.disabled = st.salvando || !n; b.textContent = `Salvar ${n} ${n === 1 ? "questão" : "questões"}`;
  }
  /** change/input dentro da importação. Devolve true se era daqui. */
  function campoImp(el, ctx, tipoEvento) {
    if (!el || !el.closest || !el.closest("#qiForm, .qi-rev, [data-a^='qi']")) return false;
    const st = I(ctx), a = el.dataset.a;
    if (a === "qiDisc" && tipoEvento === "change") { st.disc = +el.value; st.tema = ""; ctx.render(); return true; }
    if (a === "qiTema" && tipoEvento === "change") { st.tema = el.value; ctx.render(); if (st.tema === "outro") document.getElementById("qiTemaTxt")?.focus(); return true; }
    if (a === "qiTemaTxt") { st.temaTxt = el.value; return true; }
    if (a === "qiTexto") { st.texto = el.value; const b = document.querySelector('[data-a="qiLer"]'); if (b && tipoEvento === "input") b.disabled = !(st.files.length || el.value.trim().length >= 30) || !!(st.lote && st.lote.some((x) => !["pronto", "erro"].includes(x.st))); return true; }
    if (a === "qiArq" && tipoEvento === "change") { escolherArquivos(ctx, el.files); el.value = ""; ctx.render(); return true; }
    if (a === "qiSel") return true; // o clique cuida
    const qf = el.dataset.qf; if (!qf || el.dataset.qi == null) return false;
    const e = st.rev[+el.dataset.qi]; if (!e) return true;
    const alvo = el.dataset.qs != null ? e.subs[+el.dataset.qs] : e; if (!alvo) return true;
    if (qf === "tipo") { if (tipoEvento !== "change") return true; alvo.tipo = el.value; if (alvo === e && e.tipo === "caso" && !e.subs.length) e.subs.push({ tipo: "mc", enunciado: "", explicacao: "", c: campos({}) }); e.erro = ""; ctx.render(); return true; }
    if (qf === "enunciado") alvo.enunciado = el.value; else alvo.c[qf] = el.value;
    if (e.erro && tipoEvento === "change") { try { montar(e); e.erro = ""; const card = document.getElementById("qi-" + el.dataset.qi); card?.classList.remove("erro"); card?.querySelector(".qi-erro")?.remove(); } catch (_) { } }
    return true;
  }

  /** Prepara a importação com arquivos vindos de outra parte do site (Painel.importarQuestoes). */
  function preparar(ctx, files, opts = {}) {
    const st = I(ctx);
    if (opts.disciplina_id && ctx.discById(opts.disciplina_id)) { st.disc = +opts.disciplina_id; st.tema = ""; }
    if (opts.tema_id && ctx.temaById(opts.tema_id) && ctx.temaById(opts.tema_id).disciplina_id == st.disc) st.tema = String(opts.tema_id);
    else if (opts.tema) { st.tema = "outro"; st.temaTxt = String(opts.tema).slice(0, 200); }
    if (typeof opts.texto === "string") st.texto = opts.texto.slice(0, 140000);
    if (files && files.length) escolherArquivos(ctx, files);
    if (opts.ler && (st.files.length || String(st.texto).trim().length >= 30)) ler(ctx);
  }
  /** Uma leitura terminou depois (Tarefas → Conferir): entra na revisão. */
  function deTarefa(ctx, t) {
    const r = t.resultado || {}, st = I(ctx);
    if (r.disciplina_id && ctx.discById(r.disciplina_id) && !st.rev.length) { st.disc = r.disciplina_id; st.tema = r.tema_id ? String(r.tema_id) : r.tema && r.tema !== "Questões do professor" ? "outro" : ""; if (st.tema === "outro") st.temaTxt = r.tema; }
    const n = adicionar(ctx, r, r.nome || String(t.titulo || "").replace(/^Questões do professor:\s*/, ""), t.id);
    st.msg = n ? { t: `${n} ${n === 1 ? "questão lida" : "questões lidas"}: confira e salve.` } : { bad: true, t: r.aviso || "Não achei questões neste arquivo." };
  }

  window.Questoes = { TIPOS, corpo, clique, mudou, digitou, vImportar, cliqueImp, campoImp, preparar, deTarefa, adicionar, montar, paraEdicao, itensDe, gabarito, estilos };
})();
