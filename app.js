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
    populateFilters();
    renderMarkers();
    updateStatistics();
    updateFilterStatus();
    updateMapSubtitle();
    updateStatus(`Listo: ${data.length} puntos cargados`);
  }

  function populateFilters() {
    populateSelect('provSel', uniqueSorted(data.map(r => r.PROVINCIA)), 'Todas las provincias');
    updateCantonOptions('');
    updateParroquiaOptions('', '');
    populateSelect('lugarSel', uniqueSorted(data.map(r => r.LUGAR)), 'Todos los lugares');
    populateSelect('actividadSel', uniqueSorted(data.map(r => r.ACTIVIDAD)), 'Todas las actividades');
    populateSelect('tipoSel', uniqueSorted(data.map(r => r.TIPO_PUNTO)), 'Todos los tipos de punto');
    populateSelect('diaSel', CONFIG.days.map(([key, , label]) => ({ value: key, label })), 'Todos los días');
  }

  function uniqueSorted(values) {
    return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'es'));
  }

  function populateSelect(id, values, emptyLabel) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = `<option value="">${emptyLabel}</option>`;
    values.forEach(value => {
      const option = document.createElement('option');
      option.value = typeof value === 'object' ? value.value : value;
      option.textContent = typeof value === 'object' ? value.label : value;
      el.appendChild(option);
    });
  }

  function setupEventListeners() {
    const buscarTxt = document.getElementById('buscarTxt');
    if (buscarTxt) {
      buscarTxt.addEventListener('input', e => {
        filters.texto = normalizeText(e.target.value);
        applyFilters();
      });
    }

    [
      { id: 'provSel', key: 'provincia' },
      { id: 'cantSel', key: 'canton' },
      { id: 'parrSel', key: 'parroquia' },
      { id: 'lugarSel', key: 'lugar' },
      { id: 'actividadSel', key: 'actividad' },
      { id: 'tipoSel', key: 'tipo' },
      { id: 'diaSel', key: 'dia' }
    ].forEach(({ id, key }) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', e => {
        filters[key] = e.target.value;
        if (key === 'provincia') {
          filters.canton = '';
          filters.parroquia = '';
          updateCantonOptions(filters.provincia);
          updateParroquiaOptions(filters.provincia, '');
        }
        if (key === 'canton') {
          filters.parroquia = '';
          updateParroquiaOptions(filters.provincia, filters.canton);
        }
        applyFilters();
      });
    });

    setupDropdownButton('btnActividadFilter', 'actividadFilterDropdown');
    setupDropdownButton('btnTipoFilter', 'tipoFilterDropdown');
    setupDropdownButton('btnDiaFilter', 'diaFilterDropdown');

    const btnLimpiar = document.getElementById('btnLimpiar');
    if (btnLimpiar) btnLimpiar.addEventListener('click', clearFilters);
  }

  function setupDropdownButton(buttonId, dropdownId) {
    const button = document.getElementById(buttonId);
    const dropdown = document.getElementById(dropdownId);
    if (!button || !dropdown) return;
    button.addEventListener('click', () => {
      dropdown.classList.toggle('hidden');
    });
  }

  function updateCantonOptions(provincia) {
    const rows = provincia ? data.filter(r => r.PROVINCIA === provincia) : data;
    populateSelect('cantSel', uniqueSorted(rows.map(r => r.CANTON)), 'Todos los cantones');
  }

  function updateParroquiaOptions(provincia, canton) {
    const rows = data.filter(r => (!provincia || r.PROVINCIA === provincia) && (!canton || r.CANTON === canton));
    populateSelect('parrSel', uniqueSorted(rows.map(r => r.PARROQUIA)), 'Todas las parroquias');
  }

  function applyFilters() {
    filteredData = data.filter(row => {
      if (filters.texto && !row._search.includes(filters.texto)) return false;
      if (filters.provincia && row.PROVINCIA !== filters.provincia) return false;
      if (filters.canton && row.CANTON !== filters.canton) return false;
      if (filters.parroquia && row.PARROQUIA !== filters.parroquia) return false;
      if (filters.lugar && row.LUGAR !== filters.lugar) return false;
      if (filters.actividad && row.ACTIVIDAD !== filters.actividad) return false;
      if (filters.tipo && row.TIPO_PUNTO !== filters.tipo) return false;
      if (filters.dia && !row[filters.dia]) return false;
      return true;
    });

    if (provinciasLayer) provinciasLayer.setStyle(provinceStyle);
    renderMarkers();
    fitSelectedProvince();
    updateStatistics();
    updateFilterStatus();
    updateMapSubtitle();
    updateStatus(`Mostrando ${filteredData.length} de ${data.length} puntos`);
  }

  function clearFilters() {
    filters = getEmptyFilters();
    ['buscarTxt', 'provSel', 'cantSel', 'parrSel', 'lugarSel', 'actividadSel', 'tipoSel', 'diaSel'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.tagName === 'INPUT') el.value = '';
      else el.selectedIndex = 0;
    });
    ['actividadFilterDropdown', 'tipoFilterDropdown', 'diaFilterDropdown'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
    updateCantonOptions('');
    updateParroquiaOptions('', '');
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

  function iconFor(rows) {
    const activities = new Set(rows.map(r => r.ACTIVIDAD));
    if (activities.size > 1) return CONFIG.multipleIcon.url;
    const icon = CONFIG.activityIcons[rows[0].ACTIVIDAD];
    return (icon || CONFIG.otherIcon).url;
  }

  function renderLegend() {
    const legend = document.getElementById('legend');
    if (!legend) return;
    const items = [...Object.values(CONFIG.activityIcons), CONFIG.otherIcon, CONFIG.multipleIcon];
    legend.innerHTML = items.map(item => `
      <span class="legend-item"><img src="${item.url}" alt="" class="legend-icon">${escapeHtml(item.label)}</span>
    `).join('');
  }

  function renderMarkers() {
    markersLayer.clearLayers();

    groupByLocation(filteredData).forEach(rows => {
      const customIcon = L.icon({
        iconUrl: iconFor(rows),
        iconSize: [32, 32],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32],
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        shadowSize: [41, 41],
        shadowAnchor: [13, 41]
      });

      const marker = L.marker([rows[0].LATITUD, rows[0].LONGITUD], {
        icon: customIcon,
        title: rows.length > 1 ? `${rows[0].LUGAR} (${rows.length} actividades)` : rows[0].NOMBRE_PUNTO
      });

      marker.bindPopup(() => createPopupContent(rows), {
        maxWidth: 440,
        className: 'custom-popup'
      });

      markersLayer.addLayer(marker);
    });

    try {
      if (filteredData.length > 0) {
        const bounds = markersLayer.getBounds();
        if (bounds.isValid()) map.fitBounds(bounds, { maxZoom: 14, padding: [20, 20] });
      }
    } catch (error) {
      console.warn('No se pudo ajustar el mapa:', error);
    }
  }

  function createPopupContent(rows) {
    const first = rows[0];
    const title = rows.length > 1 ? (first.LUGAR || 'Punto ACTÍVATE') : first.NOMBRE_PUNTO;
    const subtitle = rows.length > 1
      ? `${rows.length} actividades en este lugar`
      : `${first.ACTIVIDAD || 'Sin actividad'} · Tipo de punto: ${first.TIPO_PUNTO || 'N/A'}`;
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
          <span class="popup-badge">${escapeHtml(row.ACTIVIDAD || 'N/A')}</span>
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
            <td>${escapeHtml(tipo)}</td>
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
