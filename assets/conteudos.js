// Partes puras (sem tela) usadas pelo painel e testadas no Node:
// - casarTema(): liga um conteúdo do manual da prova ("Unidade 4", "Enfermedades do esôfago") a um tema que já existe
//   ("unidad IV primeros auxilios.pptx", "Doenças do esôfago"), sem diferença de acento, maiúscula, espanhol/português,
//   plural e número romano.
// - período da prova de cada matéria (P1 -> P2 -> Final) e em qual prova cada tema cai (sem marcação = P1).
// - o que é cada arquivo enviado (material de estudo, resumo pronto, calendário/manual, laminário, questões,
//   áudio/vídeo): primeiro pelo nome, depois pelo texto; a IA só quando não dá para saber.
(function (g) {
  const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const EXT = /\.(pdf|pptx?|pptm|ppsx?|potx?|docx?|docm|dotx?|txt|md|key|odt|odp|ods|rtf|xlsx?|xlsm|csv|tsv|html?|jpe?g|png|webp|heic|heif|mp3|m4a|wav|ogg|opus|aac|flac|wma|mp4|m4v|mov|avi|mkv|webm|wmv|3gp|mpe?g)$/i;

  /* ================= casar conteúdo do manual com tema ================= */
  const ROMANOS = { i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10", xi: "11", xii: "12", xiii: "13", xiv: "14", xv: "15" };
  const VAZIAS = new Set(["de", "da", "do", "das", "dos", "del", "la", "las", "el", "los", "lo", "en", "em", "no", "na", "nos", "nas", "e", "y", "o", "a", "as", "os", "com", "con", "para", "por", "sobre", "focar", "foco", "ou", "u", "um", "uma", "un", "una", "parte", "pdf", "ppt", "pptx", "docx", "slides", "slide", "material", "resumo"]);
  // espanhol -> português (depois de tirar acentos)
  const VARIANTES = { enfermedad: "doenca", enfermedades: "doenca", enfermidade: "doenca", enfermidades: "doenca", doencas: "doenca", higado: "figado", higados: "figado",
    sx: "sindrome", sindromes: "sindrome", sindrome: "sindrome", sd: "sindrome", unidad: "unidade", unidades: "unidade", unid: "unidade", clase: "aula", clases: "aula", aulas: "aula",
    infeccion: "infeccao", infecciones: "infeccao", infeccoes: "infeccao", vias: "via", urinarias: "urinaria", urinario: "urinaria", farmacos: "farmaco", medicamentos: "farmaco", drogas: "farmaco",
    tumores: "tumor", estomago: "estomago", cardiaca: "cardiaca", cardiaco: "cardiaca", renales: "renal", renais: "renal", rinon: "rim", rinones: "rim", rins: "rim", cavidad: "cavidade", boca: "oral",
    hemorragias: "hemorragia", sangrado: "hemorragia", tiroideos: "tireoide", tiroides: "tireoide", tireoidianos: "tireoide", tiroideo: "tireoide", tireoideos: "tireoide",
    insulinas: "insulina", hipoglicemiantes: "hipoglicemiante", glomerulopatias: "glomerulopatia", modulo: "unidade", capitulo: "unidade", cap: "unidade", tema: "unidade",
    ictetico: "icterico", icterica: "icterico", ictericia: "icterico", ictericos: "icterico", ictericas: "icterico" };
  const FRACAS = new Set(["patologia", "doenca", "sindrome", "unidade", "aula", "aguda", "cronica", "agudo", "cronico", "geral", "introducao", "tipo", "tipos", "parte", "basico", "estudo", "clinica"]);
  const NUMERADAS = new Set(["unidade", "aula"]);
  function raiz(w) {
    if (ROMANOS[w]) return ROMANOS[w];
    if (VARIANTES[w]) return VARIANTES[w];
    let s = w;
    s = s.replace(/itis$/, "ite").replace(/ciones$|coes$|cion$/, "cao").replace(/ales$|ais$/, "al").replace(/eis$|eles$/, "el").replace(/dades$/, "dade").replace(/dad$/, "dade");
    if (s.length > 4 && /s$/.test(s) && !/ss$/.test(s)) s = s.slice(0, -1);
    return VARIANTES[s] || s;
  }
  /** Palavras que contam (sem acento, extensão, palavras vazias), já normalizadas. */
  function palavras(nome) {
    const base = semAcento(String(nome || "").replace(EXT, "")).replace(/(\d+)/g, " $1 ").replace(/[^a-z0-9]+/g, " ").trim();
    return [...new Set(base.split(/\s+/).filter((w) => w && !VAZIAS.has(w)).map(raiz).filter((w) => w && !VAZIAS.has(w)))];
  }
  const igual = (a, b) => a === b || (!/^\d+$/.test(a) && !/^\d+$/.test(b) && a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5));
  /** Nota de 0 a 1 de um conteúdo do manual com o nome de um tema. 0 = não é. */
  function notaTema(item, tema) {
    const A = palavras(item), B = palavras(tema); if (!A.length || !B.length) return 0;
    const numA = A.filter((w) => /^\d+$/.test(w)), numB = B.filter((w) => /^\d+$/.test(w));
    // "Unidade 4", "Aula 5": o número decide (Unidade 4 não é Unidade 14)
    const numerado = A.some((w) => NUMERADAS.has(w)) && numA.length;
    if (numerado && !numA.some((n) => numB.includes(n))) return 0;
    if (numA.length && numB.length && !numA.some((n) => numB.includes(n))) return 0;
    const comuns = A.filter((a) => B.some((b) => igual(a, b)));
    const fortes = comuns.filter((w) => !FRACAS.has(w) && (!/^\d+$/.test(w) || numerado));
    if (!fortes.length) return 0;
    if (numerado) { const kind = A.find((w) => NUMERADAS.has(w)); if (!B.includes(kind)) return 0; return 1; }
    const s = comuns.length / Math.min(A.length, B.length);
    return s >= 0.66 ? s * 0.8 + 0.2 * comuns.length / Math.max(A.length, B.length) : 0;
  }
  /** O tema que corresponde ao conteúdo (o de maior nota), ou null. temas: [{id, nome}] */
  function casarTema(item, temas) {
    let melhor = null, nota = 0;
    for (const t of temas || []) { const n = notaTema(item, t.nome); if (n > nota) { nota = n; melhor = t; } }
    return melhor ? melhor.id : null;
  }

  /* ================= período da prova ================= */
  const ORDEM = { P1: 0, P2: 1, Final: 2 };
  const OFICIAL = (t) => t === "P1" || t === "P2" || t === "Final";
  /** "P2 prática" -> {tipo:"P2", mod:"pratica"}; sem marcação -> P1 (o que não foi marcado cai na primeira prova). */
  function provaDoRotulo(rot) {
    const s = semAcento(rot);
    const tipo = /\bp\s*2\b|segunda|2a parcial/.test(s) ? "P2" : /final|exame final/.test(s) ? "Final" : "P1";
    const mod = /prat|prac/.test(s) ? "pratica" : /teor/.test(s) ? "teorica" : null;
    return { tipo, mod };
  }
  /**
   * Em que prova a matéria está agora: a próxima prova oficial (por data e hora); as que já passaram estão feitas.
   * provas: as da matéria; dt(p) -> Date. Sem prova futura: a seguinte à última que passou (P1 -> P2 -> Final);
   * depois da Final, null. Sem nenhuma prova com data: P1.
   */
  function periodoAtual(provas, agora, dt) {
    const of = (provas || []).filter((p) => p && p.data && OFICIAL(p.tipo));
    const fut = of.filter((p) => dt(p) > agora).sort((a, b) => dt(a) - dt(b));
    if (fut.length) return { tipo: fut[0].tipo, prova: fut[0] };
    if (!of.length) return { tipo: "P1", prova: null };
    const ult = Math.max(...of.map((p) => ORDEM[p.tipo]));
    return { tipo: ult >= 2 ? null : ult === 1 ? "Final" : "P2", prova: null };
  }
  /** O tema cai nesta prova? (sem marcação = P1; "P2 prática" só na prática da P2) */
  function temaNaProva(rotTema, tipo, modalidade) {
    const r = provaDoRotulo(rotTema);
    return r.tipo === tipo && (!modalidade || !r.mod || r.mod === modalidade);
  }
  /** Rótulo para gravar no tema quando o manual diz que ele cai na prova "tipo" (mantém teórica/prática se a matéria tem prática). */
  function rotuloManual(tipo, rotAntigo, temPratica) {
    const mod = temPratica ? provaDoRotulo(rotAntigo).mod : null;
    return mod ? `${tipo} ${mod === "pratica" ? "prática" : "teórica"}` : tipo;
  }

  /* ================= o que é cada arquivo ================= */
  // destinos: mat (material de estudo), resumo (resumo pronto), cal (calendário/manual), lam (laminário),
  //           quest (questões do professor), midia (áudio/vídeo), perguntar (o aluno escolhe)
  const MIDIA = /\.(mp3|m4a|wav|ogg|oga|opus|aac|flac|wma|mp4|m4v|mov|avi|mkv|webm|wmv|3gp|mpe?g)$/i;
  const IMG = /\.(jpe?g|jfif|png|webp|heic|heif|gif|bmp)$/i;
  const MARCAS = /medcurso|medcel|sanar|estrategia ?med|aristo|medway|jaleko|yellowbook|whitebook|med ?resumos|resumed|medgrupo|afya|eu ?medico ?residente|mapas? mentais?/;
  const N_CAL = /\b(manual|cronograma|calendario|calendar|horario|horarios|fechas|parciais|parciales|examenes|exames finais|data[s]? das provas|grade de provas|grilla|programacion de examenes|segunda prueba|primera prueba|prueba parcial)\b/;
  const N_LAM = /lamin|laminario|laminas/;
  const N_QUEST = /\b(questoes|questao|questionario|exercicios?|simulados?|preguntas|cuestionario|banco de|gabarito|provas? antigas?|examen(es)? anterior(es)?|lista de exercicios)\b/;
  const N_RES = /\b(resumo|resumos|resumen|resumenes|sinopse|apostila resumida)\b/;
  function destinoPorNome(nome, mime) {
    const n = String(nome || ""), m = String(mime || "").toLowerCase();
    if (MIDIA.test(n) || /^(audio|video)\//.test(m)) return { d: "midia", certo: true };
    const s = semAcento(n.replace(EXT, "")).replace(/[_\-.]+/g, " ");
    const img = IMG.test(n) || /^image\//.test(m);
    if (N_LAM.test(s)) return { d: "lam", certo: true };
    if (N_QUEST.test(s)) return { d: "quest", certo: true };
    if (N_CAL.test(s)) return { d: "cal", certo: true };
    if (/\.(xlsx?|xlsm|ods|csv|tsv)$/i.test(n)) return { d: "cal", certo: true }; // planilha quase sempre é horário, cronograma ou calendário
    if (img) return { d: "perguntar", certo: false, img: true }; // foto: calendário, lâmina ou questão? o aluno diz
    if (N_RES.test(s) || MARCAS.test(s)) return { d: "resumo", certo: true };
    if (/\.(pptx?|pptm|ppsx?|potx?|odp|key)$/i.test(n)) return { d: "mat", certo: true }; // slides de aula
    return { d: "mat", certo: false };
  }
  /** Pelo texto tirado do arquivo (sem IA). certo=false: a IA ajuda. */
  function destinoPorTexto(texto) {
    const t = String(texto || ""), s = semAcento(t.slice(0, 20000));
    const letras = t.replace(/\s+/g, "").length;
    if (letras < 300) return { d: "mat", certo: false };
    const datas = (s.match(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g) || []).length;
    const horas = (s.match(/\b\d{1,2}[:h]\d{2}\b/g) || []).length;
    const dias = (s.match(/\b(lunes|martes|miercoles|jueves|viernes|sabado|segunda|terca|quarta|quinta|sexta)\b/g) || []).length;
    const prova = (s.match(/\b(parcial|examen|exame|prova|prueba|avaliacao|evaluacion)\b/g) || []).length;
    const alternativas = (t.match(/^\s*(\(?[a-eA-E]\)|[a-eA-E]\s*[).-]\s)/gm) || []).length;
    if (/\bmanual\b/.test(s.slice(0, 3000)) && (prova >= 2 || datas >= 3)) return { d: "cal", certo: true, manual: true };
    if (/conteudos? (e orientacoes|da prova|que caem)|data das provas|fechas de (los )?examenes/.test(s) && datas >= 3) return { d: "cal", certo: true, manual: true };
    if (dias >= 5 && horas >= 6 && letras < 15000) return { d: "cal", certo: true };
    if (datas >= 8 && (prova >= 3 || /feriado|asueto|calendario|cronograma|semana de/.test(s)) && letras < 30000) return { d: "cal", certo: true };
    if (alternativas >= 12 || /gabarito|assinale a (alternativa|correta)|marque (v|verdadeiro)/.test(s) && alternativas >= 4) return { d: "quest", certo: true };
    if (MARCAS.test(s.slice(0, 6000))) return { d: "resumo", certo: true };
    if (datas >= 3 && prova >= 2 && letras < 6000) return { d: "cal", certo: false }; // parece aviso de prova: a IA confirma
    if (letras >= 1200) return { d: "mat", certo: true };
    return { d: "mat", certo: false };
  }
  /** O tipo que a IA disse -> destino. */
  function destinoDaIA(tipo) {
    return ({ material_de_estudo: "mat", resumo_pronto: "resumo", calendario_geral: "cal", cronograma_provas: "cal", horario_aulas: "cal", manual_prova: "cal",
      regulamento: "cal", aviso: "cal", programa_materia: "mat", laminario: "lam", questoes: "quest" })[tipo] || "perguntar";
  }
  const DESTINOS = { mat: "Material de estudo", resumo: "Resumo pronto", cal: "Calendário ou manual", lam: "Laminário", quest: "Questões do professor", midia: "Áudio ou vídeo da aula", ignorar: "Ignorar" };

  const API = { semAcento, palavras, notaTema, casarTema, provaDoRotulo, periodoAtual, temaNaProva, rotuloManual, ORDEM, destinoPorNome, destinoPorTexto, destinoDaIA, DESTINOS };
  g.Conteudos = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
