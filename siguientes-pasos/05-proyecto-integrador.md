# Proyecto integrador: el mismo dato por tres rutas y conciliación

**Objetivo:** demostrar (a ti y a un entrevistador) que entiendes las rutas, no solo que sabes hacer clics. Un mismo origen
alimenta tres plataformas, y al final **los números deben coincidir** o debes saber explicar por qué no.

```
                     ┌─ Ruta 1 (GCP, CDC por log) ─ Datastream ─▶ BigQuery Bronze ─ Dataform ─▶ Silver ─▶ Gold
Cloud SQL (lab) ─────┤
  esquema gastos     ├─ Ruta 2 (eventos) ─ tu publicador (outbox) ─▶ Pub/Sub ─▶ BQ subscription
  + usuarios         │                                    └──────▶ Eventstream ─▶ Eventhouse (KQL) Gold
                     └─ Ruta 3 (batch, Fabric) ─ gateway + pipeline incremental ─▶ Lakehouse ─ notebook ─▶ Gold (Delta)
                                                                                        ▲
                                         GCS (export Parquet) ─ shortcut OneLake ───────┘ (zero-copy)
```

## Entregables
1. **Diagrama** propio, hecho como código (puedes reutilizar el estilo de `docs/diagramas/generar.py`).
2. **Tabla de conciliación** diaria con el mismo KPI (gasto real del mes por usuario, en PEN) calculado en:
   PostgreSQL (verdad) · BigQuery Gold · Eventhouse `fn_kpis_mes()` · Lakehouse Gold.
3. **Escenarios de falla**, cada uno con lo que viste en cada ruta:
   | Escenario | Qué esperas | Qué pasó en realidad |
   |---|---|---|
   | `UPDATE` de un monto | Las 3 rutas lo reflejan | |
   | `DELETE` de un gasto | Ruta 1 ✅, Ruta 2 ✅, Ruta 3 ⚠️ (watermark) | |
   | Cloud SQL apagado 1 h | Ruta 1 se recupera, Ruta 2 encola, Ruta 3 falla y reintenta | |
   | Evento duplicado | Gold no duplica (dedupe por versión) | |
   | Evento atrasado (versión vieja después de una nueva) | Gana la versión mayor | |
   | Cambio de esquema (columna nueva) | ¿Quién se rompe y quién la ignora? | |
4. **Costo real** de una semana por ruta (exportación de facturación de GCP a BigQuery + Capacity Metrics de Fabric).
5. **Recomendación escrita** (1 página): qué ruta elegirías para Mis Gastos con 20 usuarios, con 20.000 usuarios y para un
   banco. Escríbela como si fuera una pregunta de caso del PDE.

## Criterios de "terminado"
- [ ] Las cuatro cifras coinciden al céntimo después de 5 minutos sin cambios (o la diferencia está explicada).
- [ ] Cada escenario de falla está documentado con evidencia (consulta + resultado).
- [ ] Todo se puede recrear con tus scripts o con Terraform desde cero.
- [ ] Limpieza hecha y verificada en la facturación del día siguiente.

## Para el portafolio
Publica tu versión en un repo propio (sin datos reales ni IDs), con el README y la tabla de conciliación. Es la mejor
evidencia práctica que puedes llevar a una entrevista de Data Engineer.
