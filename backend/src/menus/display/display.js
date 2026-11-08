(function () {
  var POLL_MS = 15000;
  var PAGE_MS = 20000;
  var FADE_MS = 600;
  var STALE_AFTER = 4;
  var body = document.body;
  var path = location.pathname.replace(/\/+$/, '');
  var failures = 0;
  var lastOk = new Date();
  var page = 0;

  function card() {
    return document.querySelector('main.card');
  }

  function clock(d) {
    var h = d.getHours();
    var m = d.getMinutes();
    return (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? ' am' : ' pm');
  }

  function showStale(on) {
    var line = card().querySelector('.stale');
    if (!line) return;
    if (on) {
      line.getElementsByTagName('span')[0].textContent = clock(lastOk);
      line.removeAttribute('hidden');
    } else {
      line.setAttribute('hidden', '');
    }
  }

  function failed() {
    failures += 1;
    if (failures >= STALE_AFTER) showStale(true);
  }

  function succeeded() {
    failures = 0;
    lastOk = new Date();
    showStale(false);
  }

  function get(url, type, done) {
    var x = new XMLHttpRequest();
    x.open('GET', url);
    if (type) x.responseType = type;
    x.timeout = 10000;
    x.onload = function () {
      done(x);
    };
    x.onerror = failed;
    x.ontimeout = failed;
    x.send();
  }

  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function swap(doc) {
    var next = doc && doc.querySelector('main.card');
    if (!next) return failed();
    var main = card();
    function apply() {
      main.innerHTML = next.innerHTML;
      document.title = doc.title;
      body.className = doc.body.className;
      body.setAttribute('data-version', doc.body.getAttribute('data-version'));
      page = 0;
      main.style.opacity = '1';
    }
    if (reducedMotion()) return apply();
    main.style.transition = 'opacity ' + FADE_MS + 'ms';
    main.style.opacity = '0';
    setTimeout(apply, FADE_MS);
  }

  function poll() {
    get(path + '/state', 'text', function (x) {
      if (x.status === 404) return location.reload();
      if (x.status !== 200) return failed();
      var version;
      try {
        version = JSON.parse(x.responseText).version;
      } catch (e) {
        return failed();
      }
      succeeded();
      if (version === body.getAttribute('data-version')) return;
      get(path, 'document', function (y) {
        if (y.status === 404) return location.reload();
        if (y.status !== 200) return failed();
        swap(y.response);
      });
    });
  }

  function turn() {
    var pages = card().querySelectorAll('.page');
    if (pages.length < 2) return;
    pages[page].setAttribute('hidden', '');
    page = (page + 1) % pages.length;
    pages[page].removeAttribute('hidden');
  }

  function wake() {
    if (navigator.wakeLock && document.visibilityState === 'visible') {
      navigator.wakeLock.request('screen').then(null, function () {});
    }
  }

  document.addEventListener('visibilitychange', wake);
  wake();
  setInterval(poll, POLL_MS);
  setInterval(turn, PAGE_MS);
})();
