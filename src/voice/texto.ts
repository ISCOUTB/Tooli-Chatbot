// Texto de la llamada. Portado de FastFood (src/lib/voice/text.ts): lo que dice quien llama se normaliza y se trata
// como DATO, nunca como orden; lo que dice el bot se limpia para voz. Lo del restaurante (platos, pagos, tamaños) se
// quitó; se añadió el léxico de pronunciación, los pesos y fechas habladas y la lectura de dígitos dictados.
// Módulo puro: sin red ni base.

export const MAX_CALLER_TEXT = 300;
export const MAX_REPLY_TEXT = 420;

export function normalizeSpeech(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    // «eeeepale», «mmmmm», «ehhh»: ninguna palabra del español lleva tres letras iguales seguidas.
    .replace(/([a-zñ])\1{2,}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Recorta y quita caracteres de control / marcas que no salen de una transcripción de voz real. */
export function sanitizeCallerText(text: string): string {
  return text
    // «[ruido de claxon]», «[estática]»: anotaciones del transcriptor, no algo que la persona dijo.
    .replace(/\[[^\]]{0,60}\]/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, ' ')
    .replace(/[<>{}[\]`|\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CALLER_TEXT);
}

const YES_TOKENS = new Set([
  'si', 'sii', 'sip', 'confirmo', 'confirmado', 'confirmar', 'dale', 'listo', 'correcto', 'claro', 'perfecto', 'ok',
  'okay', 'exacto', 'asi', 'una', 'bueno', 'va', 'hagale', 'hazlo', 'adelante', 'vale',
]);
const YES_PHRASES = [
  /^si\b/, /\bconfirm/, /^dale\b/, /^listo\b/, /^de una\b/, /^correcto\b/, /^claro\b/, /^perfecto\b/, /^asi es\b/,
  /^exacto\b/, /^hagale\b/, /^adelante\b/, /^ok\b/, /^vale\b/, /^bueno si\b/, /^esta bien\b/, /^todo bien\b/,
];
// Cualquier señal de duda o cambio anula el «sí»: mejor volver a preguntar que agendar mal.
const NOT_YES = /\b(no|nop|pero|cambia|cambiar|cambio|espera|espere|mejor|otra|otro|falta|menos|mas|sin|cancela|cancelar|todavia|aun|momento|duda|cuanto|cual|que|como|porque|donde|ademas|tambien)\b/;

/** «Sí» explícito decidido en el servidor (no por la IA): frase corta, con afirmación y sin dudas ni cambios. */
export function isExplicitYes(text: string): boolean {
  const t = normalizeSpeech(text);
  if (!t || t.split(' ').length > 8) return false;
  if (NOT_YES.test(t)) return false;
  return YES_PHRASES.some((re) => re.test(t)) || t.split(' ').every((w) => YES_TOKENS.has(w) || ['senor', 'senora', 'por', 'favor', 'gracias', 'es', 'de'].includes(w));
}

export function isExplicitNo(text: string): boolean {
  const t = normalizeSpeech(text);
  return /^(no|nop|nada|cancela|cancelar|cancelalo|mejor no|todavia no|aun no|espera|espere)\b/.test(t);
}

// ------------------------------------------------------------------ palabras sin contenido

/** Muletillas e interjecciones: no dicen qué quiere la persona. */
const MULETILLA = /^(m+|h?m+h?|eh+|e+m+|a+h*|aja|ajam|ajon|ajum|uh+|ay|oh+|o+|um+|alo|pues|este|ps|jum|hn+|ea|ey|hey|epa|epale|oe|sh+|gr+|r+m*|ajuy)$/;
/** Formas de llamar a quien atiende («mijo», «mi llave», «socio»): tampoco dicen qué quiere. */
const VOCATIVO = new Set([
  'mijo', 'mija', 'mi', 'llave', 'socio', 'socia', 'compa', 'compadre', 'comadre', 'hermano', 'hermana', 'hermanito', 'mano',
  'viejo', 'vieja', 'parce', 'parcero', 'chamo', 'vato', 'caballero', 'senor', 'senora', 'senorita', 'joven', 'amigo', 'amiga',
  'bot', 'robot', 'tooli', 'amor', 'reina', 'mami', 'papi', 'oiga', 'oye', 'mire', 'mira', 've', 'bueno', 'diga', 'digame', 'hombe', 'hombre',
]);
const CORTESIA = new Set(['por', 'favor', 'porfa', 'porfis', 'porfavor', 'gracias', 'perdon', 'disculpa', 'disculpe', 'pena']);

/** Vocativos que nunca son respuesta («bueno», «diga», «mire» sí pueden serlo y no cuentan como ruido). */
const VOCATIVO_PURO = new Set([...VOCATIVO].filter((w) => !['bueno', 'diga', 'digame', 'oiga', 'oye', 'mire', 'mira', 've'].includes(w)));

/** Palabras que sí dicen algo (sin muletillas, vocativos ni cortesías). Recibe texto ya normalizado. */
export function palabrasConContenido(t: string): string[] {
  return t.split(' ').filter((w) => w && !MULETILLA.test(w) && !VOCATIVO.has(w) && !CORTESIA.has(w));
}

// ------------------------------------------------------------------ pedir una persona

const VERBO_PASAR =
  '(hablar|comunicar|comunicarme|comuniqueme|comunicame|comunique|comuniquen|comunica|comunican|pasar|pasarme|pasame|paseme|pase|pasen|pasenme|pasa|pasan|transfier\\w*|transferir\\w*|conecte\\w*|conectar\\w*|contactar|contactarme)';
const DESTINO_PERSONA =
  '(alguien|una persona|un humano|una humana|un ser humano|persona|humano|asesor|asesora|asesores|funcionario|funcionaria|operador|operadora|agente|coordinador|coordinadora|coordinacion|director|directora|secretaria|admisiones|admision|soporte|mesa de ayuda|cartera|tesoreria|financiera|supervisor|supervisora|jefe|encargado|encargada|gente|personal)';

const HUMAN_PATTERNS = [
  // «páseme con admisiones», «me pasa con alguien», «me puede comunicar con un coordinador»
  new RegExp(`\\b${VERBO_PASAR}\\b(\\s+\\w+){0,3}?\\s+(con|a)\\s+(el |la |los |las |un |una |alguno de |alguien de )?${DESTINO_PERSONA}\\b`),
  /\bno quiero (hablar )?(con )?(un|una)? ?(robot|maquina|ia|inteligencia|grabacion|contestadora)\b/,
  /^(operador|asesor|asesora|humano|persona|agente)$/,
  // «páseme con un man de esos asesores»: verbo de pasar y, más adelante, a quién.
  /\b(hablar|comunicar\w*|comuniqu\w*|pas(ar|e|en|a|an|ame|eme|enme|arme)|transfier\w*)\b(\s+\w+){0,6}?\s+(persona|humano|alguien|asesor|asesora|asesores|funcionario|operador|agente)\b/,
  // Pedir cita es pedir asesor: «quiero hacer una cita», «agéndenme», «solicito una cita», «coordinar una reunión».
  /\b(hacer|separar|separe|separeme|solicito|solicitar|pedir|pido|sacar|programar|reservar|quiero|necesito|coordinar|cuadrar|tener|dar|deme|dame|denme)\b(\s+\w+){0,3}?\s+(una |un |la )?(cita|citas|reunion)\b/,
  /\bagend(ar|arme|ame|eme|e|es|en|enlo|enme|emos|amos)\b/,
];
// Pedidos que dependen de una palabra suelta («una persona», «un asesor»): no cuentan si en realidad pregunta con quién
// habla («¿hablo con una grabación o con una persona real?»).
const HUMAN_SUELTO = [
  /\b(necesito|quiero|requiero|exijo)\b.*\b(persona|humano|alguien|asesor|asesora|asesores|funcionario|operador|agente)\b/,
  /\b(una persona|un humano|un asesor|una asesora|un operador|una persona real|un funcionario|de carne y hueso)\b/,
];
const PREGUNTA_IDENTIDAD =
  /\b(hablo|estoy hablando|hablando) con (una |un )?(grabacion|maquina|robot|contestadora|persona|humano|ia|bot)\b|\b(eres|es usted|usted es|sos|es) (una |un )?(persona|humano|robot|maquina|grabacion|contestadora|bot|ia|inteligencia artificial)( real| de verdad)?\b/;

function normalizarPersona(text: string): string {
  // Transcripciones partidas: «as esor» → «asesor».
  return normalizeSpeech(text).replace(/\bas esor/g, 'asesor');
}

export function isHumanRequest(text: string): boolean {
  const t = normalizarPersona(text);
  if (HUMAN_PATTERNS.some((re) => re.test(t))) return true;
  return !PREGUNTA_IDENTIDAD.test(t) && HUMAN_SUELTO.some((re) => re.test(t));
}

/** «¿Hablo con una persona real?», «¿eres un robot?»: pregunta con quién habla; no está pidiendo un asesor. */
export function isIdentityQuestion(text: string): boolean {
  return PREGUNTA_IDENTIDAD.test(normalizarPersona(text));
}

// ------------------------------------------------------------------ devolución de la llamada

// Llamar, marcar, timbrar, contactar CON «me/nos» delante o pegado: «me puede llamar», «llámenme», «que me marquen».
// «me llamo Juan» y «me están llamando» no casan (forma distinta del verbo).
const ME_LLAMAN =
  /\b(me|nos)\s+(\w+\s+){0,3}?(llamar|llaman|llamen|llama|llamas|llamaria|llamarian|rellamas|rellaman|rellamen|rellama|marcan|marquen|marcas|timbran|timbren|contactan|contacten|contacta|contactas)\b(?! la atencion)/;
const LLAMAME =
  /\b(llamenme|llameme|llamame|llamarme|llamenos|rellamame|rellameme|rellamarme|marqueme|marquenme|marcame|marcarme|timbreme|timbrame|timbrarme|contacteme|contactenme|contactame|contactarme)\b/;
// Devolver / regresar solo cuenta si habla de la llamada («que me devuelvan la plata» es otra cosa).
const DEVOLVER = /\b(devuelv\w*|devolv\w*|regres\w*)\b/;
const DAME_UNA_LLAMADA = /\b(dame|deme|denme|da|dan|dar|das|echeme|echenme|echar|eche|echen|pegue|pegueme|hagame|hagan|haga|hace|hacen)\b(\s+\w+){0,4}?\s+(una |un )?(llamad\w*|timbrazo|repique)\b/;
const DEJO_MI_NUMERO =
  /\b(anote|anota|anoten|anoteme|anotame|apunte|apunta|apunten|apunteme|guarde|guarda|guarden|tome|toma|tomen|deja|dejo|dejar|deje|registre|registra)\b(\s+\w+){0,2}?\s+(mi|el|este|un)\s+(numero|telefono|celular|cel|contacto|movil)\b/;
// «Mi número es 300…»: un teléfono dictado. «Mi número es T 0 0…» es el código estudiantil, no un teléfono.
const MI_NUMERO_ES = /\b(mi|este) (numero|telefono|celular|cel|movil)( de (contacto|celular))? es\b/;

/**
 * Pide que le devuelvan la llamada: «llámenme después», «¿me pueden marcar luego?», «devuélvame la llamada», «dame una
 * llamadita más tarde», «anote mi número», o dicta un celular de 10 dígitos. Se usa el número desde el que llama.
 */
export function isCallbackRequest(text: string): boolean {
  // «me mandaron a llamar», «me dijeron que llamara»: le pidieron que llamara ÉL.
  const t = normalizeSpeech(text).replace(/\b(mandaron|mando|dijeron|dijo|pidieron|recomendaron|tocaba|toco) (a )?llamar\b/g, ' ');
  if (ME_LLAMAN.test(t) || LLAMAME.test(t) || DAME_UNA_LLAMADA.test(t) || DEJO_MI_NUMERO.test(t)) return true;
  if (MI_NUMERO_ES.test(t) && digitosDictados(t).length >= 7 && !codigoEstudiantilDictado(t) && !/\b(es|el) (t|te)\b/.test(t)) return true;
  if (DEVOLVER.test(t) && /\bllamad\w*\b/.test(t)) return true;
  // Un celular colombiano dictado (3xx xxx xxxx) sin que nadie se lo pidiera: quiere que lo llamen.
  return /\b3\d{2}\s?\d{3}\s?\d{4}\b/.test(t);
}

// ------------------------------------------------------------------ despedida, repetir, línea

/** «Chao», «adiós»: despedida de verdad. También «me equivoqué de número» dicho solo. */
export function isGoodbye(text: string): boolean {
  const t = normalizeSpeech(text);
  if (/^((muchas )?gracias )?(chao|chau|adios|hasta luego|nada mas( gracias)?|eso es todo( gracias)?|eso era todo( gracias)?|listo gracias chao|bueno chao|gracias adios)( gracias)?$/.test(t)) return true;
  return /\b(me equivoque|equivoque|numero equivocado|marque mal|numero errado)\b/.test(t) && palabrasConContenido(t).length <= 5;
}

const REPETIR_EXPLICITO =
  /\b(repite|repita|repites|repiteme|repitame|repitelo|repitalo|repitamelo|repitemelo|repitanme|(puede|podria|puedes|podrias|pueden|me) (repetir|repetirlo|repetirme|repetirmelo)|vuelv[ae] a decir\w*|vuelv[ae] a repetir\w*)\b/;
const NO_OIGO =
  /\b(no (te |le |lo |la |les |se )?(escuche|escucho|escucha|oi|oigo|oye)|ni se (escucha|oye)|no (te |le )?entendi|habl[ae] mas (fuerte|despacio|duro|alto)|se (cae|corta|corto|cayo|esta cortando|entrecorta|oye mal|escucha mal)|(mucho|tremendo|harto|demasiado) (ruido|eco))\b/;

/**
 * Quiere oír otra vez lo último: «¿qué?», «repítame», «no te escuché», «¿otra vez?». Solo si la frase es corta o el
 * pedido es explícito: «mi hija quiere estudiar otra vez» o «no me diga que otra vez…» NO es pedir que repita.
 */
export function isRepeatRequest(text: string): boolean {
  const t = normalizeSpeech(text);
  const n = palabrasConContenido(t).length;
  if (/^(que|como|perdon|disculpa|disculpe|eh|mande|digame|ah|ey|como dice|como dijo|que dijo|que dijiste|que dice)$/.test(t)) return true;
  // «grrr… uh? ¿qué?»: lo único con contenido es «qué».
  if (/^(que|como|mande|que dijo|que dijiste|como dice)$/.test(palabrasConContenido(t).join(' '))) return true;
  if (REPETIR_EXPLICITO.test(t) && n <= 10) return true;
  if (/\b(otra vez|de nuevo|nuevamente)\b/.test(t) && n <= 3) return true;
  if (/\b(que dijiste|que dijo|que me dijo|que me dijiste|como dijiste|como dijo)\b/.test(t) && n <= 4) return true;
  return isLineTrouble(text);
}

/** «No te escucho», «se cae la llamada», «mucho ruido», dicho corto: problema de audio de su lado. */
export function isLineTrouble(text: string): boolean {
  const t = normalizeSpeech(text);
  return NO_OIGO.test(t) && palabrasConContenido(t).length <= 6;
}

const MARCA_LINEA =
  /\b(alo+h?|halo|hello|me (escucha|escuchas|escuchan|oye|oyes|oyen)|se (escucha|oye)|hay alguien|alguien (ahi|en la linea)|(esta|estas|sigue|sigues|siguen) (ahi|en la linea|por ahi))\b/;
const PALABRAS_LINEA = new Set([
  'alo', 'aloh', 'halo', 'hello', 'hola', 'ola', 'me', 'escucha', 'escuchas', 'escuchan', 'oye', 'oyes', 'oyen', 'se', 'hay',
  'alguien', 'esta', 'estas', 'sigue', 'sigues', 'siguen', 'ahi', 'en', 'la', 'linea', 'si', 'aja', 'buenas', 'buenos', 'dias', 'tardes', 'noches',
]);

/**
 * Comprobación de línea: «¿aló?», «¿me escucha?», «¿hay alguien?», «¿hola?». No pide nada: se contesta «sí, te escucho»
 * y se sigue donde se iba. 'corta' = no dice nada más; 'al_final' = termina con la comprobación después de hablar con
 * otra persona («préstame el lapicero… ¿aló?»): quien la usa decide si lo de antes cuenta.
 */
export function lineCheck(text: string): 'corta' | 'al_final' | null {
  const t = normalizeSpeech(text);
  const crudo = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const conPregunta = /\b(hola|ola|oiga|oye|alo+h?|bueno|diga|aja|si)\s*\?/.test(crudo);
  if (!MARCA_LINEA.test(t) && !conPregunta) return null;
  const resto = palabrasConContenido(t).filter((w) => !PALABRAS_LINEA.has(w));
  if (resto.length <= 2) return 'corta';
  const alFinal = MARCA_LINEA.test(t.split(' ').slice(-3).join(' ')) || /\b(hola|ola|alo+h?)\s*\?$/.test(crudo);
  return alFinal ? 'al_final' : null;
}

/** «Espere», «un momento», «ya voy»: pide que lo esperen. */
export function isHoldRequest(text: string): boolean {
  const c = palabrasConContenido(normalizeSpeech(text));
  if (c.length > 4 || isCallbackRequest(text)) return false;
  return /^(espera|espere|esperame|espereme|esperate|esperen|un (momento|momentico|momentito|segundo|segundito|minuto|minutico|toque|ratico|rato)|ya (voy|vengo|vuelvo|regreso)|dame un|deme un|aguanta|aguante|aguardeme|aguarde)\b/.test(c.join(' '));
}

/** Ruido de la línea o muletillas sin contenido («mmm», «ajá», «eh…»). */
export function isNoiseOnly(text: string): boolean {
  const t = normalizeSpeech(text);
  if (!t) return true;
  // «eeepale mi llave ajá»: muletillas y vocativos, sin nada más.
  const ws = t.split(' ');
  return ws.every((w) => MULETILLA.test(w) || VOCATIVO_PURO.has(w)) && ws.some((w) => MULETILLA.test(w));
}

// Intentos de cambiar las reglas: se contestan con un texto fijo y no llegan a la IA. Lista corta y concreta: un
// falso positivo solo hace repetir la pregunta.
const INJECTION_PATTERNS = [
  /\b(ignora|ignorar|olvida|olvidate|omite|salta|desactiva)\b.*\b(instruccion|instrucciones|reglas|indicaciones|prompt|sistema|anterior|anteriores|todo)\b/,
  /\b(eres|seras|actua|actuar|comportate|finge|haz de cuenta)\b.*\b(ahora|otro|otra|como)\b.*\b(asistente|ia|modelo|sistema|admin|administrador|desarrollador|gpt|chatgpt)\b/,
  /\b(modo|mode)\s+(desarrollador|developer|dios|admin|debug|depuracion)\b/,
  /\b(system|sistema)\s*(prompt|mensaje)\b/,
  /\b(revela|muestra|dime|lee|repite)\b.*\b(instrucciones|prompt|reglas internas|configuracion|clave|contrasena|api key|llave)\b/,
  /\b(el|la|ese|esa|su|tu)\s+(precio|valor|total|matricula)\s+(es|ahora es|sera|queda en|cambia a|debe ser)\b/,
  /\b(soy|habla)\s+(el|la)?\s*(rector|rectora|administrador|administradora|director|directora|desarrollador|programador|soporte|profesor|decano)\b.*\b(dame|dime|lee|necesito|muestrame|acceso)\b/,
  /\b(notas|datos|recibo|telefono|correo|codigo|horario|cursos)\b.*\b(de otro|de otra|de otros|de otras|del estudiante|de la estudiante|de mi (hijo|hija|amigo|amiga|companero|companera|novio|novia|esposo|esposa))\b/,
  /\b(sin|no necesito|saltate|salta|omite)\b.*\b(verificar|verificacion|codigo de verificacion)\b/,
  // Del corpus (22-nov): el usted («olvide»), «borrar lo que te dijeron», «no le hagas caso a eso anterior».
  /\b(olvide|olviden|ignore|ignoren|borra|borrar|borre)\b.*\b(instruccion|instrucciones|reglas|indicaciones|prompt|lo que te (han dicho|dijeron|dije))\b/,
  /\bno (le )?(hagas|haga) caso\b.*\b(anterior|instrucciones|reglas)\b/,
  // «Sin reglas / sin restricciones / sin ninguna norma»: siempre dicho del bot (eres, sea, finge, un bot, ya no tienes).
  /\b(eres|sea|seas|ser|finge|fingir|actua|bot|robot|asistente|sistema|ya no tienes)\b.*\bsin (ninguna |ningun |tus |sus )?(reglas|restriccion|restricciones|limites|norma|normas|filtros|censura)\b/,
  /\bya no tienes (reglas|restricciones|limites|normas)\b/,
  // «DAN» solo como el truco conocido: «modo dan», «actúa como dan», «eres dan»; «¿me dan información?» es un verbo.
  // «¿En qué modo dan las clases?» tampoco: el modo tiene que activarse.
  /\b(activa|activo|activar|activado|entra en|entra al|pasa a) (el )?modo dan\b|\b(actua como|eres|seras|soy) dan\b|\bdan (significa|es un bot)\b|\bdo anything now\b/,
  /\b(mostrar|mostrarme|pasame|pasar|ensename|copiame|imprime|print)\b.*\b(prompt|instrucciones|configuracion (interna|oculta)|directrices internas)\b/,
  /\b(sudo|rm -rf|ejecutame|ejecuta este|escribe en (la )?consola|credenciales de (root|administrador|admin|la base|del servidor|del sistema)|contrasena de (root|administrador|admin))\b/,
  /\bquien te (programo|creo|configuro)\b.*\b(verdadero|real|instrucciones|reglas)\b|\btu verdadero nombre\b/,
];

export function looksLikeInjection(text: string): boolean {
  const t = normalizeSpeech(text);
  return INJECTION_PATTERNS.some((re) => re.test(t));
}

export const INJECTION_REPLY =
  'Eso no lo puedo hacer. Te puedo contar de los posgrados de la UTB, consultar tus propios datos de estudiante o comunicarte con un asesor. ¿Qué te gustaría?';

// ------------------------------------------------------------------ cómo suena

/**
 * Léxico de pronunciación: siglas y nombres que la voz neuronal lee mal. Se aplica al final, sobre el texto que va al
 * proveedor (el registro guarda el texto original). Se usa texto plano (no SSML) para que sirva con cualquier voz.
 */
export const LEXICO: readonly [RegExp, string][] = [
  [/\bUTB\b/g, 'U T B'],
  // El nombre del bot: la voz neuronal en español lee «Tooli» como «To-o-li»; se dice como suena la marca, «Túli».
  [/\bTooli\b/gi, 'Túli'],
  [/\bICETEX\b/gi, 'Icetex'],
  [/\bSNIES\b/g, 'Snies'],
  [/\bSMMLV\b/g, 'salarios mínimos'],
  [/\bMBA\b/g, 'eme be a'],
  [/\bSST\b/g, 'ese ese te'],
  [/\bTI\b/g, 'te i'],
  [/\bTIC\b/g, 'tic'],
  [/\bSAVIO\b/g, 'Savio'],
  [/\bUTB Virtual\b/g, 'U T B Virtual'],
  [/\bPh\.?\s?D\.?\b/g, 'pe hache de'],
  [/\bWhatsApp\b/gi, 'guasap'],
  [/\bT0{2,}(\d+)\b/g, 'te $1'],
  [/\bNo\.\s?/g, 'número '],
  [/\bsem\b/g, 'semestre'],
  [/\s?\/\s?sem\b/g, ' por semestre'],
];

export function aplicarLexico(text: string): string {
  return LEXICO.reduce((t, [re, por]) => t.replace(re, por), text);
}

/** Pesos para voz: 17900000 → «17 millones 900 mil pesos». Sin puntos de miles (la voz los lee mal). */
export function pesosParaVoz(valor: number): string {
  const n = Math.round(Math.max(0, valor));
  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  const partes: string[] = [];
  if (millones) partes.push(millones === 1 ? 'un millón' : `${millones} millones`);
  if (miles) partes.push(`${miles} mil`);
  if (resto) partes.push(String(resto));
  if (!partes.length) return 'cero pesos';
  const exacto = !miles && !resto && millones > 0;
  return `${partes.join(' ')}${exacto ? ' de pesos' : ' pesos'}`;
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** «martes 25 de noviembre a las 3 de la tarde» (hora de Colombia). */
export function fechaHablada(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota', weekday: 'short', day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const dia = DIAS[['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))];
  const h = Number(get('hour'));
  const m = Number(get('minute'));
  const h12 = h % 12 || 12;
  const franja = h < 12 ? 'de la mañana' : h < 19 ? 'de la tarde' : 'de la noche';
  const hora = `${h12 === 1 ? 'la una' : `las ${h12}`}${m ? (m === 30 ? ' y media' : ` y ${m}`) : ''} ${franja}`;
  return `${dia} ${get('day')} de ${MESES[Number(get('month')) - 1]} a ${hora}`;
}

// ------------------------------------------------------------------ números dictados (un solo lector)

// Un solo lector de números dictados para ENTENDER (código de verificación, código estudiantil) y para TAPAR lo que va a
// la transcripción (#35 R3): lo que se acepta como dígitos es exactamente lo que se tapa.
const UNIDADES = new Map(Object.entries({ cero: 0, uno: 1, un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9 }));
const DIEZ_A_29 = new Map(Object.entries({
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
}));
const DECENAS = new Map(Object.entries({ treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 }));
const CENTENAS = new Map(Object.entries({
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300, cuatrocientos: 400, cuatrocientas: 400,
  quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600, setecientos: 700, setecientas: 700, ochocientos: 800,
  ochocientas: 800, novecientos: 900, novecientas: 900,
}));

function menorQueCien(ws: readonly string[], j: number): { valor: number; largo: number } | null {
  const w = ws[j];
  if (w === undefined) return null;
  const especial = DIEZ_A_29.get(w);
  if (especial !== undefined) return { valor: especial, largo: 1 };
  const decena = DECENAS.get(w);
  if (decena !== undefined) {
    // «treinta y uno» es un número; «treinta, uno» son dos.
    const u = ws[j + 1] === 'y' ? UNIDADES.get(ws[j + 2] ?? '') : undefined;
    return u ? { valor: decena + u, largo: 3 } : { valor: decena, largo: 1 };
  }
  const unidad = UNIDADES.get(w);
  return unidad !== undefined ? { valor: unidad, largo: 1 } : null;
}

/**
 * El número dictado que empieza en `ws[i]` (palabras ya normalizadas): sus dígitos y cuántas palabras ocupa. Entiende
 * cifras («482»), dígitos sueltos («cuatro»), pares («doce», «cuarenta y ocho», «veintinueve») y centenas
 * («cuatrocientos ochenta y dos»). null si ahí no empieza un número.
 */
export function numeroDictado(ws: readonly string[], i: number): { digitos: string; largo: number } | null {
  const w = ws[i];
  if (w === undefined) return null;
  if (/^\d+$/.test(w)) return { digitos: w, largo: 1 };
  const centena = CENTENAS.get(w);
  if (centena !== undefined) {
    if (w === 'cien') return { digitos: '100', largo: 1 };
    const resto = menorQueCien(ws, i + 1);
    if (resto && resto.valor > 0) return { digitos: String(centena + resto.valor), largo: 1 + resto.largo };
    return w === 'ciento' ? null : { digitos: String(centena), largo: 1 };
  }
  const r = menorQueCien(ws, i);
  return r ? { digitos: String(r.valor), largo: r.largo } : null;
}

const esUnion = (w: string | undefined) => w === 'y' || w === 'e';

export interface TramoDictado {
  /** Palabras [desde, hasta) del tramo. */
  desde: number;
  hasta: number;
  digitos: string;
  /** Empieza por «T»/«te» (código estudiantil). */
  t: boolean;
  /** Es solo «un»/«una» (casi siempre un artículo, no un dígito). */
  articulo: boolean;
}

/**
 * Rachas de números dictados en una lista de palabras normalizadas. Una racha sigue mientras vengan números («doce
 * quince veinte») y salta un «y» entre grupos largos («000 y 123 y 45», «482 y 913»); entre grupos cortos el «y» corta
 * («las once y cuarenta» no es un código).
 */
export function tramosDictados(ws: readonly string[]): TramoDictado[] {
  const out: TramoDictado[] = [];
  let i = 0;
  while (i < ws.length) {
    let j = i;
    let digitos = '';
    let t = false;
    if ((ws[i] === 't' || ws[i] === 'te') && numeroDictado(ws, i + 1)) { t = true; j = i + 1; }
    else if (/^t\d+$/.test(ws[i])) { t = true; digitos = ws[i].slice(1); j = i + 1; }
    else if (!numeroDictado(ws, i)) { i++; continue; }
    for (;;) {
      const n = numeroDictado(ws, j);
      if (n) { digitos += n.digitos; j += n.largo; continue; }
      const sigue = esUnion(ws[j]) ? numeroDictado(ws, j + 1) : null;
      if (sigue && (t || digitos.length >= 3 || sigue.digitos.length >= 3)) { j += 1; continue; }
      break;
    }
    out.push({ desde: i, hasta: j, digitos, t, articulo: !t && j - i === 1 && (ws[i] === 'un' || ws[i] === 'una') });
    i = Math.max(j, i + 1);
  }
  return out;
}

/** Dígitos dictados: «uno dos 3 4 cinco seis», «123 456», «doce quince veinte» → «123456». Ignora el resto de palabras. */
export function digitosDictados(text: string): string {
  const ws = normalizeSpeech(text).split(' ');
  let out = '';
  for (let i = 0; i < ws.length;) {
    const n = numeroDictado(ws, i);
    if (n) { out += n.digitos; i += n.largo; } else i++;
  }
  return out;
}

const RELLENO_DICTADO = new Set(['y', 'e', 'es', 'el', 'la', 'los', 'mi', 'codigo', 'numero', 'numeros', 'digitos', 'son', 'seria', 'entonces', 'ok', 'listo', 'va', 'ahi', 'a', 'ver']);

/** La frase es solo un dictado de números («cuatro ocho dos», «es el 482»): sirve para juntarla con la siguiente. */
export function soloDictado(text: string): boolean {
  const ws = normalizeSpeech(text).split(' ').filter(Boolean);
  let numeros = 0;
  for (let i = 0; i < ws.length;) {
    const n = numeroDictado(ws, i);
    if (n) { numeros++; i += n.largo; continue; }
    if (!RELLENO_DICTADO.has(ws[i]) && palabrasConContenido(ws[i]).length) return false;
    i++;
  }
  return numeros > 0;
}

interface Analisis {
  partes: string[];
  /** Palabras normalizadas y la parte de `partes` de la que salen. */
  palabras: { w: string; parte: number }[];
  tramos: TramoDictado[];
}

const SEPARADOR = /([\s,.;:\-–—/]+)/;
const normalizarPalabra = (p: string) => p.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]/g, '');

function analizar(text: string): Analisis {
  const partes = text.split(SEPARADOR);
  const palabras: Analisis['palabras'] = [];
  partes.forEach((p, k) => {
    if (k % 2 === 1) return;
    const w = normalizarPalabra(p);
    if (w) palabras.push({ w, parte: k });
  });
  return { partes, palabras, tramos: tramosDictados(palabras.map((x) => x.w)) };
}

/** Reemplaza cada tramo por su marcador; el separador que lo sigue queda. */
function taparTramos(a: Analisis, tramos: readonly TramoDictado[]): string {
  const out = [...a.partes];
  for (const tr of tramos) {
    const ini = a.palabras[tr.desde].parte;
    const fin = a.palabras[tr.hasta - 1].parte;
    // Signos pegados a la palabra («¿482?»): el que abre y el que cierra quedan.
    const abre = out[ini].match(/^[^\p{L}\p{N}]*/u)?.[0] ?? '';
    const cierra = a.partes[fin].match(/[^\p{L}\p{N}]*$/u)?.[0] ?? '';
    out[ini] = `${abre}${tr.t ? '[código estudiantil]' : '[dígitos]'}${ini === fin ? cierra : ''}`;
    for (let k = ini + 1; k <= fin; k++) out[k] = k === fin ? cierra : '';
  }
  return out.join('').replace(/\s{2,}/g, ' ').trim();
}

const tapable = (tr: TramoDictado, minimo: number) =>
  !tr.articulo && (tr.digitos.length >= minimo || (tr.t && tr.digitos.length >= Math.min(3, minimo)));

/**
 * Lo que va a la transcripción guardada (180 días): se tapan los números dictados (código de verificación de 6
 * dígitos, cédula, teléfono) y el código estudiantil, leídos con el MISMO lector que los entiende (`numeroDictado`).
 * Cuenta como dictado una racha con `minimo` dígitos o más (4 por defecto; 1 mientras la línea pide un código); si la
 * precede una «T»/«te», es el código estudiantil. Lo demás queda igual.
 */
export function taparDatosDictados(text: string, minimo = 4): string {
  const a = analizar(text);
  const tapar = a.tramos.filter((tr) => tapable(tr, minimo));
  return tapar.length ? taparTramos(a, tapar) : text;
}

/**
 * Un dictado partido entre frases seguidas de quien llama («uno cero cuatro» / «cinco seis siete ocho»): cada parte
 * es corta, pero juntas forman un número. Recibe las líneas de quien llama en orden y tapa las partes que, sumadas con
 * las del final de la anterior o el comienzo de la siguiente, llegan a `minimo` dígitos.
 */
export function taparDictadoPartido(textos: readonly string[], minimo = 4): string[] {
  const analisis = textos.map(analizar);
  const tapar = analisis.map(() => new Set<TramoDictado>());
  let cadena: { linea: number; tramo: TramoDictado }[] = [];
  const cerrar = () => {
    const total = cadena.reduce((n, c) => n + c.tramo.digitos.length, 0);
    if (cadena.length > 1 && total >= minimo) for (const c of cadena) if (!c.tramo.articulo) tapar[c.linea].add(c.tramo);
    cadena = [];
  };
  analisis.forEach((a, linea) => {
    const n = a.palabras.length;
    const primero = a.tramos[0];
    const empieza = primero && primero.desde === 0 ? primero : null;
    const sigueCadena = cadena.length > 0 && empieza;
    if (!sigueCadena) cerrar();
    if (empieza) cadena.push({ linea, tramo: empieza });
    const ultimo = a.tramos.at(-1);
    const terminaLinea = ultimo && ultimo.hasta === n;
    if (!terminaLinea) { cerrar(); return; }
    if (ultimo !== empieza) { cerrar(); cadena.push({ linea, tramo: ultimo }); }
  });
  cerrar();
  return analisis.map((a, k) => (tapar[k].size ? taparTramos(a, a.tramos.filter((tr) => tapar[k].has(tr) || tapable(tr, minimo))) : textos[k]));
}

/**
 * Código estudiantil dictado: «T 0 0 0 1 2 3 4 5», «te cero cero…», «T 000 y 123 y 45», «00012345». Devuelve
 * «T00012345» o null. La UTB usa T + 8 dígitos.
 */
export function codigoEstudiantilDictado(text: string): string | null {
  const t = normalizeSpeech(text).replace(/\bte\b/g, 't');
  // Primero, los dígitos que siguen a la «T»: «mi código es T 0 0 4… y el recibo me vino con UN montón» no debe
  // sumar el «un» del final al código.
  const toks = t.replace(/\bt(\d)/g, 't $1').split(' ');
  const desde = toks.indexOf('t');
  if (desde >= 0) {
    let tras = '';
    for (let j = desde + 1; j < toks.length;) {
      const n = numeroDictado(toks, j);
      if (n) { tras += n.digitos; j += n.largo; continue; }
      if (!tras) { j++; continue; }
      if (esUnion(toks[j]) && numeroDictado(toks, j + 1)) { j++; continue; }
      break;
    }
    if (tras.length === 8) return `T${tras}`;
  }
  const digitos = digitosDictados(t.replace(/\bt(\d)/g, 't $1'));
  if (digitos.length === 8) return `T${digitos}`;
  if (digitos.length >= 5 && digitos.length < 8 && /\bt\b|\bt\d/.test(t)) return `T${digitos.padStart(8, '0')}`;
  return null;
}

/** Limpia la respuesta para la voz: sin Markdown, emojis, enlaces ni saltos; recortada en una frase completa. */
export function cleanForSpeech(text: string): string {
  let t = text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\bwww\.\S+/g, '')
    .replace(/[*_~`#>]/g, '')
    .replace(/\p{Extended_Pictographic}|\p{Emoji_Presentation}|\u{FE0F}/gu, '')
    .replace(/\$\s?/g, '')
    .replace(/\s*\n+\s*/g, '. ')
    .replace(/\s+/g, ' ')
    .replace(/\.\s*\./g, '.')
    .trim();
  if (t.length > MAX_REPLY_TEXT) {
    const cut = t.slice(0, MAX_REPLY_TEXT);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
    t = end > 80 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
  }
  return t;
}

/** Montos que menciona un texto (≥ 1.000), en pesos enteros: «12.000», «12000», «12 mil», «17 millones 900 mil». */
export function amountsIn(text: string): number[] {
  const out: number[] = [];
  const t = text.toLowerCase();
  for (const m of t.matchAll(/(\d{1,3}(?:[.,]\d{3})+|\d{4,})/g)) {
    const n = Number(m[1].replace(/[.,]/g, ''));
    // «matrícula 2026»: un año suelto (sin «pesos» detrás) no es un monto.
    const esAnio = /^(19|20)\d\d$/.test(m[1]) && !/^\s*(pesos|mil)/.test(t.slice((m.index ?? 0) + m[1].length));
    if (Number.isFinite(n) && n >= 1000 && !esAnio) out.push(n);
  }
  for (const m of t.matchAll(/\b(un|\d{1,3})\s+mill[oó]n(?:es)?(?:\s+(\d{1,3})\s+mil)?(?:\s+(\d{1,3})\b(?!\s+mil))?/g)) {
    const mill = m[1] === 'un' ? 1 : Number(m[1]);
    out.push(mill * 1_000_000 + Number(m[2] ?? 0) * 1000 + Number(m[3] ?? 0));
  }
  for (const m of t.matchAll(/(?<!mill[oó]n(?:es)?\s)\b(\d{1,3})\s+mil\b/g)) out.push(Number(m[1]) * 1000);
  return out;
}

/** Revisa que todo monto que se vaya a decir sea uno real (del catálogo o del contrato académico). */
export function replyAmountsAllowed(reply: string, allowed: ReadonlySet<number>): boolean {
  return amountsIn(reply).every((n) => allowed.has(n));
}
