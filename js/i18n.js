(function () {
  if (window.ImageToolsLandingI18n) return;

  var translations = {
    en: {
      pageTitle: 'Image Tools — Photography web tools landing',
      siteTitle: 'Image Tools',
      subtitle: 'Photography and image processing tools for the web',
      introTitle: 'Pick a tool and get started',
      introText: 'Each tool here targets a specific photography or image processing task. All processing runs in your browser — no uploads to any server.',
      imageToolsTitle: 'Image tools',
      reportProblem: 'Report problem',
      toggleTheme: 'Toggle theme',
      cards: {
        harrisShutter: {
          title: 'HarrisShutter',
          desc: 'Fuse three photos into Harris Shutter composites by mapping each image to an RGB or CYM channel. Creates characteristic color-shift effects from motion between shots.'
        },
        chronoSync: {
          title: 'ChronoSync',
          desc: 'Align photos of the same location taken at different times and compose them into a collage. Uses feature detection to match and warp images to a common frame.'
        }
      }
    },
    es: {
      pageTitle: 'Image Tools — Portal de herramientas de imagen',
      siteTitle: 'Image Tools',
      subtitle: 'Herramientas de fotografía y procesado de imagen para la web',
      introTitle: 'Elige una herramienta y empieza',
      introText: 'Cada herramienta aquí resuelve una tarea concreta de fotografía o procesado de imagen. Todo el procesado se ejecuta en tu navegador, sin subir nada a ningún servidor.',
      imageToolsTitle: 'Herramientas de imagen',
      reportProblem: 'Reportar problema',
      toggleTheme: 'Cambiar tema',
      cards: {
        harrisShutter: {
          title: 'HarrisShutter',
          desc: 'Fusiona tres fotos en composiciones Harris Shutter asignando cada imagen a un canal RGB o CYM. Crea el característico efecto de desplazamiento de color producido por el movimiento entre tomas.'
        },
        chronoSync: {
          title: 'ChronoSync',
          desc: 'Alinea fotos del mismo lugar tomadas en distintos momentos y compónlas en un collage. Usa detección de puntos característicos para emparejar y deformar las imágenes a un encuadre común.'
        }
      }
    }
  };

  function getCopy(lang) {
    return translations[lang] || translations.en;
  }

  function setLang(lang) {}

  window.ImageToolsLandingI18n = { getCopy: getCopy, setLang: setLang };
})();
