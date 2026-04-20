"""
Corpus de regles editorials normatives en català.
Font: Institut d'Estudis Catalans (IEC)
  - Ortografia catalana (2017)
  - Diccionari de la Llengua Catalana (DIEC2)
  - Gramàtica de la Llengua Catalana (GIEC, 2016)
  - Termcat: equivalents en català d'anglicismes
"""

IEC_RULES: list[dict] = [

    # ── ACCENTUACIÓ ───────────────────────────────────────────────────────────
    {
        "name": "Accent greu i agut en català",
        "description": "En català, la a i la e obertes porten accent greu (à, è) i les tancades accent agut (é). "
                       "La i i la u sempre porten accent agut quan s'accentuen (í, ú). "
                       "La o tancada porta accent agut (ó) i l'oberta accent greu (ò). "
                       "Exemples: àvia, bèstia, café, préstec, línia, música, fórmula, Sòcrates.",
        "category": "Tildes",
        "source": "IEC Ortografia catalana 2017, §3.1",
    },
    {
        "name": "Accent diacrític en català",
        "description": "En català hi ha accents diacrítics per distingir paraules homògrafes: "
                       "bé (adv.) / be (lletra); déu (Déu) / deu (numeral o verb); "
                       "és (verb ser) / es (pronom); mà (extremitat) / ma (possessiu); "
                       "més (adverbi) / mes (substantiu o possessiu); "
                       "món (Terra) / mon (possessiu); sé (verb saber) / se (pronom); "
                       "sí (afirmació) / si (condicional); sòl (terra) / sol (astre/verb); "
                       "té (verb tenir) / te (lletra/infusió); vós (pronom) / vos (pronom feble).",
        "category": "Tildes",
        "source": "IEC Ortografia catalana 2017, §3.6",
    },

    # ── APÒSTROF I CONTRACCIÓ ─────────────────────────────────────────────────
    {
        "name": "Apostrofació correcta de l'article i la preposició",
        "description": "L'article 'el' i la preposició 'de' s'apostrofen davant de paraules que comencen per vocal "
                       "o h: l'autor (no 'el autor'), d'ell (not 'de ell'). "
                       "Excepcions: davant de 'i', 'u' consonàntiques, i de paraules que comencen per 'hi' + vocal: "
                       "el iogurt, la humitat. "
                       "La preposició 'a' no s'apostrofa mai: 'a ell', mai 'a'ell'.",
        "category": "Gramàtica",
        "source": "IEC Ortografia catalana 2017, §4.1",
    },
    {
        "name": "Contraccions al, del, pel, als, dels, pels",
        "description": "Les preposicions 'a', 'de' i 'per' es contrauen amb l'article masculí 'el/els': "
                       "a + el = al, de + el = del, per + el = pel, a + els = als, de + els = dels, per + els = pels. "
                       "Incorr.: 'de el president'; Corr.: 'del president'. "
                       "No s'aplica amb l'article femení ni el neutre: 'de la directora', 'per les raons'.",
        "category": "Gramàtica",
        "source": "IEC Gramàtica de la Llengua Catalana §7.2",
    },

    # ── PUNT VOLAT (·) ────────────────────────────────────────────────────────
    {
        "name": "Ela geminada (l·l)",
        "description": "La l·l (ela geminada) s'escriu amb punt volat: intel·ligència, col·legi, il·lusió. "
                       "No s'ha de confondre amb 'll' (el so palatal lateral): lluna, balla. "
                       "Incorr.: 'inteligència' o 'intel.ligència'; Corr.: 'intel·ligència'.",
        "category": "Ortografia",
        "source": "IEC Ortografia catalana 2017, §2.4",
    },

    # ── GUIONET I SEPARACIÓ ───────────────────────────────────────────────────
    {
        "name": "Guionet en mots compostos i prefixos",
        "description": "En català, els prefixos s'uneixen al mot base sense guionet quan formen un mot simple: "
                       "antidemocràtic, contrareforma, supermercat. "
                       "S'escriu guionet quan el prefix preceda una sigla, un nom propi o un numeral: "
                       "anti-OTAN, pro-europeu, sub-21. "
                       "Els mots compostos que han perdut vitalitat s'escriuen junts: malhumor, benvingut.",
        "category": "Ortografia",
        "source": "IEC Ortografia catalana 2017, §5.3",
    },

    # ── DEQUEISME I RÈGIM PREPOSICIONAL ───────────────────────────────────────
    {
        "name": "Dequeisme en català (calc del castellà)",
        "description": "El dequeisme (ús de 'de que' on no pertoca) és un calc del castellà. "
                       "Els verbs de pensament i opinió en català regeixen directament 'que': "
                       "crec que (no 'crec de que'), penso que (no 'penso de que'). "
                       "Prova: si es pot substituir la subordinada per 'això' sense 'de', el 'de' és incorrecte.",
        "category": "Gramàtica",
        "source": "IEC GIEC §30.4; Optimot",
    },
    {
        "name": "Règim preposicional: 'en relació amb' / 'pel que fa a'",
        "description": "Les locucions preposicionals correctes en català són 'en relació amb' i 'pel que fa a'. "
                       "La forma 'en relació a' és un calc del castellà 'en relación a'. "
                       "Incorr.: 'en relació a aquest tema'; Corr.: 'en relació amb aquest tema' o 'pel que fa a aquest tema'.",
        "category": "Gramàtica",
        "source": "IEC Optimot; Gramàtica normativa",
    },

    # ── INTERFERÈNCIES DEL CASTELLÀ (CALCS) ───────────────────────────────────
    {
        "name": "Calcs del castellà: lèxic",
        "description": "Interferències lèxiques del castellà que cal evitar: "
                       "'llavors' i no 'entonces'; 'però' i no 'però que'; "
                       "'tanmateix' i no 'no obstant'; 'ara bé' i no 'ara bé que'; "
                       "'malgrat que' i no 'a pesar de que'; 'tret que' i no 'llevat'; "
                       "'perquè' (causatiu) vs 'per tal que' (final); "
                       "'ensenyar' i no 'aprendre' (*aprendre una cançó a algú = ensenyar).",
        "category": "Léxico",
        "source": "IEC DIEC2; Servei de Política Lingüística",
    },
    {
        "name": "Barbarismes i anglicismes: equivalents en català (Termcat)",
        "description": "Preferir les formes catalanes homologades per Termcat: "
                       "'en línia' en lloc de 'online'; "
                       "'tauleta' en lloc de 'tablet'; "
                       "'ordinador portàtil' o 'portàtil' en lloc de 'laptop'; "
                       "'programari' en lloc de 'software'; "
                       "'maquinari' en lloc de 'hardware'; "
                       "'aplicació' o 'app' (acceptada) en lloc d'altres calcs; "
                       "'correu electrònic' o 'correu-e' en lloc de 'email'; "
                       "'xarxes socials' en lloc de 'redes sociales' (castellanisme).",
        "category": "Extranjerismes",
        "source": "Termcat; IEC DIEC2",
    },

    # ── MORFOLOGIA VERBAL ────────────────────────────────────────────────────
    {
        "name": "Passat perifràstic vs passat simple",
        "description": "En el català oriental (barceloní) el passat perifrastic (vaig fer, vas venir) "
                       "és l'ús general i el passat simple (féu, vingué) és literari o dialectal. "
                       "En textos formals i literaris, el passat simple és perfectament correcte. "
                       "La barreja sistemàtica de tots dos en el mateix text pot trencar el registre. "
                       "En català occidental (lleidatà), el passat simple és l'ús habitual.",
        "category": "Gramàtica",
        "source": "IEC GIEC §19.2",
    },
    {
        "name": "Ús de 'haver-hi' (impersonal)",
        "description": "'Haver-hi' és impersonal i no concorda amb el sintagma nominal que l'acompanya: "
                       "Corr.: 'Hi ha molts problemes' (no 'Hi han molts problemes'). "
                       "Incorr.: 'Hi han errors greus'; Corr.: 'Hi ha errors greus'. "
                       "La concordança és un error freqüent per influència del castellà 'hay'.",
        "category": "Gramàtica",
        "source": "IEC GIEC §16.3",
    },

    # ── PUNTUACIÓ ────────────────────────────────────────────────────────────
    {
        "name": "Cometes en català",
        "description": "En català s'utilitzen preferentment les cometes baixes (llatines): \u00abtext\u00bb. "
                       "Les cometes altes (\u201ctext\u201d) i simples (\u2018text\u2019) s'usen per a citacions dins d'una citació. "
                       "No és recomanable usar les cometes anglosaxones com a primer recurs en textos catalans.",
        "category": "Tipografia",
        "source": "IEC Ortografia catalana 2017, §6.4",
    },
    {
        "name": "Majúscules en català",
        "description": "En català, els mesos i els dies de la setmana s'escriuen en minúscula: "
                       "gener, febrer, dilluns, dimarts. No 'Gener', 'Febrer'. "
                       "Els títols de llibres, pel·lícules i obres en català s'escriuen "
                       "amb majúscula inicial i resta en minúscula: 'La plaça del Diamant' (no 'La Plaça Del Diamant'). "
                       "Les institucions porten majúscula: l'Ajuntament de Barcelona, la Generalitat.",
        "category": "Ortografia",
        "source": "IEC Ortografia catalana 2017, §7.1–7.3",
    },

    # ── LÉXICO NORMATIU ───────────────────────────────────────────────────────
    {
        "name": "'Àdhuc' vs 'fins i tot'",
        "description": "'Àdhuc' és un arcaisme literari equivalent a 'fins i tot' o 'també'. "
                       "En textos moderns i divulgatius, és preferible 'fins i tot' per naturalitat. "
                       "En textos literaris o assagístics formals, 'àdhuc' és perfectament correcte.",
        "category": "Léxico",
        "source": "IEC DIEC2; Optimot",
    },
    {
        "name": "Ús de 'hom' (pronom indefinit)",
        "description": "'Hom' és el pronom indefinit equivalent a 'un' / 'la gent' / 'se' (castellà): "
                       "'Hom diu que...' = 'S'afirma que...'. "
                       "És un recurs elegant en textos formals per evitar la passiva o l'impersonal amb 'es'. "
                       "No és un arcaisme, és viu en la llengua formal catalana.",
        "category": "Léxico",
        "source": "IEC GIEC §16.5; DIEC2",
    },
    {
        "name": "Verbs de règim: 'adonar-se de' / 'recordar-se de' / 'oblidar-se de'",
        "description": "Els verbs pronominals 'adonar-se', 'recordar-se', 'oblidar-se' regeixen 'de' + infinitiu o 'de + que': "
                       "Corr.: 'Em vaig adonar de l'error'; 'Et recordes de vindre?'; 'S'ha oblidat de nosaltres'. "
                       "Incorr. (per calc del castellà): 'em vaig adonar l'error', 'recorda vindre'.",
        "category": "Gramàtica",
        "source": "IEC GIEC §28.3; Optimot",
    },
    {
        "name": "'Alhora' vs 'a l'hora'",
        "description": "'Alhora' (una paraula) és adverbi de temps = al mateix temps, simultàniament: "
                       "'El projecte és urgent i complex alhora'. "
                       "'A l'hora' (dues paraules + article) = en el moment: 'A l'hora de dinar'. "
                       "Confondre'ls és un error freqüent.",
        "category": "Ortografia",
        "source": "IEC DIEC2; Optimot",
    },
    {
        "name": "'Sinó' vs 'si no'",
        "description": "'Sinó' (conjunció adversativa) s'escriu en una sola paraula: "
                       "'No és un problema de temps, sinó de voluntat'. "
                       "'Si no' (condicional negatiu) s'escriu en dues paraules: "
                       "'Si no fas res, empitjorarà'. "
                       "Paral·lel al cas en castellà.",
        "category": "Ortografia",
        "source": "IEC Ortografia catalana 2017; DIEC2",
    },

    # ── GESTIÓ DE PRÉSTECS ────────────────────────────────────────────────────
    {
        "name": "Manlleus no adaptats: cursiva obligatòria",
        "description": "Els manlleus no adaptats al català (anglicismes, llatinismes, etc.) han d'anar en cursiva: "
                       "*know-how*, *in vitro*, *leitmotiv*. "
                       "Si la paraula té equivalent català homologat per Termcat, s'ha d'usar l'equivalent: "
                       "'en línia' (no *online*), 'tauleta' (no *tablet*).",
        "category": "Tipografia",
        "source": "IEC Ortografia catalana 2017, §2.1; Termcat",
    },

    # ── SENSIBILITAT I RISC EDITORIAL ─────────────────────────────────────────
    {
        "name": "Ús inclusiu del gènere en català",
        "description": "En català, l'ús del masculí genèric és normatiu, però en textos institucionals "
                       "i de comunicació pública és habitual buscar fórmules inclusives: "
                       "'les persones usuàries' en lloc de 'els usuaris', desdoblaments quan escaigui, "
                       "o formes neutres com 'l'alumnat', 'el professorat', 'la ciutadania'. "
                       "Indicar al corrector si el text segueix una guia d'estil inclusiu específica.",
        "category": "Sensibilitat",
        "source": "Departament de Política Lingüística; Guia d'usos no sexistes de la llengua",
    },
]
