# ===============================================
# Conversión de la capa oficial de provincias (CONALI)
# ORGANIZACION_TERRITORIAL_PROVINCIAL.shp (UTM 17S) → GeoJSON WGS84 liviano
# Genera provincias_simplificado.geojson y provincias.js
#
# Uso (desde la carpeta Geovisor_Activate):
#   python scripts/convertir_provincias.py
#   python scripts/convertir_provincias.py "ruta/a/ORGANIZACION_TERRITORIAL_PROVINCIAL.shp" 100
# Requiere: pip install pyshp pyproj shapely
# ===============================================

import json
import os
import sys
from pathlib import Path

import shapefile
import shapely
from pyproj import Transformer
from shapely.geometry import mapping, shape
from shapely.ops import transform

APP_DIR = Path(__file__).resolve().parent.parent
DEFAULT_SHP = (APP_DIR.parents[4] / '1. PROCESO DE MICROPLANIFICACIÓN' / '1.4_DPA_DA' / 'MG26'
               / 'ORGANIZACIÓN TERRITORIAL DEL ESTADO 20_08_2026' / 'ORGANIZACIÓN TERRITORIAL DEL ESTADO 17.07.2026'
               / 'ORGANIZACION_TERRITORIAL_PROVINCIAL.shp')
TOLERANCE_M = 100   # simplificación en metros: suficiente para escala provincial
DECIMALS = 5        # ~1 m de precisión en grados


def long_path(path):
    """Las rutas de OneDrive superan los 260 caracteres de Windows."""
    p = os.path.abspath(path)
    return '\\\\?\\' + p if os.name == 'nt' and not p.startswith('\\\\?\\') else p


def round_coords(geom):
    return shapely.set_precision(geom, 10 ** -DECIMALS)


def main():
    shp = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SHP
    tolerance = float(sys.argv[2]) if len(sys.argv) > 2 else TOLERANCE_M
    base = long_path(shp.with_suffix(''))
    reader = shapefile.Reader(shp=open(base + '.shp', 'rb'), shx=open(base + '.shx', 'rb'),
                              dbf=open(base + '.dbf', 'rb'), encoding='utf-8')
    fields = [f[0] for f in reader.fields[1:]]

    records = [dict(zip(fields, rec)) for rec in reader.records()]
    geoms = [shape(s.__geo_interface__).buffer(0) for s in reader.shapes()]

    # Simplificación de cobertura: las provincias vecinas conservan el mismo borde
    simplified = shapely.coverage_simplify(geoms, tolerance)

    to_wgs84 = Transformer.from_crs('EPSG:32717', 'EPSG:4326', always_xy=True).transform
    features = []
    for rec, geom in zip(records, simplified):
        geom = round_coords(transform(to_wgs84, geom))
        if geom.is_empty:
            continue
        if geom.geom_type == 'Polygon':
            geom = shapely.MultiPolygon([geom])
        features.append({
            'type': 'Feature',
            'properties': {'DPA_PROVIN': rec['DPA_PROVIN'], 'DPA_DESPRO': rec['DPA_DESPRO']},
            'geometry': mapping(geom),
        })

    geo = {'type': 'FeatureCollection', 'features': features}
    text = json.dumps(geo, ensure_ascii=False, separators=(',', ':'))
    (APP_DIR / 'provincias_simplificado.geojson').write_text(text, encoding='utf-8')
    (APP_DIR / 'provincias.js').write_text(f'window.PROVINCIAS_GEOJSON = {text};\n', encoding='utf-8')
    print(f'{len(features)} provincias · tolerancia {tolerance:g} m · {len(text) / 1024:,.0f} KB')


if __name__ == '__main__':
    main()
