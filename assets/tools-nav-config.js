(function () {
  var baseConfig = {
    showBackButton: true,
    homePath: '/image-tools/',
    currentPath: '/image-tools/',
    preserveLangParam: true,
    backLabel: { en: 'Back to Image Tools', es: 'Volver a Image Tools' },
    menuSections: [
      {
        items: [
          { href: '/image-tools/', label: { en: 'Main page', es: 'Página principal' } }
        ]
      },
      {
        title: { en: 'Tools', es: 'Herramientas' },
        items: [
          { href: '/image-tools/HarrisShutter/', label: { en: 'HarrisShutter', es: 'HarrisShutter' } },
          { href: '/image-tools/ChronoSync/', label: { en: 'ChronoSync', es: 'ChronoSync' } }
        ]
      }
    ]
  };

  var pageConfig = window.StatToolsNavPageConfig || {};
  var resolved = Object.assign({}, baseConfig, pageConfig);

  if (!Object.prototype.hasOwnProperty.call(pageConfig, 'menuSections')) {
    resolved.menuSections = baseConfig.menuSections;
  }

  if (!Object.prototype.hasOwnProperty.call(pageConfig, 'backLabel')) {
    resolved.backLabel = baseConfig.backLabel;
  }

  window.ToolsNavConfig = resolved;
})();
