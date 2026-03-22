/* ============================================================
   AGENCE UIO — upgrades.js (version corrigée)
   ============================================================ */

(function () {
  'use strict';

  /* ── 1. SPHÈRE THREE.JS ────────────────────────────────────── */
  function initSphere() {
    var hero = document.querySelector('.hero');
    if (!hero) return;
    var canvas = document.createElement('canvas');
    canvas.id = 'hero-webgl';
    hero.insertBefore(canvas, hero.firstChild);

    var script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
    script.onload = function () {
      var renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

      var scene  = new THREE.Scene();
      var camera = new THREE.PerspectiveCamera(58, 1, 0.1, 100);
      camera.position.set(0, 0, 4.2);

      function resize() {
        var w = canvas.offsetWidth, h = canvas.offsetHeight;
        if (!w || !h) return;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      resize();
      window.addEventListener('resize', resize);

      var sphere = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1.5, 4),
        new THREE.MeshBasicMaterial({ color: 0x00aaff, wireframe: true, transparent: true, opacity: 0.11 })
      );
      scene.add(sphere);

      var inner = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.92, 2),
        new THREE.MeshBasicMaterial({ color: 0xa855f7, wireframe: true, transparent: true, opacity: 0.09 })
      );
      scene.add(inner);

      var ring1 = new THREE.Mesh(
        new THREE.TorusGeometry(2.05, 0.004, 16, 220),
        new THREE.MeshBasicMaterial({ color: 0x7edf4a, transparent: true, opacity: 0.38 })
      );
      ring1.rotation.x = Math.PI / 3.2;
      scene.add(ring1);

      var ring2 = new THREE.Mesh(
        new THREE.TorusGeometry(1.72, 0.003, 16, 220),
        new THREE.MeshBasicMaterial({ color: 0x00aaff, transparent: true, opacity: 0.22 })
      );
      ring2.rotation.x = Math.PI / 2.1;
      ring2.rotation.y = Math.PI / 3.8;
      scene.add(ring2);

      var N = 320, pos = new Float32Array(N * 3);
      for (var i = 0; i < N; i++) {
        var theta = Math.random() * Math.PI * 2;
        var phi   = Math.acos(2 * Math.random() - 1);
        var r     = 1.55 + Math.random() * 1.3;
        pos[i*3]   = r * Math.sin(phi) * Math.cos(theta);
        pos[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
        pos[i*3+2] = r * Math.cos(phi);
      }
      var pGeo = new THREE.BufferGeometry();
      pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      var points = new THREE.Points(pGeo,
        new THREE.PointsMaterial({ color: 0x00aaff, size: 0.024, transparent: true, opacity: 0.52 })
      );
      scene.add(points);

      var mx = 0, my = 0;
      document.addEventListener('mousemove', function (e) {
        mx = (e.clientX / window.innerWidth  - 0.5) * 2;
        my = (e.clientY / window.innerHeight - 0.5) * 2;
      });

      var t = 0;
      (function loop() {
        requestAnimationFrame(loop);
        t += 0.004;
        sphere.rotation.y += 0.0022;
        sphere.rotation.x += 0.0009;
        inner.rotation.y  -= 0.0038;
        inner.rotation.z  += 0.0018;
        ring1.rotation.z  += 0.0028;
        ring2.rotation.z  -= 0.0019;
        points.rotation.y += 0.0009;
        sphere.scale.setScalar(1 + Math.sin(t * 1.4) * 0.028);
        inner.scale.setScalar(1 + Math.sin(t * 2.1) * 0.048);
        camera.position.x += (mx * 0.45 - camera.position.x) * 0.038;
        camera.position.y += (-my * 0.28 - camera.position.y) * 0.038;
        camera.lookAt(scene.position);
        renderer.render(scene, camera);
      })();
    };
    document.head.appendChild(script);
  }


  /* ── 2. MORPHING DE TEXTE — CORRIGÉ ───────────────────────── */
  /*
   * BUG ORIGINAL : on remplaçait em.textContent ce qui cassait
   * le gradient CSS (background-clip:text sur <em>).
   * FIX : on crée un <span id="morph-span"> DANS le <em> et on
   * anime seulement ce span. Le <em> garde son style gradient.
   * On sauvegarde le texte initial et on l'utilise comme 1er mot.
   */
  function initMorphText() {
    var em = document.querySelector('.hero h1 em');
    if (!em) return;

    // Crée le span interne si pas déjà là
    var span = document.getElementById('morph-span');
    if (!span) {
      span = document.createElement('span');
      span.id = 'morph-span';
      span.textContent = em.textContent;
      em.textContent = '';
      em.appendChild(span);
    }

    var words  = ["l'IA", 'un Chatbot', 'votre Site Web', '24h / 24', 'votre Croissance'];
    var CHARS  = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var idx = 0, phase = 'idle', frame = 0;

    function scramble(target, progress) {
      var len = target.length, out = '';
      for (var i = 0; i < len; i++) {
        out += (i < Math.floor(progress * len))
          ? target[i]
          : CHARS[Math.floor(Math.random() * CHARS.length)];
      }
      return out;
    }

    function tick() {
      frame++;
      if (phase === 'idle') {
        if (frame > 90) { phase = 'out'; frame = 0; }
      } else if (phase === 'out') {
        var p = 1 - frame / 20;
        span.textContent = scramble(words[idx], Math.max(0, p));
        if (frame >= 20) { idx = (idx + 1) % words.length; phase = 'in'; frame = 0; }
      } else if (phase === 'in') {
        var p2 = frame / 28;
        span.textContent = scramble(words[idx], Math.min(1, p2));
        if (frame >= 28) { span.textContent = words[idx]; phase = 'idle'; frame = 0; }
      }
      requestAnimationFrame(tick);
    }
    setTimeout(function () { requestAnimationFrame(tick); }, 3500);
  }


  /* ── 3. CURSEUR AVEC TRAÎNÉE — CORRIGÉ ────────────────────── */
  /*
   * BUG ORIGINAL : le CSS de #cursor-ring original utilisait
   * border + transition left/top, ce qui conflictuait avec le
   * nouveau positionnement par JS.
   * FIX : on override le style du ring directement par JS pour
   * le transformer en glow radial sans border.
   */
  function initCursor() {
    var dot  = document.getElementById('cursor');
    var ring = document.getElementById('cursor-ring');
    if (!dot || !ring) return;

    // Override du style du ring pour notre nouveau comportement
    ring.style.cssText = [
      'position:fixed',
      'width:40px',
      'height:40px',
      'border-radius:50%',
      'pointer-events:none',
      'z-index:99998',
      'transform:translate(-50%,-50%)',
      'background:radial-gradient(circle,rgba(0,170,255,0.28) 0%,transparent 70%)',
      'border:none',
      'transition:width .35s,height .35s,background .3s'
    ].join(';');

    // Canvas de traînée
    var trailCanvas = document.createElement('canvas');
    trailCanvas.id = 'cursor-trail-canvas';
    trailCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:99997;';
    document.body.appendChild(trailCanvas);
    var ctx = trailCanvas.getContext('2d');

    var W = trailCanvas.width  = window.innerWidth;
    var H = trailCanvas.height = window.innerHeight;
    window.addEventListener('resize', function () {
      W = trailCanvas.width  = window.innerWidth;
      H = trailCanvas.height = window.innerHeight;
    });

    var mx = -200, my = -200, ringX = -200, ringY = -200;
    var TRAIL = 30;
    var pts = [];
    for (var i = 0; i < TRAIL; i++) pts.push({ x: -200, y: -200 });
    var head = 0;

    document.addEventListener('mousemove', function (e) {
      mx = e.clientX; my = e.clientY;
      dot.style.left = mx + 'px';
      dot.style.top  = my + 'px';
      pts[head] = { x: mx, y: my };
      head = (head + 1) % TRAIL;
    });

    // Hover
    document.querySelectorAll('a, button, .av-card, .svc-card').forEach(function (el) {
      el.addEventListener('mouseenter', function () {
        dot.classList.add('hover');
        ring.style.width  = '72px';
        ring.style.height = '72px';
        ring.style.background = 'radial-gradient(circle,rgba(126,223,74,0.32) 0%,transparent 70%)';
      });
      el.addEventListener('mouseleave', function () {
        dot.classList.remove('hover');
        ring.style.width  = '40px';
        ring.style.height = '40px';
        ring.style.background = 'radial-gradient(circle,rgba(0,170,255,0.28) 0%,transparent 70%)';
      });
    });

    (function drawTrail() {
      requestAnimationFrame(drawTrail);
      ringX += (mx - ringX) * 0.13;
      ringY += (my - ringY) * 0.13;
      ring.style.left = ringX + 'px';
      ring.style.top  = ringY + 'px';

      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < TRAIL; i++) {
        var p     = pts[(head - i - 1 + TRAIL) % TRAIL];
        var ratio = 1 - i / TRAIL;
        var r     = ratio * 6.5;
        var alpha = ratio * 0.55;
        var color;
        if (ratio > 0.65)      color = 'rgba(0,170,255,'  + alpha + ')';
        else if (ratio > 0.32) color = 'rgba(168,85,247,' + (alpha * 0.85) + ')';
        else                   color = 'rgba(126,223,74,'  + (alpha * 0.6)  + ')';

        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        if (i < 7) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 2.8, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(0,170,255,' + (alpha * 0.07) + ')';
          ctx.fill();
        }
      }
    })();
  }


  /* ── 4. TILT 3D SUR LES CARTES ────────────────────────────── */
  function initTilt() {
    document.querySelectorAll('.av-card, .svc-card').forEach(function (card) {
      card.addEventListener('mousemove', function (e) {
        var rect = card.getBoundingClientRect();
        var x    = (e.clientX - rect.left) / rect.width  - 0.5;
        var y    = (e.clientY - rect.top)  / rect.height - 0.5;
        card.style.transform = 'perspective(900px) rotateX(' + (y * -12) + 'deg) rotateY(' + (x * 12) + 'deg) scale3d(1.02,1.02,1.02)';
        card.style.setProperty('--mx', ((e.clientX - rect.left) / rect.width  * 100) + '%');
        card.style.setProperty('--my', ((e.clientY - rect.top)  / rect.height * 100) + '%');
      });
      card.addEventListener('mouseleave', function () {
        card.style.transition = 'transform .5s cubic-bezier(.16,1,.3,1), border-color .3s, box-shadow .4s';
        card.style.transform  = '';
        setTimeout(function () { card.style.transition = ''; }, 500);
      });
    });
  }


  /* ── 5. SCROLL CINÉMATIQUE ─────────────────────────────────── */
  function initScroll() {
    document.querySelectorAll('.step').forEach(function (el, i) {
      el.classList.add(i % 2 === 0 ? 'reveal-left' : 'reveal-right');
    });
    document.querySelectorAll('.contact-info').forEach(function (el) {
      el.classList.add('reveal-left');
    });
    document.querySelectorAll('.chat-widget').forEach(function (el) {
      el.classList.add('reveal-right');
    });
    document.querySelectorAll('.avantages-grid .av-card').forEach(function (el, i) {
      el.style.transitionDelay = (i * 0.1) + 's';
    });
    document.querySelectorAll('.services-grid .svc-card').forEach(function (el, i) {
      el.style.transitionDelay = (i * 0.12) + 's';
    });

    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) entry.target.classList.add('visible');
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -30px 0px' });

    document.querySelectorAll('.reveal, .reveal-left, .reveal-right').forEach(function (el) {
      obs.observe(el);
    });
  }


  /* ── 6. RIPPLE SUR LES BOUTONS ─────────────────────────────── */
  function initRipple() {
    document.querySelectorAll('.btn-primary, .btn-secondary, .nav-cta, .contact-form button').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        var rect = btn.getBoundingClientRect();
        var size = Math.max(rect.width, rect.height);
        var rip  = document.createElement('span');
        rip.style.cssText = [
          'position:absolute',
          'border-radius:50%',
          'background:rgba(255,255,255,0.22)',
          'transform:scale(0)',
          'animation:ripple-anim .8s cubic-bezier(.16,1,.3,1) forwards',
          'pointer-events:none',
          'width:'  + size + 'px',
          'height:' + size + 'px',
          'left:'   + (e.clientX - rect.left  - size / 2) + 'px',
          'top:'    + (e.clientY - rect.top   - size / 2) + 'px'
        ].join(';');
        btn.appendChild(rip);
        setTimeout(function () { rip.remove(); }, 850);
      });
    });
  }


  /* ── 7. COMPTEURS ANIMÉS — CORRIGÉ ────────────────────────── */
  /*
   * BUG ORIGINAL : les sélecteurs nth-child cherchaient
   * .stat-num à l'intérieur de stat-item:nth-child(N) mais
   * les .stat-item sont dans .stat-strip et ont déjà le texte
   * en dur. On lit le texte existant et on anime depuis 0.
   */
  function initCounters() {
    var items = document.querySelectorAll('.stat-item');
    if (!items.length) return;

    var configs = [];
    items.forEach(function (item) {
      var numEl = item.querySelector('.stat-num');
      if (!numEl) return;
      var text   = numEl.textContent.trim();
      // Extrait le nombre et le suffixe (ex: "24h" → end:24, suffix:"h")
      var match  = text.match(/^(\d+)(.*)/);
      if (!match) return;
      configs.push({
        el:       numEl,
        end:      parseInt(match[1], 10),
        suffix:   match[2],
        duration: 1400
      });
      numEl.textContent = '0' + match[2]; // reset à 0
    });

    var strip = document.querySelector('.stat-strip');
    if (!strip) return;

    var fired = false;
    var obs = new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting || fired) return;
      fired = true;
      obs.disconnect();

      configs.forEach(function (c) {
        var start = Date.now();
        (function tick() {
          var elapsed  = Date.now() - start;
          var progress = Math.min(elapsed / c.duration, 1);
          var eased    = 1 - Math.pow(1 - progress, 3);
          c.el.textContent = Math.round(eased * c.end) + c.suffix;
          if (progress < 1) requestAnimationFrame(tick);
        })();
      });
    }, { threshold: 0.5 });

    obs.observe(strip);
  }


  /* ── 8. INDICATEUR DE SCROLL ───────────────────────────────── */
  function initScrollHint() {
    var hero = document.querySelector('.hero');
    if (!hero) return;
    var hint = document.createElement('div');
    hint.className = 'scroll-hint';
    hint.innerHTML = '<span>Scroll</span><div class="scroll-hint-line"></div>';
    hero.appendChild(hint);
    window.addEventListener('scroll', function () {
      hint.style.opacity    = '0';
      hint.style.transition = 'opacity .5s';
    }, { once: true });
  }


  /* ── 9. BADGE "AGENCE ACTIVE" ──────────────────────────────── */
  function initBadge() {
    var badge = document.createElement('div');
    badge.className = 'live-badge';
    badge.innerHTML = '&#9679;&nbsp;&nbsp;Agence active';
    document.body.appendChild(badge);
  }


  /* ── 10. PARALLAX HALO AU SCROLL ──────────────────────────── */
  function initParallax() {
    var glow = document.querySelector('.hero-glow');
    if (!glow) return;
    window.addEventListener('scroll', function () {
      glow.style.transform = 'translate(-50%, calc(-50% + ' + (window.scrollY * 0.35) + 'px))';
    }, { passive: true });
  }


  /* ── INIT ─────────────────────────────────────────────────── */
  function init() {
    initSphere();
    initMorphText();
    initCursor();
    initTilt();
    initScroll();
    initRipple();
    initCounters();
    initScrollHint();
    initBadge();
    initParallax();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
