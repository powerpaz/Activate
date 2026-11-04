# Geovisor de Puntos del Servicio ACTÍVATE

Mapa interactivo de los puntos del servicio ACTÍVATE. Usa el mismo diseño y la misma lógica que el geovisor AMIE (`Clonar_ejemplo/AMIE-main`).

## Abrir el geovisor
Haga doble clic en `index.html`. No necesita servidor, porque los datos van en `data.js` y `provincias.js`. Sí necesita internet para cargar el mapa base y Leaflet.

## Actualizar los datos
1. Reemplace `../Matriz_Horarios_y_Puntos_Activate.xlsx` por la nueva matriz. Se lee la hoja **HORARIO DE PUNTOS ACTIVATE**.
2. Desde esta carpeta, ejecute:
   ```bash
   python scripts/generar_datos.py
   # o con otra ruta:
   python scripts/generar_datos.py "C:/ruta/matriz.xlsx"
   ```
   Requiere `pip install openpyxl`.
3. El script regenera estos archivos:
   - `data.js`: los datos que usa el mapa.
   - `data.csv`: la misma base depurada, para abrir en Excel.
   - `puntos_a_revisar.csv`: los puntos que **no** se muestran, con el motivo, para pedir su corrección.

## Cómo se depuran las coordenadas
La columna COORDENADAS llega en formatos mixtos. El script interpreta estos casos:
- Decimales con punto o con coma.
- Grados, minutos y segundos (por ejemplo `0°42'05.0"S 77°18'41.8"`).
- `Lat … Long …`.
- Plus Codes completos y cortos.
- Valores a los que les falta el `-0.` (por ejemplo `-934813` se lee como `-0.934813`).
- Signos invertidos.

Cada punto se valida contra el polígono de la provincia declarada, con una tolerancia de unos 5 km por el contorno simplificado. Si no cae en su provincia, no se muestra en el mapa y pasa a `puntos_a_revisar.csv`.

## Archivos
| Archivo | Contenido |
|---|---|
| `index.html`, `styles.css`, `app.js`, `config.js` | El aplicativo. Los colores por actividad y los días están en `config.js`. |
| `logo.png` | Copiado del geovisor AMIE. |
| `provincias.js`, `provincias_simplificado.geojson` | Límites provinciales oficiales CONALI 2026 (`ORGANIZACION_TERRITORIAL_PROVINCIAL.shp`), simplificados a 100 m. **`provincias.js` es el que usa el mapa; si falta, no se dibujan las provincias.** |
| `scripts/convertir_provincias.py` | Convierte el shapefile oficial (UTM 17S) a `provincias.js` y `provincias_simplificado.geojson`. Requiere `pip install pyshp pyproj shapely`. |
| `scripts/generar_datos.py` | Lee la matriz y genera los datos. |
