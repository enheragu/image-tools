(function () {
  var tools = [
    {
      key: 'harrisShutter',
      section: 'image-tools',
      href: '/image-tools/HarrisShutter/',
      imageDark: '/image-tools/HarrisShutter/assets/og-image.svg',
      imageLight: '/image-tools/HarrisShutter/assets/og-image-light.svg'
    },
    {
      key: 'chronoSync',
      section: 'image-tools',
      href: '/image-tools/ChronoSync/',
      imageDark: '/image-tools/ChronoSync/assets/og-image.svg',
      imageLight: '/image-tools/ChronoSync/assets/og-image-light.svg'
    }
  ];

  var landingSections = [
    {
      sectionId: 'image-tools',
      gridId: 'tools-grid',
      catalogUrl: '/image-tools/tools-catalog.json'
    }
  ];

  document.addEventListener('DOMContentLoaded', function () {
    window.SharedToolLandingEngine.create({
      i18nGlobal: 'ImageToolsLandingI18n',
      tools: tools,
      landingSections: landingSections,
      fallbackImage: '/image-tools/assets/og-image.svg',
      toolsTitleElId: 'image-tools-title',
      toolsTitleI18nKey: 'imageToolsTitle',
      relatedWorkSourceUrl: '/image-tools/assets/related-work.json',
    }).init();
  });
})();
