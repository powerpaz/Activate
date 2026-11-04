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

  // Ícono (emoji) y color de cada actividad: se usan en el pin, la leyenda, el filtro y la ficha.
  // La clave es el valor de la columna ACTIVIDAD de la matriz.
  activities: {
    'BAILOTERAPIA': { emoji: '💃', color: '#e0315a', label: 'Bailoterapia' },
    'EJERCICIOS FUNCIONALES': { emoji: '🏋️', color: '#1d6fd8', label: 'Ejercicios funcionales' },
    'ACTIVIDADES RECREATIVAS': { emoji: '🤸', color: '#16a34a', label: 'Actividades recreativas' },
    'RUNNING': { emoji: '🏃', color: '#f08c00', label: 'Running' },
    'YOGA': { emoji: '🧘', color: '#0d9488', label: 'Yoga' },
    'CROSSTRAINING': { emoji: '💪', color: '#a0522d', label: 'Crosstraining' },
    'ACUAERÓBICOS': { emoji: '🏊', color: '#0891b2', label: 'Acuaeróbicos' }
  },
  // Actividad nueva que aún no esté en la lista de arriba
  defaultActivity: { emoji: '📍', color: '#6b7280', label: 'Otra actividad' },
  // Lugar con varias actividades distintas: borde morado y número de actividades
  multipleActivities: { color: '#572364', label: 'Varias actividades en el mismo lugar' },

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
