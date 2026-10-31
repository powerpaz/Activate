# ===============================================
# Generador de datos - Geovisor ACTÍVATE
# Lee la matriz de horarios y puntos, depura coordenadas
# y genera data.csv, data.js, provincias.js y el reporte
# de puntos sin coordenadas válidas.
#
# Uso (desde la carpeta Geovisor_Activate):
#   python scripts/generar_datos.py
#   python scripts/generar_datos.py "ruta/a/otra_matriz.xlsx"
# ===============================================

import csv
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

import openpyxl

APP_DIR = Path(__file__).resolve().parent.parent
DEFAULT_XLSX = APP_DIR.parent / 'Matriz_Horarios_y_Puntos_Activate.xlsx'
SHEET = 'HORARIO DE PUNTOS ACTIVATE'
GEOJSON = APP_DIR / 'provincias_simplificado.geojson'

DIAS = ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO']
ECUADOR_BBOX = (-5.1, 1.7, -92.1, -75.1)  # lat_min, lat_max, lon_min, lon_max
OLC_ALPHABET = '23456789CFGHJMPQRVWX'
BORDER_TOLERANCE = 0.045  # ~5 km: el contorno simplificado recorta costas y límites


def norm(value):
    """Texto sin tildes, mayúsculas y espacios simples (para comparar)."""
    txt = unicodedata.normalize('NFD', str(value or ''))
    txt = ''.join(c for c in txt if unicodedata.category(c) != 'Mn')
    return re.sub(r'\s+', ' ', txt).strip().upper()


def clean(value):
    if value is None:
        return ''
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return re.sub(r'\s+', ' ', str(value)).strip()


# ---------- Geometría ----------

def load_provinces():
    geo = json.loads(GEOJSON.read_text(encoding='utf-8'))
    provinces = {}
    for feature in geo['features']:
        name = feature['properties']['DPA_DESPRO']
        geom = feature['geometry']
        polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
        provinces[norm(name)] = (name, polys)
    return geo, provinces


def point_in_ring(lon, lat, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def point_in_polys(lon, lat, polys):
    for poly in polys:
        if point_in_ring(lon, lat, poly[0]) and not any(point_in_ring(lon, lat, h) for h in poly[1:]):
            return True
    return False


def polys_bbox(polys):
    pts = [p for poly in polys for p in poly[0]]
    lons, lats = [p[0] for p in pts], [p[1] for p in pts]
    return min(lats), max(lats), min(lons), max(lons)


def min_distance_to_border(lon, lat, polys):
    """Distancia mínima (en grados) del punto al contorno de la provincia."""
    best = float('inf')
    for poly in polys:
        ring = poly[0]
        for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
            dx, dy = x2 - x1, y2 - y1
            t = 0 if dx == dy == 0 else max(0, min(1, ((lon - x1) * dx + (lat - y1) * dy) / (dx * dx + dy * dy)))
            best = min(best, ((lon - x1 - t * dx) ** 2 + (lat - y1 - t * dy) ** 2) ** 0.5)
    return best


def in_ecuador_bbox(lat, lon):
    return ECUADOR_BBOX[0] <= lat <= ECUADOR_BBOX[1] and ECUADOR_BBOX[2] <= lon <= ECUADOR_BBOX[3]


# ---------- Lectura de coordenadas ----------

def decode_plus_code(code):
    """Decodifica un Plus Code completo (p. ej. 67G4J536+89X). Devuelve (lat, lon) o None."""
    code = code.upper().replace('+', '')
    if len(code) < 8 or any(c not in OLC_ALPHABET for c in code):
        return None
    lat, lon = -90.0, -180.0
    res = 20.0
    pairs = code[:10]
    for i in range(0, len(pairs), 2):
        lat += OLC_ALPHABET.index(pairs[i]) * res
        if i + 1 < len(pairs):
            lon += OLC_ALPHABET.index(pairs[i + 1]) * res
        res /= 20.0
    lat_res = lon_res = res * 20.0
    for c in code[10:]:
        idx = OLC_ALPHABET.index(c)
        lat_res /= 5.0
        lon_res /= 4.0
        lat += (idx // 4) * lat_res
        lon += (idx % 4) * lon_res
    return lat + lat_res / 2, lon + lon_res / 2


DMS_RE = re.compile(
    r'(-?)(\d{1,3})\s*°\s*(\d{1,2})\s*\'\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*"?)?\s*([NSEWO])?',
    re.IGNORECASE)
NUM_RE = re.compile(r'-?\d+(?:[.,]\d+)?')


def number_variants(token):
    """Interpretaciones posibles de un número escrito en la matriz."""
    value = float(token.replace(',', '.'))
    out = [value]
    digits = token.lstrip('-')
    # '-934813' → -0.934813 (se perdió el '0.' al digitar)
    if token.startswith('-') and digits.isdigit() and len(digits) >= 5:
        out.append(-float('0.' + digits))
    return out


def plus_code_prefixes(bbox):
    """Prefijos de 4 caracteres (celdas de 1°) que cubren el bbox de una provincia."""
    lat_min, lat_max, lon_min, lon_max = bbox
    for lat in range(int(lat_min + 90), int(lat_max + 90) + 1):
        for lon in range(int(lon_min + 180), int(lon_max + 180) + 1):
            yield (OLC_ALPHABET[lat // 20] + OLC_ALPHABET[lon // 20]
                   + OLC_ALPHABET[lat % 20] + OLC_ALPHABET[lon % 20])


def candidates_from_text(text, bbox=None):
    """Genera pares (lat, lon) candidatos a partir de un texto libre."""
    if not text:
        return
    txt = (str(text).replace('−', '-').replace('′', "'").replace('″', '"')
           .replace('’', "'").replace('”', '"'))

    # 1) Plus Codes completos, y cortos (H5W8+MG) completados con la provincia
    for code in re.findall(r'[23456789CFGHJMPQRVWX]{8}\+[23456789CFGHJMPQRVWX]{2,3}', txt.upper()):
        decoded = decode_plus_code(code)
        if decoded:
            yield decoded
    if bbox:
        for short in re.findall(r'(?<![23456789CFGHJMPQRVWX])([23456789CFGHJMPQRVWX]{4}\+[23456789CFGHJMPQRVWX]{2,3})',
                                txt.upper()):
            for prefix in plus_code_prefixes(bbox):
                decoded = decode_plus_code(prefix + short)
                if decoded:
                    yield decoded

    # 2) Grados, minutos, segundos
    dms = []
    for sign, d, m, s, hemi in DMS_RE.findall(txt):
        val = int(d) + int(m) / 60 + float((s or '0').replace(',', '.')) / 3600
        hemi = hemi.upper()
        negative = sign == '-' or hemi in ('S', 'W', 'O')
        dms.append((val, negative, hemi))
    if len(dms) >= 2:
        (la, la_neg, la_h), (lo, _, _) = dms[0], dms[1]
        lat_options = [-la if la_neg else la] if la_h else [-la, la]
        for lat in lat_options:
            yield lat, -lo

    # 3) Números decimales sueltos: se prueban todos los pares en ambos órdenes
    tokens = NUM_RE.findall(re.sub(DMS_RE, ' ', txt) if len(dms) >= 2 else txt)
    values = [number_variants(t) for t in tokens]
    for i in range(len(values)):
        for j in range(i + 1, len(values)):
            for a in values[i]:
                for b in values[j]:
                    for lat, lon in ((a, b), (b, a)):
                        if abs(lat) <= 6 and 75 <= abs(lon) <= 93:
                            yield lat, -abs(lon)
                            yield -lat, -abs(lon)


def candidates_from_url(url):
    if not url:
        return
    url = str(url)
    for pat in (r'!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)', r'@(-?\d+\.\d+),(-?\d+\.\d+)',
                r'[?&](?:q|query|ll)=(-?\d+\.\d+),\s*(-?\d+\.\d+)', r'\((-?\d+\.\d+),\s*(-?\d+\.\d+)\)'):
        for lat, lon in re.findall(pat, url):
            yield float(lat), float(lon)


def resolve_coordinates(row, provinces, province_key):
    """Devuelve (lat, lon, fuente, observación) o (None, None, '', motivo)."""
    polys = provinces[province_key][1]
    bbox = polys_bbox(polys)
    # COORDENADAS primero: Latitud/Longitud salen de partirla por la coma y
    # rompen los decimales escritos con coma ('-1,0432050, -78,5884878').
    sources = [
        ('Columna COORDENADAS', candidates_from_text(row['COORDENADAS'], bbox)),
        ('Columnas Latitud/Longitud', candidates_from_text(f"{clean(row['Latitud'])} , {clean(row['Longitud'])}")
         if clean(row['Latitud']) and clean(row['Longitud']) and '#' not in clean(row['Latitud']) else iter(())),
        ('Link de ubicación', candidates_from_url(row['LINK DE UBICACIÓN (EXACTO)'])),
    ]
    near_border = other_province = None
    for source, gen in sources:
        for lat, lon in gen:
            if not in_ecuador_bbox(lat, lon):
                continue
            if point_in_polys(lon, lat, polys):
                return round(lat, 7), round(lon, 7), source, ''
            point = (round(lat, 7), round(lon, 7), source)
            if near_border is None and min_distance_to_border(lon, lat, polys) <= BORDER_TOLERANCE:
                near_border = point
            if other_province is None and any(point_in_polys(lon, lat, p) for _, p in provinces.values()):
                other_province = point
    if near_border:
        return (*near_border, '')
    if other_province:
        lat, lon, _ = other_province
        return None, None, '', f'Coordenada ({lat}, {lon}) cae fuera de la provincia declarada'
    return None, None, '', 'Sin coordenada válida dentro de Ecuador'


# ---------- Proceso principal ----------

def canonical_forms(rows, field):
    """Unifica variantes con/sin tilde usando la forma más frecuente."""
    groups = defaultdict(Counter)
    for r in rows:
        if r[field]:
            groups[norm(r[field])][r[field]] += 1
    return {k: c.most_common(1)[0][0] for k, c in groups.items()}


def format_date(value):
    if isinstance(value, datetime):
        return value.strftime('%d/%m/%Y')
    return ''


def main():
    xlsx = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_XLSX
    geo, provinces = load_provinces()
    province_alias = {'SANTO DOMINGO': 'SANTO DOMINGO DE LOS TSACHILAS'}

    wb = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)
    ws = next(s for s in wb.worksheets if s.title.strip() == SHEET)
    rows = list(ws.iter_rows(values_only=True))
    headers = [clean(h).upper() if h else f'_COL{i}' for i, h in enumerate(rows[0])]
    header_index = {norm(h): i for i, h in enumerate(headers)}

    def get(r, name):
        i = header_index[norm(name)]
        return r[i] if i < len(r) else None

    records, rejected = [], []
    carry = {'INSTRUCTOR': '', 'INST/G.V': '', 'ESTADO DEL INSTRUCTOR': ''}
    for excel_row, r in enumerate(rows[1:], start=2):
        provincia_raw = clean(get(r, 'PROVINCIA'))
        nombre = clean(get(r, 'NOMBRE DEL PUNTO'))
        # Fin de la tabla: aparecen los cuadros resumen (provincia numérica o sin nombre de punto)
        prov_key = province_alias.get(norm(provincia_raw), norm(provincia_raw))
        if prov_key not in provinces or not nombre:
            continue
        for k in carry:  # celdas combinadas por instructor
            if clean(get(r, k)):
                carry[k] = clean(get(r, k))

        raw = {
            'Latitud': get(r, 'Latitud'), 'Longitud': get(r, 'Longitud'),
            'COORDENADAS': get(r, 'COORDENADAS'),
            'LINK DE UBICACIÓN (EXACTO)': get(r, 'LINK DE UBICACIÓN (EXACTO)'),
        }
        lat, lon, fuente, obs = resolve_coordinates(raw, provinces, prov_key)

        dias = {d: clean(get(r, d)) for d in DIAS}
        dias = {d: ('' if v in ('0', 'None') else v) for d, v in dias.items()}
        rec = {
            'FILA_EXCEL': excel_row,
            'INSTRUCTOR': carry['INSTRUCTOR'],
            'TIPO_INSTRUCTOR': carry['INST/G.V'],
            'ESTADO_INSTRUCTOR': carry['ESTADO DEL INSTRUCTOR'],
            'PROVINCIA': provinces[prov_key][0],
            'CANTON': clean(get(r, 'CANTON')).upper(),
            'PARROQUIA': clean(get(r, 'PARROQUIA')).upper(),
            'BARRIO': clean(get(r, 'BARRIO')),
            'TIPO_PUNTO': clean(get(r, 'TIPO DE PUNTO')).upper(),
            'LUGAR': clean(get(r, 'LUGAR')).upper(),
            'NOMBRE_PUNTO': nombre,
            'ACTIVIDAD': clean(get(r, 'ACTIVIDAD')).upper(),
            **dias,
            'DIAS_SEMANA': clean(get(r, 'TOTAL')),
            'FECHA_INICIO': format_date(get(r, 'FECHA DE INICIO')),
            'ESTADO_PUNTO': clean(get(r, 'ESTADO PUNTO')).upper(),
            'BENEFICIARIOS': clean(get(r, 'NÚMERO DE BENEFICIARIOS')),
            'BENF_PROMEDIO': clean(get(r, 'BENF PROMEDIO')),
            'CALIFICACION': clean(get(r, 'CALIFICACION DEL PUNTO')),
            'RANKING': clean(get(r, 'RANKING')),
            'DIRECCION': clean(get(r, 'DIRECCION')),
            'LINK_UBICACION': clean(get(r, 'LINK DE UBICACIÓN (EXACTO)')),
            'OBSERVACION': clean(get(r, 'OBSERVACION')),
            'FUENTE_COORDENADA': fuente,
            'Latitud': lat,
            'Longitud': lon,
        }
        if lat is None:
            rejected.append({**rec, 'COORDENADA_ORIGINAL': clean(raw['COORDENADAS']), 'MOTIVO': obs})
        else:
            records.append(rec)

    for field in ('CANTON', 'PARROQUIA', 'LUGAR', 'ACTIVIDAD', 'TIPO_PUNTO'):
        forms = canonical_forms(records + rejected, field)
        for rec in records + rejected:
            if rec[field]:
                rec[field] = forms[norm(rec[field])]

    for n, rec in enumerate(records, start=1):
        rec['Nro'] = n

    fields = ['Nro'] + [k for k in records[0] if k != 'Nro']
    with open(APP_DIR / 'data.csv', 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.DictWriter(f, fieldnames=fields, delimiter=';')
        w.writeheader()
        w.writerows(records)

    generated = datetime.now().strftime('%d/%m/%Y %H:%M')
    (APP_DIR / 'data.js').write_text(
        '// Archivo generado por scripts/generar_datos.py — no editar a mano\n'
        f'window.ACTIVATE_META = {json.dumps({"fuente": xlsx.name, "generado": generated, "excluidos": len(rejected)}, ensure_ascii=False)};\n'
        f'window.ACTIVATE_DATA = {json.dumps(records, ensure_ascii=False)};\n',
        encoding='utf-8')
    (APP_DIR / 'provincias.js').write_text(
        f'window.PROVINCIAS_GEOJSON = {json.dumps(geo, ensure_ascii=False, separators=(",", ":"))};\n',
        encoding='utf-8')

    rej_fields = ['FILA_EXCEL', 'PROVINCIA', 'CANTON', 'PARROQUIA', 'NOMBRE_PUNTO', 'ACTIVIDAD',
                  'INSTRUCTOR', 'COORDENADA_ORIGINAL', 'LINK_UBICACION', 'MOTIVO']
    with open(APP_DIR / 'puntos_a_revisar.csv', 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.DictWriter(f, fieldnames=rej_fields, delimiter=';', extrasaction='ignore')
        w.writeheader()
        w.writerows(rejected)

    print(f'Puntos en el mapa: {len(records)}')
    print(f'Puntos excluidos (ver puntos_a_revisar.csv): {len(rejected)}')
    print('Fuente de coordenadas:', dict(Counter(r['FUENTE_COORDENADA'] for r in records)))


if __name__ == '__main__':
    main()
