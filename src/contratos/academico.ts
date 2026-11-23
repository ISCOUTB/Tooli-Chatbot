/**
 * Contrato de datos académicos. Lo implementa la rama `datos-academicos`
 * (src/services/academico/servicio.ts, exportando `academico: AcademicoApi`)
 * y lo usan WhatsApp y la voz. NO cambiar la firma sin avisar al orquestador.
 *
 * Cambio de la integración (22-nov-2026), compatible hacia atrás:
 * - `buscarParaVerificar` devuelve `telefonoVinculado` ENMASCARADO (****1234).
 *   Sirve para decir «el que termina en…», NUNCA como destino de un mensaje.
 * - Se añaden, opcionales, `iniciarVerificacionPorDato` y `confirmarVerificacion`:
 *   quien llama desde otro número dicta su código estudiantil (o cédula), un
 *   código de 6 dígitos PROPIO DE LA VOZ va al CORREO INSTITUCIONAL vinculado y
 *   quien llama no ve ni oye ningún destino completo.
 * - Segundo ajuste (22-nov, auditoría de seguridad): confirmar YA NO VINCULA el
 *   número que llama. Antes reutilizaba `checkCode` de identityService, que mueve
 *   el vínculo de WhatsApp al número que confirma: verificarse por voz desde un
 *   fijo o un teléfono prestado le quitaba el WhatsApp al estudiante y, con
 *   `confiarEnNumero`, dejaba ese fijo compartido leyendo sus datos en llamadas
 *   futuras. Ahora la verificación vale SOLO PARA LA LLAMADA: el código se guarda
 *   como HMAC atado a (número que llama, vínculo encontrado), vence a los 10 min,
 *   admite 3 intentos y es de un solo uso. Si coincide, devuelve
 *   `{ ok: true, telefonoEstudiante }`: el teléfono del vínculo REAL, que solo vive
 *   en el servidor (estado de la llamada), nunca se dice por voz, y es el único
 *   con el que la voz llama a `consultar(...)` durante esa llamada (jamás con el
 *   número de quien llama). Es compatible para quien consume el contrato (un campo
 *   más en el éxito); quien lo implemente debe devolverlo.
 * - Son opcionales para no romper los fakes existentes; quien las tenga debe
 *   tener las dos. La voz las prefiere y, si faltan, solo manda el código al
 *   WhatsApp cuando `telefonoVinculado` es un número completo (fakes y simulador).
 */
export interface Estudiante {
  telefono: string;
  email: string;            // @utb.edu.co / @utbvirtual.edu.co verificado por código
  codigo?: string;          // T00012345, cuando está atado a la identidad
  nombre?: string;
  programa?: string;
  nivel?: 'pregrado' | 'posgrado';
}

export type TipoConsulta = 'notas' | 'recibo' | 'turno' | 'horario' | 'cursos';

export type ResultadoConsulta =
  | {
      ok: true;
      tipo: TipoConsulta;
      /** Datos estructurados para el panel o WhatsApp. */
      datos: unknown;
      /** Frase corta y natural para leer en voz alta (sin emojis ni markdown, cifras en palabras cuando ayude). */
      paraVoz: string;
      /** Texto para WhatsApp. */
      paraTexto: string;
    }
  | {
      ok: false;
      tipo: TipoConsulta;
      motivo: 'no_verificado' | 'sin_codigo' | 'apagado' | 'sin_sesion' | 'no_encontrado' | 'error';
      /** Qué decirle a la persona para seguir (p. ej. «te mandé un código al WhatsApp»). */
      paraVoz: string;
      paraTexto: string;
    };

export interface AcademicoApi {
  /** Estudiante verificado detrás de ese número, o null. */
  estudianteDe(telefono: string): Promise<Estudiante | null>;
  /** Busca por código o cédula (para quien llama desde otro número). No da datos: solo dice si existe y a qué correo/WhatsApp enviar el código. */
  buscarParaVerificar(dato: { codigo?: string; cedula?: string }): Promise<{ encontrado: boolean; telefonoVinculado?: string; emailEnmascarado?: string }>;
  consultar(telefono: string, tipo: TipoConsulta): Promise<ResultadoConsulta>;
  /**
   * Para quien llama desde OTRO número: busca el vínculo por código o cédula y manda
   * un código de 6 dígitos al correo institucional de ese estudiante. Nunca revela el destino
   * completo. 'sin_destino' = el código existe pero no tiene correo vinculado.
   */
  iniciarVerificacionPorDato?(telefonoLlamante: string, dato: { codigo?: string; cedula?: string }): Promise<ResultadoEnvioVerificacion>;
  /**
   * Comprueba el código dictado. NO toca ningún vínculo: si coincide devuelve el teléfono del vínculo real
   * (`telefonoEstudiante`) para consultar durante ESTA llamada. Ese teléfono no se dice por voz.
   */
  confirmarVerificacion?(telefonoLlamante: string, codigo6: string): Promise<ResultadoConfirmacion>;
}

export type ResultadoEnvioVerificacion =
  | { estado: 'enviado'; emailEnmascarado: string }
  /**
   * 'espera' = marca de 60 s o tope de envíos (por número que llama o por estudiante destino) alcanzado.
   * 'bloqueado' (22-nov, compatible: un estado más) = se agotaron los intentos varias veces; el número que llama o
   * ese estudiante quedan bloqueados un rato (1 h). La voz debería decirlo y ofrecer un asesor.
   */
  | { estado: 'no_encontrado' | 'sin_destino' | 'espera' | 'bloqueado' | 'error' };

export type ResultadoConfirmacion =
  | { ok: true; telefonoEstudiante: string }
  | { ok: false; motivo: 'vencido' | 'demasiados' | 'no_coincide' };
