(function () {
  if (window.ChronoSyncI18n) return;

  var copies = {
    en: {
      subtitle:       'Align and compare photos across time',
      introTitle:     'What is ChronoSync?',
      uploadTitle:    'Photos',
      addPhotos:      'Add photos',
      referenceLabel: 'Reference image',
      alignBtn:       'Align photos',
      clearBtn:       'Clear all',
      statusEmpty:    'Add at least two photos to begin.',
      statusOne:      'Add at least one more photo.',
      statusReady:    ' photos loaded. Click "Align photos" to process.',
      loadingEngine:  'Loading alignment engine…',
      resizing:       'Resizing images…',
      detecting:      'Detecting and matching features…',
      applyingAlign:  'Applying alignment…',
      alignedStatus:  ' photos aligned. Click "Compose collage" to assemble.',
      previewTitle:   'Alignment preview',
      showKps:        'Show keypoints',
      composeBtn:     'Compose collage',
      downloadBtn:    'Download collage',
      outputEdits:    'Output edits',
      resetEdits:     'Reset edits',
      editHint:       'Basic non-destructive adjustments before download.',
      brightness:     'Brightness',
      contrast:       'Contrast',
      saturation:     'Saturation',
      dateLabelTitle: 'Date label',
      chooseColor:    'Choose a color',
      reference:      'reference',
      inliers:        'inliers'
    },
    es: {
      subtitle:       'Alinea y compara fotos a lo largo del tiempo',
      introTitle:     '¿Qué es ChronoSync?',
      uploadTitle:    'Fotos',
      addPhotos:      'Añadir fotos',
      referenceLabel: 'Imagen de referencia',
      alignBtn:       'Alinear fotos',
      clearBtn:       'Limpiar todo',
      statusEmpty:    'Añade al menos dos fotos para empezar.',
      statusOne:      'Añade al menos una foto más.',
      statusReady:    ' fotos cargadas. Haz clic en “Alinear fotos” para procesar.',
      loadingEngine:  'Cargando motor de alineación…',
      resizing:       'Redimensionando imágenes…',
      detecting:      'Detectando y emparejando puntos…',
      applyingAlign:  'Aplicando alineación…',
      alignedStatus:  ' fotos alineadas. Haz clic en “Componer collage” para ensamblar.',
      previewTitle:   'Vista previa de alineación',
      showKps:        'Mostrar puntos característicos',
      composeBtn:     'Componer collage',
      downloadBtn:    'Descargar collage',
      outputEdits:    'Ajustes de salida',
      resetEdits:     'Restablecer ajustes',
      editHint:       'Ajustes básicos no destructivos antes de descargar.',
      brightness:     'Brillo',
      contrast:       'Contraste',
      saturation:     'Saturación',
      dateLabelTitle: 'Etiqueta de fecha',
      chooseColor:    'Elegir un color',
      reference:      'referencia',
      inliers:        'inliers'
    }
  };

  window.ChronoSyncI18n = {
    getCopy: function (lang) { return copies[lang] || copies.en; }
  };
})();
