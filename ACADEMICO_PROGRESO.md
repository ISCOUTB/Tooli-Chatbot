# Registro vivo: datos académicos (rama datos-academicos)

Estado: construcción terminada, falta validar con cuentas reales (ver docs/datos-academicos.md).

- [x] Contrato `academico: AcademicoApi` en `src/services/academico/servicio.ts` (núcleo puro en `nucleo.ts`).
- [x] Interruptores (todo apagado), proveedores por puertos, textos paraVoz/paraTexto.
- [x] Identidad fuerte: código atado al vínculo, comprobado contra Iceberg, compatible hacia atrás (probado en Redis real).
- [x] Notas: camino B por defecto, camino A cifrado y opcional, promedio y «cuánto necesitas».
- [x] Turno, recibo (valor, fecha, PDF), Savio (cursos y tareas), horario (simulado + Banner con HTML sintético).
- [x] WhatsApp: «Mi semestre», vincular código, avisos proactivos (apagados).
- [x] Pruebas con fakes; 38 mutaciones manuales, todas muertas (la que sobrevivía, recibo sin código comprobado, ya tiene prueba).
- [x] Documentación.
- [ ] Pendiente fuera del código: cuentas reales, regla de notas de la UTB, selectores de horario y notas por corte, plantillas de Meta para avisos.
