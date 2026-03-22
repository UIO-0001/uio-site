/* ============================================================
   AGENCE UIO — upgrades.js v3
   ============================================================ */

(function () {
  'use strict';

  /* ── 1. SPHÈRE THREE.JS — réaction souris plus forte ─────── */
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
        // Réaction souris plus forte : 1.8 au lieu de 0.45
        camera.position.x += (mx * 1.8 - camera.position.x) * 0.055;
        camera.position.y += (-my * 1.2 - camera.position.y) * 0.055;
        camera.lookAt(scene.position);
        renderer.render(scene, camera);
      })();
    };
    document.head.appendChild(script);
  }


  /* ── 2. MORPHING — typewriter, hauteur fixe ──────────────── */
  function initMorphText() {
    var h1 = document.querySelector('.hero h1');
    if (!h1) return;
    h1.innerHTML = 'Votre entreprise,<br/>propulsée par <em id="morph-em"></em>';

    var em = document.getElementById('morph-em');

    // Hauteur fixe sur h1 — empêche le saut quand le mot change de longueur
    h1.style.height = '240px';
    h1.style.marginBottom = '32px';
    var sub = document.querySelector('.hero-sub');
    if (sub) sub.style.marginTop = '30px';
    em.style.cssText = 'display:inline-block;white-space:nowrap;vertical-align:bottom;';

    // Curseur clignotant
    var cursorEl = document.createElement('span');
    cursorEl.textContent = '|';
    cursorEl.style.cssText = 'display:inline-block;margin-left:1px;opacity:1;';
    em.after(cursorEl);

    if (!document.getElementById('morph-style')) {
      var s = document.createElement('style');
      s.id = 'morph-style';
      s.textContent = '@keyframes blink-cursor{0%,100%{opacity:1}50%{opacity:0}}';
      document.head.appendChild(s);
    }
    cursorEl.style.animation = 'blink-cursor .7s ease-in-out infinite';

    var words = ["l'IA", 'un Chatbot', 'un Site Web', 'la technologie', "l'automatisation"];
    var idx = 0;
    var currentText = '';
    var phase = 'typing';
    var charIdx = 0;

    function tick() {
      if (phase === 'typing') {
        var target = words[idx];
        if (charIdx <= target.length) {
          currentText = target.slice(0, charIdx);
          em.textContent = currentText;
          em.appendChild(cursorEl);
          charIdx++;
          setTimeout(tick, 70);
        } else {
          phase = 'pause';
          setTimeout(tick, 1800);
        }
      } else if (phase === 'pause') {
        phase = 'deleting';
        setTimeout(tick, 80);
      } else if (phase === 'deleting') {
        if (currentText.length > 0) {
          currentText = currentText.slice(0, -1);
          em.textContent = currentText;
          em.appendChild(cursorEl);
          setTimeout(tick, 45);
        } else {
          idx = (idx + 1) % words.length;
          charIdx = 0;
          phase = 'typing';
          setTimeout(tick, 300);
        }
      }
    }

    setTimeout(tick, 1000);
  }


  /* ── 3. CURSEUR ───────────────────────────────────────────── */
  function initCursor() {
    var dot = document.getElementById('cursor');
    var ring = document.getElementById('cursor-ring');
    if (dot)  dot.style.display  = 'none'; // on cache le dot — la traînée suffit
    if (ring) ring.style.display = 'none';

    var trailCanvas = document.createElement('canvas');
    trailCanvas.id = 'cursor-trail-canvas';
    trailCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:99997;';
    document.body.appendChild(trailCanvas);
    var ctx = trailCanvas.getContext('2d');

    var W = trailCanvas.width  = document.body.clientWidth;
    var H = trailCanvas.height = document.documentElement.clientHeight;
    window.addEventListener('resize', function () {
      W = trailCanvas.width  = document.body.clientWidth;
      H = trailCanvas.height = document.documentElement.clientHeight;
    });

    // Position réelle de la souris
    var mouseX = -200, mouseY = -200;

    // TRAIL : 20 points qui se rattrapent les uns les autres
    var TRAIL = 20;
    var pts = [];
    for (var i = 0; i < TRAIL; i++) pts.push({ x: -200, y: -200 });

    var trailAlpha = 0;
    var idleTimer  = null;

    document.addEventListener('mousemove', function (e) {
      // clientX/Y = position relative au viewport, sans scroll — correspond exactement au canvas fixed
      mouseX = e.clientX;
      mouseY = e.clientY;

      trailAlpha = 1;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(function () {
        var fade = setInterval(function () {
          trailAlpha = Math.max(0, trailAlpha - 0.07);
          if (trailAlpha === 0) clearInterval(fade);
        }, 30);
      }, 500);
    });

    (function loop() {
      requestAnimationFrame(loop);

      // Point 0 rattrape la souris très vite (0.9)
      pts[0].x += (mouseX - pts[0].x) * 0.9;
      pts[0].y += (mouseY - pts[0].y) * 0.9;

      // Chaque point suivant rattrape le précédent
      for (var i = 1; i < TRAIL; i++) {
        pts[i].x += (pts[i-1].x - pts[i].x) * 0.6;
        pts[i].y += (pts[i-1].y - pts[i].y) * 0.6;
      }

      ctx.clearRect(0, 0, W, H);
      if (trailAlpha <= 0) return;

      for (var j = 0; j < TRAIL; j++) {
        var ratio = (1 - j / TRAIL) * trailAlpha;
        var r     = ratio * 6;
        var a     = ratio * 0.6;
        if (r < 0.1) continue;

        var color;
        if (j < 6)       color = 'rgba(0,170,255,'  + a + ')';
        else if (j < 13) color = 'rgba(168,85,247,' + a + ')';
        else             color = 'rgba(126,223,74,'  + a + ')';

        ctx.beginPath();
        ctx.arc(pts[j].x, pts[j].y, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
    })();
  }


  /* ── 4. TILT 3D — penché vers curseur ────────────────────── */
  function initTilt() {
    document.querySelectorAll('.av-card, .svc-card').forEach(function (card) {
      // Désactive transition pendant mouvement pour tilt fluide
      card.addEventListener('mouseenter', function () {
        card.style.transition = 'none';
      });

      card.addEventListener('mousemove', function (e) {
        var rect = card.getBoundingClientRect();
        var x    = (e.clientX - rect.left) / rect.width  - 0.5;
        var y    = (e.clientY - rect.top)  / rect.height - 0.5;
        card.style.transform = 'perspective(600px) rotateX(' + (y * -18) + 'deg) rotateY(' + (x * 18) + 'deg) scale3d(1.03,1.03,1.03)';
        card.style.setProperty('--mx', ((e.clientX - rect.left) / rect.width  * 100) + '%');
        card.style.setProperty('--my', ((e.clientY - rect.top)  / rect.height * 100) + '%');

        var icon = card.querySelector('.av-icon, .svc-icon');
        if (icon) {
          icon.style.transition = 'none';
          icon.style.transform  = 'rotateX(' + (y * 5) + 'deg) rotateY(' + (x * 5) + 'deg) scale(1.08)';
        }
      });

      card.addEventListener('mouseleave', function () {
        card.style.transition = 'transform .6s cubic-bezier(.16,1,.3,1), border-color .3s, box-shadow .4s';
        card.style.transform  = 'perspective(600px) rotateX(0deg) rotateY(0deg) scale3d(1,1,1)';
        var icon = card.querySelector('.av-icon, .svc-icon');
        if (icon) {
          icon.style.transition = 'transform .6s cubic-bezier(.16,1,.3,1)';
          icon.style.transform  = '';
        }
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


  /* ── 7. COMPTEURS ANIMÉS ───────────────────────────────────── */
  function initCounters() {
    var items = document.querySelectorAll('.stat-item');
    if (!items.length) return;

    var configs = [];
    items.forEach(function (item) {
      var numEl = item.querySelector('.stat-num');
      if (!numEl) return;
      var text  = numEl.textContent.trim();
      var match = text.match(/^(\d+)(.*)/);
      if (!match) return;
      configs.push({ el: numEl, end: parseInt(match[1], 10), suffix: match[2], duration: 1400 });
      numEl.textContent = '0' + match[2];
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
    hint.style.cssText = 'position:absolute;bottom:32px;left:40px;transform:none;display:flex;flex-direction:column;align-items:flex-start;gap:6px;z-index:2;';
    hint.innerHTML = '<span style="font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);">Scroll</span><div class="scroll-hint-line"></div>';
    hero.appendChild(hint);
    window.addEventListener('scroll', function () {
      hint.style.opacity    = '0';
      hint.style.transition = 'opacity .5s';
    }, { once: true });
  }


  /* ── 9. PARALLAX HALO AU SCROLL ──────────────────────────── */
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
    initParallax();
    // Badge retiré — causait le bug près du chatbot
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
