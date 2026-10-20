/* Sesión del asesor que tiene el panel abierto.
   Vive en un objeto (y no en tres `let` sueltos) porque los módulos importan un
   binding de solo lectura: si `init()` reasignara la variable, el resto de
   pantallas seguiría viendo el valor viejo. Mutando el objeto, todos leen lo
   mismo sin necesidad de propagar nada. */
export const sesion = {
  user: null,
  urls: { chatwoot: '#', grafana: '#' },
  caps: { chatwootSso: false, metaWindow: false },
};
