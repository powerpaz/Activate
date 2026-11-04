// ===============================================
// Geovisor de Puntos del Servicio ACTÍVATE
// Basado en el Sistema de Visualización Geográfica AMIE
// ===============================================

(function() {
  'use strict';

  const CONFIG = window.APP_CONFIG;

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  }

  function toInt(value) {
    const n = parseInt(String(value || '').replace(/\D/g, ''), 10);
    return Number.isFinite(n) ? n : 0;
  }

  let map;
  let markersLayer;
  let provinciasLayer;
  let data = [];
  let filteredData = [];
  let filters = getEmptyFilters();

  function getEmptyFilters() {
    return {
      texto: '',
      provincia: '',
      canton: '',
      parroquia: '',
      lugar: '',
      actividad: '',
      tipo: '',
      dia: ''
    };
  }

  document.addEventListener('DOMContentLoaded', initApp);

  function initApp() {
    initMap();
    renderLegend();
    setupEventListeners();
    loadData();
  }

  function initMap() {
    map = L.map('map', {
      center: CONFIG.map.defaultCenter,
      zoom: CONFIG.map.defaultZoom,
      zoomControl: true,
      attributionControl: true
    });

    L.tileLayer(CONFIG.tiles.url, {
      attribution: CONFIG.tiles.attribution,
      maxZoom: CONFIG.map.maxZoom,
      minZoom: CONFIG.map.minZoom
    }).addTo(map);

    if (window.PROVINCIAS_GEOJSON) {
      provinciasLayer = L.geoJSON(window.PROVINCIAS_GEOJSON, {
        style: provinceStyle,
        onEachFeature: (feature, layer) => {
          layer.bindTooltip(feature.properties.DPA_DESPRO, { sticky: true, direction: 'top', opacity: 0.9 });
        }
      }).addTo(map);
      provinciasLayer.bringToBack();
    } else {
      console.warn('No se encontró provincias.js: la capa de provincias no se mostrará');
    }

    markersLayer = L.markerClusterGroup({
      chunkedLoading: true,
      spiderfyOnMaxZoom: false,
      showCoverageOnHover: true,
      zoomToBoundsOnClick: true,
      maxClusterRadius: zoom => (zoom <= 5 ? 200 : CONFIG.map.clusterRadius),
      disableClusteringAtZoom: 7,
      iconCreateFunction: cluster => {
        const childCount = cluster.getChildCount();
        let c = ' marker-cluster-';
        if (childCount < 10) c += 'small';
        else if (childCount < 100) c += 'medium';
        else c += 'large';
        return new L.DivIcon({
          html: '<div><span>' + childCount + '</span></div>',
          className: 'marker-cluster' + c,
          iconSize: new L.Point(40, 40)
        });
      }
    });

    map.addLayer(markersLayer);
  }

  // Contorno negro como en el geovisor AMIE; la provincia filtrada se resalta
  function provinceStyle(feature) {
    const selected = filters.provincia && feature.properties.DPA_DESPRO === filters.provincia;
    return selected
      ? { color: '#572364', weight: 3, opacity: 1, fillColor: '#572364', fillOpacity: 0.08 }
      : { color: '#000', weight: 1.2, opacity: 1, fillOpacity: 0 };
  }

  // Con solo la provincia filtrada se encuadra la provincia completa, no solo sus puntos
  function fitSelectedProvince() {
    if (!provinciasLayer || !filters.provincia || filters.canton || filters.parroquia || filters.texto) return;
    const layer = provinciasLayer.getLayers().find(l => l.feature.properties.DPA_DESPRO === filters.provincia);
    if (layer) map.fitBounds(layer.getBounds(), { padding: [20, 20] });
  }

  function loadData() {
    updateStatus('Cargando datos...');
    const rows = window.ACTIVATE_DATA;
    if (!Array.isArray(rows)) {
      updateStatus('Error: no se encontró data.js');
      return;
    }
    data = rows.map(row => ({
      ...row,
      LATITUD: Number(row.Latitud),
      LONGITUD: Number(row.Longitud),
      BENEF: toInt(row.BENF_PROMEDIO),  // BENEFICIARIOS viene vacío en ~2/3 de la matriz
      _search: normalizeText([row.NOMBRE_PUNTO, row.INSTRUCTOR, row.BARRIO, row.DIRECCION].join(' '))
    })).filter(row => Number.isFinite(row.LATITUD) && Number.isFinite(row.LONGITUD));

    const meta = window.ACTIVATE_META || {};
    const fuente = document.getElementById('fuenteTxt');
    if (fuente) {
      fuente.textContent = `Matriz de Horarios y Puntos ACTÍVATE (corte ${CONFIG.dataCutoff})` +
        (meta.excluidos ? ` · ${meta.excluidos} puntos sin coordenada válida no se muestran` : '');
    }

    filteredData = [...data];
    refreshOptions();
    renderLegend();
    renderMarkers();
    updateStatistics();
    updateFilterStatus();
    updateMapSubtitle();
    updateStatus(`Listo: ${data.length} puntos cargados`);
  }

  // Filtros de lista: cada uno muestra solo opciones con resultados según los demás filtros
  const SELECT_FILTERS = [
    { id: 'provSel', key: 'provincia', empty: 'Todas las provincias', value: r => r.PROVINCIA },
    { id: 'cantSel', key: 'canton', empty: 'Todos los cantones', value: r => r.CANTON },
    { id: 'parrSel', key: 'parroquia', empty: 'Todas las parroquias', value: r => r.PARROQUIA },
    { id: 'lugarSel', key: 'lugar', empty: 'Todos los lugares', value: r => r.LUGAR },
    { id: 'actividadSel', key: 'actividad', empty: 'Todas las actividades', value: r => r.ACTIVIDAD,
      label: v => `${activityStyle(v).emoji} ${activityStyle(v).label}` },
    { id: 'tipoSel', key: 'tipo', empty: 'Todos', value: r => r.TIPO_PUNTO },
    { id: 'diaSel', key: 'dia', empty: 'Todos' }
  ];

  function matches(row, except) {
    if (filters.texto && !row._search.includes(filters.texto)) return false;
    for (const f of SELECT_FILTERS) {
      if (f.key === except || !filters[f.key]) continue;
      if (f.key === 'dia' ? !row[filters.dia] : f.value(row) !== filters[f.key]) return false;
    }
    return true;
  }

  function refreshOptions() {
    const fmt = n => n.toLocaleString('es-EC');
    SELECT_FILTERS.forEach(f => {
      const rows = data.filter(r => matches(r, f.key));
      let options;
      if (f.key === 'dia') {
        options = CONFIG.days.map(([key, , label]) => ({ value: key, label, count: rows.filter(r => r[key]).length }));
      } else {
        const counts = new Map();
        rows.forEach(r => { const v = f.value(r); if (v) counts.set(v, (counts.get(v) || 0) + 1); });
        if (filters[f.key] && !counts.has(filters[f.key])) counts.set(filters[f.key], 0);
        options = [...counts.keys()].sort((x, y) => x.localeCompare(y, 'es'))
          .map(v => ({ value: v, label: f.label ? f.label(v) : v, count: counts.get(v) }));
      }
      populateSelect(f.id, options.filter(o => o.count > 0 || o.value === filters[f.key])
        .map(o => ({ value: o.value, label: `${o.label} (${fmt(o.count)})` })), `${f.empty} (${fmt(rows.length)})`);
      document.getElementById(f.id).value = filters[f.key];
    });
  }

  function uniqueSorted(values) {
    return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'es'));
  }

  function populateSelect(id, values, emptyLabel) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '';
    el.appendChild(new Option(emptyLabel, ''));
    values.forEach(({ value, label }) => el.appendChild(new Option(label, value)));
  }

  function setupEventListeners() {
    const buscarTxt = document.getElementById('buscarTxt');
    if (buscarTxt) {
      buscarTxt.addEventListener('input', e => {
        filters.texto = normalizeText(e.target.value);
        applyFilters();
      });
    }

    SELECT_FILTERS.forEach(({ id, key }) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', e => {
        filters[key] = e.target.value;
        // Al cambiar de nivel superior se limpian los niveles inferiores
        if (key === 'provincia') { filters.canton = ''; filters.parroquia = ''; }
        if (key === 'canton') filters.parroquia = '';
        applyFilters();
      });
    });

    const btnLimpiar = document.getElementById('btnLimpiar');
    if (btnLimpiar) btnLimpiar.addEventListener('click', clearFilters);

    setupMobilePanel();
  }

  // En celulares los filtros viven en un panel deslizable sobre el mapa
  function isMobile() {
    return window.matchMedia('(max-width: 768px), (max-height: 500px) and (max-width: 1024px)').matches;
  }

  function setPanelOpen(open) {
    document.body.classList.toggle('panel-open', open);
    const btn = document.getElementById('btnPanel');
    if (btn) btn.setAttribute('aria-expanded', String(open));
    if (!open) setTimeout(() => map.invalidateSize(), 260);
  }

  function setupMobilePanel() {
    const on = (id, handler) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', handler);
    };
    on('btnPanel', () => setPanelOpen(!document.body.classList.contains('panel-open')));
    on('btnCerrarPanel', () => setPanelOpen(false));
    on('btnVerMapa', () => setPanelOpen(false));
    on('sidebarBackdrop', () => setPanelOpen(false));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') setPanelOpen(false);
    });

    // Al girar el celular o pasar a escritorio, el mapa recalcula su tamaño
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!isMobile()) setPanelOpen(false);
        map.invalidateSize();
      }, 150);
    });

    // En pantallas angostas la ficha se centra para que no quede cortada en un borde
    map.on('popupopen', e => {
      if (!isMobile()) return;
      const el = e.popup.getElement();
      const point = map.project(e.popup.getLatLng());
      point.y -= (el ? el.offsetHeight : 0) / 2;
      map.panTo(map.unproject(point), { animate: false });
    });
  }

  function activeFilterCount() {
    return Object.values(filters).filter(Boolean).length;
  }

  function applyFilters() {
    filteredData = data.filter(row => matches(row));
    refreshOptions();

    if (provinciasLayer) provinciasLayer.setStyle(provinceStyle);
    renderMarkers();
    fitSelectedProvince();
    updateStatistics();
    updateFilterStatus();
    updateMapSubtitle();
    updateStatus(`Mostrando ${filteredData.length} de ${data.length} puntos`);
    updateMobileControls();
  }

  // Número de filtros activos en el botón del celular y conteo en «Ver resultados»
  function updateMobileControls() {
    const n = activeFilterCount();
    setText('btnPanelCount', n ? String(n) : '');
    setText('btnVerMapa', `Ver ${filteredData.length.toLocaleString('es-EC')} resultados en el mapa`);
  }

  function clearFilters() {
    filters = getEmptyFilters();
    const buscarTxt = document.getElementById('buscarTxt');
    if (buscarTxt) buscarTxt.value = '';
    applyFilters();
  }

  // Un mismo lugar puede tener varias actividades: se agrupan en un solo pin
  function groupByLocation(rows) {
    const groups = new Map();
    rows.forEach(row => {
      const key = row.LATITUD.toFixed(6) + ',' + row.LONGITUD.toFixed(6);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    return [...groups.values()];
  }

  function activityStyle(actividad) {
    return CONFIG.activities[actividad] || { ...CONFIG.defaultActivity, label: actividad || CONFIG.defaultActivity.label };
  }

  function pinHtml(emoji, color, count) {
    return `<div class="act-pin" style="--pin:${color}"><span class="act-emoji">${emoji}</span></div>` +
      (count ? `<span class="act-count">${count}</span>` : '');
  }

  // Pin con el emoji de la actividad; si el lugar tiene varias, se usa la más frecuente
  // con borde morado y la cantidad de actividades
  function iconFor(rows) {
    const counts = new Map();
    rows.forEach(r => counts.set(r.ACTIVIDAD, (counts.get(r.ACTIVIDAD) || 0) + 1));
    const main = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const style = activityStyle(main);
    const several = counts.size > 1;
    return L.divIcon({
      html: pinHtml(style.emoji, several ? CONFIG.multipleActivities.color : style.color, several ? rows.length : 0),
      className: 'act-marker',
      iconSize: [38, 46],
      iconAnchor: [19, 44],
      popupAnchor: [0, -42]
    });
  }

  function renderLegend() {
    const legend = document.getElementById('legend');
    if (!legend) return;
    const present = new Set(data.map(r => r.ACTIVIDAD));
    const items = Object.entries(CONFIG.activities)
      .filter(([key]) => !data.length || present.has(key))
      .map(([, s]) => `<span class="legend-item"><span class="legend-emoji" style="--pin:${s.color}">${s.emoji}</span>${escapeHtml(s.label)}</span>`);
    items.push(`<span class="legend-item"><span class="legend-emoji multi" style="--pin:${CONFIG.multipleActivities.color}">#</span>${escapeHtml(CONFIG.multipleActivities.label)}</span>`);
    legend.innerHTML = items.join('');
  }

  function renderMarkers() {
    markersLayer.clearLayers();
    const markers = [];

    groupByLocation(filteredData).forEach(rows => {
      const marker = L.marker([rows[0].LATITUD, rows[0].LONGITUD], {
        icon: iconFor(rows),
        title: rows.length > 1 ? `${rows[0].LUGAR} (${rows.length} actividades)` : rows[0].NOMBRE_PUNTO
      });

      marker.bindPopup(() => createPopupContent(rows), {
        maxWidth: Math.min(440, window.innerWidth - 56),
        className: 'custom-popup',
        autoPanPadding: [12, 12]
      });

      markersLayer.addLayer(marker);
      markers.push(marker);
    });

    try {
      if (filteredData.length > 0) {
        const bounds = markersLayer.getBounds();
        if (bounds.isValid()) map.fitBounds(bounds, { maxZoom: 14, padding: [20, 20] });
      }
    } catch (error) {
      console.warn('No se pudo ajustar el mapa:', error);
    }

    // Con un único lugar (p. ej. Yoga o Acuaeróbicos) se abre su ficha para que no pase desapercibido
    if (markers.length === 1 && filteredData.length < data.length) {
      markersLayer.zoomToShowLayer(markers[0], () => markers[0].openPopup());
    }
  }

  function createPopupContent(rows) {
    const first = rows[0];
    const title = rows.length > 1 ? (first.LUGAR || 'Punto ACTÍVATE') : first.NOMBRE_PUNTO;
    const subtitle = rows.length > 1
      ? `${rows.length} actividades en este lugar`
      : `${activityStyle(first.ACTIVIDAD).emoji} ${activityStyle(first.ACTIVIDAD).label} · Tipo de punto: ${first.TIPO_PUNTO || 'N/A'}`;
    const mapsLink = first.LINK_UBICACION && /^https?:\/\//i.test(first.LINK_UBICACION)
      ? first.LINK_UBICACION
      : `https://www.google.com/maps?q=${first.LATITUD},${first.LONGITUD}`;

    return `
      <div class="popup-wrapper">
        <div class="popup-header">
          <h3 class="popup-title">${escapeHtml(title)}</h3>
          <p class="popup-subtitle">${escapeHtml(subtitle)}</p>
        </div>
        <div class="popup-content">
          ${popupRow('Provincia', first.PROVINCIA)}
          ${popupRow('Cantón', first.CANTON)}
          ${popupRow('Parroquia', first.PARROQUIA)}
          ${popupRow('Barrio', first.BARRIO)}
          ${popupRow('Lugar', first.LUGAR)}
          ${popupRow('Dirección', first.DIRECCION)}
          ${rows.map(activityBlock).join('')}
          <a class="popup-link" href="${escapeHtml(mapsLink)}" target="_blank" rel="noopener">Ver ubicación en Google Maps ↗</a>
          ${popupRow('Coordenadas', `${first.LATITUD}, ${first.LONGITUD}`)}
        </div>
      </div>
    `;
  }

  function activityBlock(row) {
    const head = CONFIG.days.map(([, short]) => `<th>${short}</th>`).join('');
    const cells = CONFIG.days.map(([key]) => row[key]
      ? `<td class="on">${escapeHtml(row[key])}</td>`
      : '<td>–</td>').join('');
    const stars = row.RANKING ? `<span class="popup-stars">${escapeHtml(row.RANKING)}</span>` : '';
    return `
      <div class="popup-block">
        <div class="popup-block-title">
          <span>${escapeHtml(row.NOMBRE_PUNTO)}</span>
          <span class="popup-badge" style="--pin:${activityStyle(row.ACTIVIDAD).color}">${activityStyle(row.ACTIVIDAD).emoji} ${escapeHtml(activityStyle(row.ACTIVIDAD).label)}</span>
        </div>
        <table class="popup-schedule"><tr>${head}</tr><tr>${cells}</tr></table>
        ${popupRow('Instructor', row.INSTRUCTOR)}
        ${popupRow('Tipo de punto', row.TIPO_PUNTO)}
        ${popupRow('Beneficiarios', row.BENEFICIARIOS)}
        ${popupRow('Benef. promedio', row.BENF_PROMEDIO)}
        <div class="popup-row">
          <span class="popup-label">Calificación:</span>
          <span class="popup-value">${stars || 'N/A'}</span>
        </div>
        ${popupRow('Estado del punto', row.ESTADO_PUNTO)}
        ${popupRow('Fecha de inicio', row.FECHA_INICIO)}
        ${row.OBSERVACION ? popupRow('Observación', row.OBSERVACION) : ''}
      </div>
    `;
  }

  function popupRow(label, value) {
    return `
      <div class="popup-row">
        <span class="popup-label">${escapeHtml(label)}:</span>
        <span class="popup-value">${escapeHtml(value || 'N/A')}</span>
      </div>
    `;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function updateStatistics() {
    const fmt = n => n.toLocaleString('es-EC');
    const totalBenef = filteredData.reduce((sum, r) => sum + r.BENEF, 0);
    const instructores = new Set(filteredData.map(r => r.INSTRUCTOR).filter(Boolean)).size;

    setText('countPuntos', fmt(data.length));
    setText('currentMatches', fmt(filteredData.length));
    setText('countBeneficiarios', fmt(totalBenef));
    setText('countInstructores', fmt(instructores));
    setText('totalCell', fmt(filteredData.length));
    setText('totalBenefCell', fmt(totalBenef));

    const tbody = document.querySelector('#rubrosTable tbody');
    if (tbody) {
      tbody.innerHTML = uniqueSorted(data.map(r => r.ACTIVIDAD)).map(tipo => {
        const rows = filteredData.filter(row => row.ACTIVIDAD === tipo);
        return `
          <tr>
            <td>${activityStyle(tipo).emoji} ${escapeHtml(activityStyle(tipo).label)}</td>
            <td>${fmt(rows.length)}</td>
            <td>${fmt(rows.reduce((sum, r) => sum + r.BENEF, 0))}</td>
          </tr>
        `;
      }).join('');
    }
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function updateFilterStatus() {
    const dayLabel = (CONFIG.days.find(([key]) => key === filters.dia) || [])[2];
    const activeFilters = [];
    if (filters.texto) activeFilters.push(`Búsqueda: ${filters.texto}`);
    if (filters.provincia) activeFilters.push(`Provincia: ${filters.provincia}`);
    if (filters.canton) activeFilters.push(`Cantón: ${filters.canton}`);
    if (filters.parroquia) activeFilters.push(`Parroquia: ${filters.parroquia}`);
    if (filters.lugar) activeFilters.push(`Lugar: ${filters.lugar}`);
    if (filters.actividad) activeFilters.push(`Actividad: ${filters.actividad}`);
    if (filters.tipo) activeFilters.push(`Tipo: ${filters.tipo}`);
    if (filters.dia) activeFilters.push(`Día: ${dayLabel}`);
    const filtrosElement = document.getElementById('filtrosActivos');
    if (filtrosElement) {
      filtrosElement.textContent = activeFilters.length ? `Filtros activos: ${activeFilters.join(' | ')}` : 'Sin filtros activos';
    }
  }

  function updateMapSubtitle() {
    const el = document.getElementById('mapSubtitle');
    if (!el) return;
    if (filters.actividad) {
      el.textContent = `VISUALIZACIÓN FILTRADA: ${filters.actividad}`;
    } else if (filters.provincia) {
      el.textContent = `VISUALIZACIÓN FILTRADA: ${filters.provincia}`;
    } else {
      el.textContent = 'VISUALIZACIÓN GENERAL DE PUNTOS';
    }
  }

  function updateStatus(message) {
    const statusElement = document.getElementById('status');
    if (statusElement) statusElement.textContent = message;
    console.log(message);
  }

  window.addEventListener('error', event => {
    console.error('Error:', event.error);
    updateStatus('Error en la aplicación');
  });
})();
