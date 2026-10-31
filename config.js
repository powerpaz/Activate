// ===============================================
// Configuración del Geovisor ACTÍVATE
// ===============================================

window.APP_CONFIG = {
  // Configuración del mapa
  map: {
    defaultCenter: [-1.8312, -78.1834], // Centro de Ecuador
    defaultZoom: 7,
    minZoom: 5,
    maxZoom: 18,
    clusterRadius: 50
  },

  // URLs de tiles del mapa
  tiles: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors | Servicio ACTÍVATE - MINEDEC'
  },

  // Color del pin por actividad (las no listadas usan "otras")
  activityIcons: {
    'BAILOTERAPIA': { url: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png', label: 'Bailoterapia' },
    'EJERCICIOS FUNCIONALES': { url: 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png', label: 'Ejercicios funcionales' },
    'ACTIVIDADES RECREATIVAS': { url: 'https://maps.google.com/mapfiles/ms/icons/green-dot.png', label: 'Actividades recreativas' },
    'RUNNING': { url: 'https://maps.google.com/mapfiles/ms/icons/orange-dot.png', label: 'Running' }
  },
  otherIcon: { url: 'https://maps.google.com/mapfiles/ms/icons/yellow-dot.png', label: 'Otras (Yoga, Crosstraining, Acuaeróbicos)' },
  multipleIcon: { url: 'https://maps.google.com/mapfiles/ms/icons/purple-dot.png', label: 'Varias actividades en el mismo lugar' },

  // Días de atención (clave del dato → etiqueta)
  days: [
    ['LUNES', 'Lu', 'Lunes'],
    ['MARTES', 'Ma', 'Martes'],
    ['MIERCOLES', 'Mi', 'Miércoles'],
    ['JUEVES', 'Ju', 'Jueves'],
    ['VIERNES', 'Vi', 'Viernes'],
    ['SABADO', 'Sá', 'Sábado'],
    ['DOMINGO', 'Do', 'Domingo']
  ],

  // Fecha de corte de la matriz (correo del 23/10/2026)
  dataCutoff: '23/10/2026',

  version: '1.0.0'
};
