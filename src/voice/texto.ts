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

const DIGITOS: Record<string, string> = {
  cero: '0', uno: '1', un: '1', una: '1', dos: '2', tres: '3', cuatro: '4', cinco: '5', seis: '6', siete: '7', ocho: '8', nueve: '9',
};

/** Dígitos dictados: «uno dos 3 4 cinco seis», «123 456» → «123456». Ignora el resto de palabras. */
export function digitosDictados(text: string): string {
  return normalizeSpeech(text)
    .split(' ')
    .map((w) => (/^\d+$/.test(w) ? w : DIGITOS[w] ?? ''))
    .join('');
}

const PALABRA_DIGITO = /^(cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)$/;

/**
 * Lo que va a la transcripción guardada (180 días): se tapan los números dictados (código de verificación de 6
 * dígitos, cédula, teléfono) y el código estudiantil. Cuenta como dictado una racha de dígitos en cifras o en palabras
 * («cuatro ocho dos…», «4-8-2…», «1.045.678») con 4 o más dígitos; si la precede una «T»/«te», es el código
 * estudiantil. Lo demás queda igual.
 */
export function taparDatosDictados(text: string): string {
  const partes = text.split(/([\s,.;:\-–—/]+)/);
  const digitosDe = (p: string): string | null => {
    const w = p.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
    if (/^\d+$/.test(w)) return w;
    if (PALABRA_DIGITO.test(w)) return '0';
    if (/^t\d+$/.test(w)) return w.slice(1);
    return null;
  };
  const esSep = (i: number) => i % 2 === 1;
  const out = [...partes];
  let i = 0;
  while (i < partes.length) {
    if (esSep(i) || digitosDe(partes[i]) === null) { i++; continue; }
    let j = i;
    let n = 0;
    let fin = i;
    while (j < partes.length) {
      if (esSep(j)) { j++; continue; }
      const d = digitosDe(partes[j]);
      if (d === null) break;
      n += d.length;
      fin = j;
      j++;
    }
    if (n >= 4) {
      // ¿Lo precede una «T» suelta (código estudiantil)?
      let ini = i;
      const previo = i - 2;
      const pegadaT = /^t\d/i.test(partes[i].replace(/[^a-z0-9]/gi, ''));
      if (previo >= 0 && /^(t|te)$/i.test(partes[previo].trim())) ini = previo;
      const codigo = ini !== i || pegadaT;
      out[ini] = codigo ? '[código estudiantil]' : '[dígitos]';
      // Se borra la racha entera (con sus separadores); el separador que la sigue queda.
      for (let k = ini + 1; k <= fin; k++) out[k] = '';
      i = fin + 1;
    } else i = j;
  }
  return out.join('').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Código estudiantil dictado: «T 0 0 0 1 2 3 4 5», «te cero cero…», «00012345». Devuelve «T00012345» o null.
 * La UTB usa T + 8 dígitos.
 */
export function codigoEstudiantilDictado(text: string): string | null {
  const t = normalizeSpeech(text).replace(/\bte\b/g, 't');
  // Primero, los dígitos que siguen a la «T»: «mi código es T 0 0 4… y el recibo me vino con UN montón» no debe
  // sumar el «un» del final al código.
  const toks = t.replace(/\bt(\d)/g, 't $1').split(' ');
  const desde = toks.indexOf('t');
  if (desde >= 0) {
    let tras = '';
    for (const w of toks.slice(desde + 1)) {
      const d = /^\d+$/.test(w) ? w : DIGITOS[w];
      if (d === undefined) { if (tras) break; continue; }
      tras += d;
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
