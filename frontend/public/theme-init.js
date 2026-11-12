// Apply the stored theme before first paint to avoid a light flash for dark-theme users.
;(function () {
  var theme = 'light'
  try {
    var stored = localStorage.getItem('lumi.theme')
    if (stored === 'dark') theme = 'dark'
    else if (stored === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      theme = 'dark'
  } catch {
    // Storage can be unavailable; the light theme remains usable.
  }
  document.documentElement.dataset.theme = theme
})()
