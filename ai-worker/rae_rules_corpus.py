"""
rae_rules_corpus.py
-------------------
Corpus canónico de reglas RAE / Fundéu para CalíopeBot.
Módulo de datos puro — sin side-effects, sin imports externos.
Importar desde main.py y desde scripts/seed_rae_rules.py.
"""

RAE_RULES = [
    # ── ORTOGRAFÍA GENERAL ────────────────────────────────────────────────
    {
        "name": "Tilde diacrítica en «solo»",
        "description": "Desde la Ortografía RAE 2010, el adverbio «solo» no lleva tilde. Tampoco los pronombres demostrativos (este, ese, aquel). Solo se acepta la tilde cuando hay riesgo real de ambigüedad, y únicamente en textos literarios con nota editorial.",
        "category": "typography",
        "source": "RAE Ortografía 2010, §13.6",
    },
    {
        "name": "Tilde en «guion», «truhan», «hui»",
        "description": "Las palabras monosílabas como «guion», «truhan», «hui», «fui», «fue» no llevan tilde, independientemente de si sus vocales se interpretan en hiato o diptongo.",
        "category": "typography",
        "source": "RAE Ortografía 2010, §3.4.2",
    },
    {
        "name": "Mayúsculas en títulos",
        "description": "En español, los títulos de obras (libros, películas, canciones) solo llevan mayúscula en la primera palabra y los nombres propios. No se usa mayúscula en todas las palabras significativas (sistema anglosajón). Ej: correcto «El nombre de la rosa»; incorrecto «El Nombre De La Rosa».",
        "category": "typography",
        "source": "RAE Ortografía 2010, §4.1.9",
    },
    {
        "name": "Punto tras siglas y abreviaturas",
        "description": "Las siglas no llevan punto ni espacio entre letras (ONU, ISBN, RAE). Las abreviaturas sí llevan punto (pág., vol., núm.). Los acrónimos que se pronuncian como palabras se escriben en minúsculas si se consolidan (láser, radar).",
        "category": "typography",
        "source": "RAE Ortografía 2010, §7",
    },
    {
        "name": "Uso correcto de «etc.»",
        "description": "La abreviatura «etc.» ya include el punto de abreviatura, por lo que nunca va seguida de puntos suspensivos (incorrecto: «etc...»). Tampoco se combina con «y» (incorrecto: «y etc.»).",
        "category": "grammar",
        "source": "RAE DPD, s.v. etcétera",
    },
    # ── PUNTUACIÓN ────────────────────────────────────────────────────────
    {
        "name": "Raya para diálogos (—)",
        "description": "En textos literarios en español se usa la raya (—) para introducir el diálogo, no el guion corto (-). La raya de apertura no va precedida de espacio; la raya de cierre va seguida de espacio si continuará narración. Ej: «—Buenos días —dijo ella—. ¿Cómo estás?»",
        "category": "typography",
        "source": "RAE Ortografía 2010, §4.7.2",
    },
    {
        "name": "Comillas españolas («»)",
        "description": "En textos literarios en español se prefieren las comillas angulares o españolas («»). Las comillas inglesas (\"\") se reservan para citas dentro de citas. Las simples ('') para citas dentro de las inglesas.",
        "category": "typography",
        "source": "RAE Ortografía 2010, §4.8",
    },
    {
        "name": "Puntuación tras comillas y paréntesis de cierre",
        "description": "El punto va siempre fuera de las comillas y paréntesis de cierre cuando estos no terminan una oración independiente. Ej: correcto «Me dijo «hola».»; incorrecto «Me dijo «hola.»».",
        "category": "typography",
        "source": "RAE Ortografía 2010, §4.8.4",
    },
    {
        "name": "Coma antes de «pero», «sino», «aunque»",
        "description": "Las conjunciones adversativas «pero», «sino» y «aunque» van precedidas de coma cuando conectan oraciones. Ej: «Quería ir, pero no pudo». Excepción: no se pone coma si «pero» es enfático en expresiones exclamativas cortas.",
        "category": "grammar",
        "source": "RAE Ortografía 2010, §4.1.3",
    },
    {
        "name": "Punto y coma en enumeraciones complejas",
        "description": "Cuando los elementos de una enumeración son extensos o contienen comas internas, se separan con punto y coma. Ej: «Vino de Madrid, España; París, Francia; y Roma, Italia.»",
        "category": "typography",
        "source": "RAE Ortografía 2010, §4.5",
    },
    {
        "name": "No coma entre sujeto y verbo",
        "description": "En español no se pone coma entre el sujeto y el verbo, aunque el sujeto sea largo. Ej: incorrecto «Los alumnos que llegaron tarde, no pudieron entrar.»",
        "category": "grammar",
        "source": "RAE Ortografía 2010, §4.1",
    },
    {
        "name": "Dos puntos en cartas y salutaciones",
        "description": "En cartas y documentos formales, tras la fórmula de saludo van dos puntos (no coma). Ej: «Estimado señor García:». La línea siguiente empieza con mayúscula.",
        "category": "format",
        "source": "RAE Ortografía 2010, §4.4",
    },
    # ── GRAMÁTICA ────────────────────────────────────────────────────────
    {
        "name": "Leísmo: uso incorrecto de «le» como objeto directo",
        "description": "El leísmo (usar «le» en lugar de «lo/la» para objeto directo) es incorrecto salvo en «le» de cortesía para personas masculinas (aceptado). Ej: incorrecto «Le vi ayer» (a él); correcto «Lo vi ayer».",
        "category": "grammar",
        "source": "RAE DPD, s.v. leísmo",
    },
    {
        "name": "Dequeísmo y queísmo",
        "description": "El dequeísmo consiste en añadir «de» incorrectamente antes de «que» en subordinadas sustantivas (incorrecto: «pienso de que...»). El queísmo omite «de» cuando es necesario (incorrecto: «me alegro que...»; correcto: «me alegro de que...»).",
        "category": "grammar",
        "source": "RAE DPD, s.v. dequeísmo",
    },
    {
        "name": "Concordancia de género en sustantivos con artículo",
        "description": "Los sustantivos femeninos que empiezan por /a/ tónica usan el artículo «el» en singular para evitar cacofonía (el agua, el hacha), pero mantienen su género femenino: «el agua fría», no «el agua frío».",
        "category": "grammar",
        "source": "RAE DPD, s.v. artículo",
    },
    {
        "name": "Uso de «cual»/«cuyo» como relativos",
        "description": "«Cuyo» es un relativo posesivo que concuerda con el sustantivo que le sigue, no con el antecedente. Incorrecto: «El libro cuyo autor lo conozco». Correcto: «El libro cuyo autor conozco».",
        "category": "grammar",
        "source": "RAE DPD, s.v. cuyo",
    },
    {
        "name": "Infinitivo no debe concordar con objeto",
        "description": "El infinitivo es invariable. Incorrecto: «Hay que leeros (los libros)». Correcto: «Hay que leer los libros» o «Hay que leerlos».",
        "category": "grammar",
        "source": "RAE Nueva Gramática §26",
    },
    {
        "name": "Gerundio de posterioridad incorrecto",
        "description": "El gerundio expresa simultaneidad o anterioridad, nunca posterioridad. Incorrecto: «Cayó al suelo, rompiéndose la pierna» (si la rotura fue posterior). Correcto: «Cayó al suelo y se rompió la pierna».",
        "category": "grammar",
        "source": "RAE DPD, s.v. gerundio",
    },
    {
        "name": "Perífrasis «volver a + infinitivo»",
        "description": "La perífrasis «volver a + infinitivo» expresa repetición. No debe confundirse con «volver» intransitivo. Implica que la acción ya ocurrió antes.",
        "category": "grammar",
        "source": "RAE Nueva Gramática §28.6",
    },
    {
        "name": "Uso de «haber» impersonal",
        "description": "El verbo «haber» como impersonal no se conjuga en plural. Incorrecto: «Habían muchas personas». Correcto: «Había muchas personas». Aunque el uso plural está muy extendido, la normativa RAE lo considera incorrecto.",
        "category": "grammar",
        "source": "RAE DPD, s.v. haber",
    },
    # ── ESTILO LITERARIO ─────────────────────────────────────────────────
    {
        "name": "Latinismos y extranjerismos en cursiva",
        "description": "Las palabras de otras lenguas no adaptadas al español se escriben en cursiva: «in situ», «grosso modo», «thriller», «leitmotiv». Los extranjerismos adaptados ortográficamente van en redonda: «fútbol», «mitin».",
        "category": "style",
        "source": "RAE Ortografía 2010, §6",
    },
    {
        "name": "Numerales: cifras vs. palabras",
        "description": "Del uno al nueve se escriben con letra; del 10 en adelante, con cifra en contextos científicos y técnicos. En textos literarios y humanísticos, se prefiere escribir con letra hasta el cien, y siempre cuando van a inicio de oración.",
        "category": "style",
        "source": "RAE Ortografía 2010, §7.9",
    },
    {
        "name": "Porcentajes y unidades",
        "description": "El símbolo «%» va pegado al número y separado por espacio fino o normal según estilo editorial: «25 %» (con espacio) es la forma preferida en la RAE. El símbolo no lleva punto.",
        "category": "format",
        "source": "RAE Ortografía 2010, §7.10",
    },
    {
        "name": "Fechas: formato textual en literatura",
        "description": "En textos literarios las fechas se escriben con letras: «el tres de agosto de mil novecientos setenta». En textos técnicos se aceptan las cifras con guiones o barras: «03/08/1970» o «3-8-1970».",
        "category": "format",
        "source": "RAE Ortografía 2010, §7.11",
    },
    {
        "name": "Tratamientos y títulos honoríficos",
        "description": "Los títulos y tratamientos (señor, doctor, presidente) se escriben con minúscula cuando van seguidos del nombre. Se usan con mayúscula solo cuando se usan en función apelativa solos, sin nombre. Ej: correcto «el señor García» / «Disculpe, Señor».",
        "category": "style",
        "source": "RAE Ortografía 2010, §4.1.8",
    },
    {
        "name": "Puntos suspensivos: uso y combinación",
        "description": "Los puntos suspensivos son exactamente tres (…). No se combinan con el punto final (incorrecto: «….»). Si van tras una abreviatura que ya lleva punto, son cuatro en total. Cuando expresan pausa o duda, van pegados a la palabra anterior.",
        "category": "typography",
        "source": "RAE Ortografía 2010, §4.9",
    },
    {
        "name": "Uso de paréntesis vs. raya en incisos",
        "description": "Los incisos explicativos pueden ir entre paréntesis (más aislados del discurso principal) o entre rayas —más integrados—. El guion corto (-) no debe usarse para incisos; es exclusivo del guion de unión.",
        "category": "typography",
        "source": "RAE Ortografía 2010, §4.7",
    },
    {
        "name": "No usar «y/o»",
        "description": "La combinación «y/o» es un calco del inglés «and/or» innecesario en español. Generalmente basta con «o» (que en español ya puede ser inclusiva). En caso necesario, puede expandirse: «A o B, o ambos».",
        "category": "style",
        "source": "RAE DPD, s.v. y/o",
    },
    {
        "name": "Uso correcto del paréntesis para opciones de género",
        "description": "Las formas del tipo «el/la director/a» deben evitarse en textos corridos. Se prefieren soluciones como el masculino genérico, las formas comunes de dos géneros «el/la estudiante», o bien en documentos formales la duplicación completa.",
        "category": "style",
        "source": "RAE 2020, Informe sobre el lenguaje inclusivo",
    },
    # ── ORTOTIPOGRAFÍA ESPECÍFICA ─────────────────────────────────────────
    {
        "name": "Espacio antes de signos de puntuación de apertura",
        "description": "Los signos dobles de puntuación (¿, ¡, «, —) de apertura van pegados a la primera letra que les sigue, con un espacio antes. Los de cierre (?, !, », —) van pegados a la última letra, con espacio después.",
        "category": "typography",
        "source": "RAE Ortografía 2010, §4.1.1",
    },
    {
        "name": "Guion de unión vs. raya",
        "description": "El guion corto (-) se usa para: palabras compuestas en formación (teórico-práctico), división de palabras al final de línea, y unión de palabras en algunos compuestos. La raya (—) es para incisos y diálogos. El guion medio (–) se usa para rangos numéricos (pp. 23–45).",
        "category": "typography",
        "source": "RAE Ortografía 2010, §4.7.1",
    },
    {
        "name": "Versalitas para nombres de autor en referencias",
        "description": "En referencias bibliográficas y notas, los apellidos de autor se escriben en versalitas (SMALL CAPS), no en mayúsculas plenas. El nombre puede ir completo o abreviado según estilo editorial.",
        "category": "format",
        "source": "RAE Ortografía 2010, §4.3",
    },

    # ── REGLAS ESPECÍFICAS DEL INFORME — DEQUEÍSMO ────────────────────────
    {
        "name": "Dequeísmo con «opinar»",
        "description": "El verbo «opinar» rige complemento directo introducido por «que», nunca por «de que». Incorrecto: «Muchos expertos opinan de que el sistema necesita cambios». Correcto: «opinan que el sistema necesita cambios». Prueba de sustitución: si puedes reemplazar la subordinada por «eso» sin «de», no se usa «de que».",
        "category": "grammar",
        "source": "RAE DPD, s.v. dequeísmo",
    },
    {
        "name": "Dequeísmo con «pensar»",
        "description": "El verbo «pensar» no rige preposición «de» ante completiva. Incorrecto: «Hay quienes piensan de que la tecnología resolverá el problema». Correcto: «piensan que la tecnología resolverá el problema». Prueba: «piensan eso» (no «piensan de eso»).",
        "category": "grammar",
        "source": "RAE DPD, s.v. dequeísmo",
    },
    {
        "name": "Dequeísmo: verbos que NUNCA llevan «de que»",
        "description": "Los verbos de opinión y pensamiento (creer, pensar, opinar, decir, saber, recordar, suponer, imaginar, soñar) van seguidos de «que» directamente. Si se añade «de» es dequeísmo. Prueba: sustituye la subordinada por «eso»; si no cabe «de eso», tampoco cabe «de que».",
        "category": "grammar",
        "source": "RAE DPD, s.v. dequeísmo",
    },

    # ── REGLAS ESPECÍFICAS — RÉGIMEN PREPOSICIONAL ────────────────────────
    {
        "name": "Régimen preposicional: «en relación con» / «con relación a»",
        "description": "La locución preposicional correcta es «con relación a» o «en relación con». La forma híbrida «en relación a» es incorrecta. Ej. incorrecto: «En relación a este tema, cabe señalar…». Correcto: «En relación con este tema» o «Con relación a este tema».",
        "category": "grammar",
        "source": "RAE DPD, s.v. relación",
    },

    # ── REGLAS ESPECÍFICAS — TILDES DIACRÍTICAS ───────────────────────────
    {
        "name": "Tilde diacrítica en «él» (pronombre personal)",
        "description": "El pronombre personal «él» siempre lleva tilde para distinguirlo del artículo «el». Ej. correcto: «creyó en él»; incorrecto: «creyó en el» (cuando se refiere a una persona). Norma: OLE 2010, §3.4.3.1.",
        "category": "grammar",
        "source": "RAE Ortografía 2010, §3.4.3.1",
    },
    {
        "name": "Tilde diacrítica en «cuál» interrogativo indirecto",
        "description": "El pronombre «cuál» lleva tilde diacrítica cuando funciona como interrogativo o exclamativo, aunque la pregunta sea indirecta. Ej. incorrecto: «no se sabe cual debe ser el objetivo». Correcto: «cuál debe ser el objetivo».",
        "category": "grammar",
        "source": "RAE Ortografía 2010, §3.4.3.3",
    },
    {
        "name": "«Dio», «fue», «vio» no llevan tilde",
        "description": "Los monosílabos «dio», «fue», «vio» no llevan tilde. Son monosílabos sin par diacrítico. Ej. incorrecto: «le dió las herramientas». Correcto: «le dio las herramientas». La RAE eliminó esta tilde en 1959 y ratificó en 2010.",
        "category": "grammar",
        "source": "RAE Ortografía 2010, §3.4.1.1",
    },
    {
        "name": "Demostrativos (este, ese, aquel) sin tilde",
        "description": "Desde la OLE 2010, los pronombres demostrativos (este, ese, aquel, esta, esa, aquella y sus plurales) NO llevan tilde en ningún caso. Ej. incorrecto: «consideran que ésta es fundamental»; correcto: «esta es fundamental». Tampoco «aquéllos»; correcto: «aquellos».",
        "category": "grammar",
        "source": "RAE Ortografía 2010, §3.4.3.3",
    },
    {
        "name": "«A fin de» sin tilde (no «a fín de»)",
        "description": "La locución preposicional es «a fin de» (sin tilde). «Fin» es monosílabo y no lleva tilde. La forma «a fín de» es incorrecta y resultado de ultracorrección.",
        "category": "typography",
        "source": "RAE Ortografía 2010, §3.4.1",
    },

    # ── REGLAS ESPECÍFICAS — EXTRANJERISMOS ───────────────────────────────
    {
        "name": "«online» → «en línea»",
        "description": "El extranjerismo «online» debe sustituirse por el equivalente español «en línea» o escribirse en cursiva si se mantiene. La RAE recomienda «en línea» (OLE 2010, §2.1.2).",
        "category": "style",
        "source": "RAE OLE 2010, §2.1.2; Fundéu",
    },
    {
        "name": "«curriculum» → «currículo»",
        "description": "La forma adaptada al español del latinismo «curriculum» es «currículo» (con tilde y terminación española). El uso de «curriculum» sin adaptar se considera innecesario cuando existe la forma española. DLE, 23.ª ed.",
        "category": "style",
        "source": "RAE DLE 23.ª ed., s.v. currículo",
    },
    {
        "name": "«tablets» → «tabletas»",
        "description": "El anglicismo «tablet/tablets» debe sustituirse por «tableta/tabletas» o escribirse en cursiva. La RAE recomienda «tableta» (DLE, 23.ª ed.). Ej. incorrecto: «El uso de tablets»; correcto: «El uso de tabletas».",
        "category": "style",
        "source": "RAE DLE 23.ª ed., s.v. tableta",
    },
    {
        "name": "«jugar un rol» → «desempeñar un papel»",
        "description": "La expresión «jugar un rol» es calco del inglés «play a role» / francés «jouer un rôle». En español se dice «desempeñar un papel» o «cumplir una función». «Rol» está aceptado por la RAE en contextos sociológicos y teatrales, pero «jugar un rol» sigue siendo calco.",
        "category": "style",
        "source": "RAE DPD; Fundéu",
    },

    # ── REGLAS ESPECÍFICAS — LÉXICO Y MORFOLOGÍA ──────────────────────────
    {
        "name": "«sustituir» (no «substituir»)",
        "description": "La forma normativa preferida es «sustituir». La variante «substituir» es arcaica y desaconsejada por la RAE. Ej. incorrecto: «el riesgo de substituir al profesor»; correcto: «el riesgo de sustituir al profesor».",
        "category": "grammar",
        "source": "RAE DPD, s.v. sustituir",
    },
    {
        "name": "«conciencia» (no «consciencia» para uso ético/moral)",
        "description": "En el sentido de 'conocimiento moral' o 'percatarse de algo', la forma normativa es «conciencia». «Consciencia» existe referida al estado de vigilia. La locución fija es «tomar conciencia», no «tomar consciencia».",
        "category": "grammar",
        "source": "RAE DPD, s.v. conciencia",
    },
    {
        "name": "«por ciento» (no «por cien» tras numeral)",
        "description": "La forma completa es «por ciento». La apócope «por cien» solo es válida antepuesta directamente a un sustantivo (cien por cien). Tras un numeral es incorrecto: «el 35 por cien de los centros» → correcto: «el 35 por ciento de los centros».",
        "category": "grammar",
        "source": "RAE DPD, s.v. ciento",
    },
    {
        "name": "«sino» (conjunción adversativa) vs. «si no» (condicional negativa)",
        "description": "La conjunción adversativa «sino» se escribe en una sola palabra: «no solo es cuestión de justicia, sino también de solidaridad». «Si no» (dos palabras) es condicional negativa: «si no vienes, avísame».",
        "category": "grammar",
        "source": "RAE OLE 2010; DPD, s.v. sino",
    },
    {
        "name": "Mezcla de cifras y palabras en numerales",
        "description": "Los numerales no deben mezclar cifras y palabras en el mismo número. Incorrecto: «para el año 2000 veintisiete». Correcto: «para el año 2027» o «para el año dos mil veintisiete». Norma: OLE 2010, §5.2.",
        "category": "style",
        "source": "RAE Ortografía 2010, §5.2",
    },

    # ── REGLAS ESPECÍFICAS — PREFIJOS ─────────────────────────────────────
    {
        "name": "Prefijos se escriben sin guion ante palabra simple",
        "description": "Los prefijos (socio-, extra-, pre-, anti-, sub-, inter-, etc.) se escriben unidos sin guion cuando la base es una palabra simple: «sociocultural» (no «socio-cultural»), «extraescolar» (no «extra-escolar»). El guion solo se usa ante siglas, nombres propios o cuando la base es un numeral.",
        "category": "typography",
        "source": "RAE Ortografía 2010, §4.1.1.2",
    },
    {
        "name": "«máster» (no «Master» ni «master»)",
        "description": "La voz adaptada al español es «máster» en minúscula con tilde (llana terminada en consonante distinta de -n/-s). «Master» sin tilde y con mayúscula «Master» son incorrectos. Ej. incorrecto: «El Master de Formación»; correcto: «El máster de formación».",
        "category": "style",
        "source": "RAE DLE 23.ª ed., s.v. máster",
    },

    # ── REGLAS ESPECÍFICAS — ORTOTIPOGRAFÍA ───────────────────────────────
    {
        "name": "División silábica correcta de palabras con guion tipográfico",
        "description": "Al dividir palabras al final de línea con guion tipográfico, no puede separarse un grupo consonántico dejando consonante de inicio silábico al inicio de línea. La sílaba debe respetar la estructura silábica española. «adap-tán-do-se» es correcto; «adaptan-dose» (sin tilde) es incorrecto. Los gerundios con enclítico forman una sola palabra y llevan tilde si son esdrújulos.",
        "category": "typography",
        "source": "RAE Ortografía 2010, §4.2",
    },
]

