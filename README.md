# Presupuesto de gastos de operación 2027 · Global Tech

Página para que cada área capture su presupuesto mensual 2027 con base en el formato
`Formato_2027_Presupuesto_de_gastos.xlsx` (509 partidas).

## Cómo está armado
- **Página estática** (`index.html`, `app.js`, `config.js`, `vendor/`) publicada en Netlify.
- **Supabase** guarda la captura y controla el acceso:
  - `lineas`: catálogo del formato (rubro, concepto, cuenta, CECO, área que llena).
  - `montos`: 12 meses + nota por partida y ejercicio.
  - `capturas`: estado (captura / enviado) por área y departamento.
  - `accesos`: quién puede hacer qué.
- **Función `cuentas`** (Edge Function): activa cuentas con un código que genera un administrador.

## Accesos
| Rol | Qué puede hacer |
|---|---|
| admin | Ve y edita todo, reabre capturas, da accesos |
| captura | Edita las partidas de su área ("Llenado por"); si se le asigna un CECO, solo ese departamento |
| consulta | Ve sin editar todas las partidas de un departamento (CECO) |

Las reglas se validan en la base de datos (Row Level Security), no solo en la página.

## Alta de un usuario
1. Administrador → **Accesos** → agrega correo, rol, área y departamento.
2. **Generar código** y entregárselo al usuario.
3. El usuario entra a la página → **Activar cuenta** → correo + código + su contraseña.

El mismo código sirve para restablecer una contraseña olvidada.

## Captura desde Excel
- **Descargar plantilla**: Excel con las partidas de la vista (columna ID, 12 meses, total con fórmula y nota).
- **Cargar Excel**: acepta esa plantilla o el formato oficial 2027 lleno (se usa el número de fila del formato).
  Muestra una vista previa (cambios, total antes/después, lo que se ignora) antes de guardar.

## Líneas nuevas
Usuarios con rol captura (en su área/departamento, mientras no esté enviada) y administradores pueden
**Agregar línea** (rubro, concepto, cuenta opcional, CECO). Reciben ID desde 100000 y se pueden quitar
mientras la captura siga abierta. Las líneas del formato original no se pueden quitar.

## Real y comparativo
- **Real** (solo administradores): misma tabla de captura con el gasto real mensual por partida; se puede
  capturar, pegar o cargar con su plantilla de Excel. El **mes de cierre** define hasta qué mes las áreas
  ven el comparativo.
- **Comparativo** (todos, sobre las partidas que cada quien ve): presupuesto vs real al mes de corte,
  acumulado o solo el mes; variación (real − presupuesto) en $ y %, % ejercido del anual, gráfica mensual,
  detalle por rubro y partida, resúmenes por área y departamento, y exportación a Excel.

## Base de datos
Migraciones en `supabase/migrations/`, función en `supabase/functions/cuentas/`.
