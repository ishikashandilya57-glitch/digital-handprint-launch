(() => {
  'use strict';
  const socket = io();
  const screens = ['role-screen', 'guest-screen', 'display-screen', 'opening-screen', 'final-black-screen', 'countdown-screen', 'reveal-screen'];
  const els = Object.fromEntries(screens.map(id => [id, document.getElementById(id)]));
  const scanner = document.getElementById('scanner');
  const guestScreen = document.getElementById('guest-screen');
  const ring = document.getElementById('progress-ring');
  const introVideo = document.getElementById('inauguration-video');
  const openCurtainButton = document.getElementById('open-curtain');
  const emergencyStart = document.getElementById('emergency-start');
  const displayEmergencyStart = document.getElementById('display-emergency-start');
  const circumference = 2 * Math.PI * 140;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const videoAssets = {
    opening: '/assets/inauguration-intro.mp4?v=download-1',
    final: '/assets/final-inauguration.mp4?v=show-final-1'
  };
  const cachedVideoUrls = {};
  const videoPreloadSettled = { opening: false, final: false };
  let role = sessionStorage.getItem('ceremonyRole');
  let state = null;
  let clockOffset = 0;
  let phaseTimer = 0;
  let curtainTimer = 0;
  let revealed = false;
  let ceremonyStage = 'loading';
  let currentVideoRun = null;
  let videoPurpose = null;
  let lastProgressSent = -1;
  const guestProgress = { '1': 0, '2': 0, '3': 0, '4': 0 };
  const guestNames = { '1': 'Nick Keyte', '2': 'Guillaume Dalais', '3': 'Eric Dorchies', '4': 'Maneesh Patel' };
  const activePointers = new Set();
  let touchActive = false;
  let lastTouchEventAt = 0;
  let lastNonTouchUpAt = 0;
  let releaseTimer = 0;

  function preloadVideo(key) {
    return fetch(videoAssets[key], { cache: 'force-cache' })
      .then(response => {
        if (!response.ok) throw new Error(`Video preload failed: ${response.status}`);
        return response.blob();
      })
      .then(blob => { cachedVideoUrls[key] = URL.createObjectURL(blob); })
      .catch(error => console.warn(`${key} video will use streaming fallback.`, error))
      .finally(() => {
        videoPreloadSettled[key] = true;
        if (key === 'opening' && ceremonyStage === 'opening') {
          openCurtainButton.disabled = false;
          openCurtainButton.textContent = 'Click to begin';
        }
      });
  }
  const videoPreloads = {
    opening: preloadVideo('opening'),
    final: preloadVideo('final')
  };

  const hold = new HoldController({
    duration: 750,
    onProgress(progress) {
      ring.style.strokeDashoffset = String(circumference * (1 - progress));
      document.getElementById('scan-copy').textContent = progress ? `Scanning ${Math.round(progress * 100)}%` : 'Hold to scan';
      if (role?.startsWith('guest-') && (progress === 0 || progress === 1 || Math.abs(progress - lastProgressSent) >= .04)) {
        lastProgressSent = progress;
        socket.emit('hand:progress', { slot: role.slice(-1), progress });
      }
    },
    onComplete() {
      touchActive = false;
      activePointers.clear();
      scanner.classList.remove('holding');
      scanner.classList.add('ready');
      document.getElementById('scan-copy').textContent = 'Handprint verified';
      scanner.setAttribute('aria-disabled', 'true');
      socket.emit('hand:ready', { slot: role.slice(-1) });
    }
  });

  function show(id) { screens.forEach(name => els[name].classList.toggle('hidden', name !== id)); }
  function registerRole() { if (role && socket.connected) socket.emit('role:register', role); }
  function chooseRole(next) {
    role = next;
    sessionStorage.setItem('ceremonyRole', role);
    registerRole();
    renderBase();
    if (state) renderState();
    if (role === 'display' && (!state || state.phase === 'waiting')) startOpeningSequence();
  }
  function clearRole() {
    sessionStorage.removeItem('ceremonyRole');
    sessionStorage.removeItem('ceremonyVideoState');
    role = null;
    ceremonyStage = 'loading';
    currentVideoRun = null;
    introVideo.pause();
    introVideo.currentTime = 0;
    introVideo.muted = false;
    els['opening-screen'].classList.remove('curtain-opening', 'video-playing', 'final-video');
    clearTimeout(phaseTimer);
    clearTimeout(curtainTimer);
    clearTimeout(releaseTimer);
    activePointers.clear();
    touchActive = false;
    hold.reset();
    show('role-screen');
  }
  function renderBase() {
    if (!role) return show('role-screen');
    if (role === 'display') {
      show('display-screen');
      renderGuestCards();
    } else {
      show('guest-screen');
      const slot = role.slice(-1);
      document.getElementById('guest-label').textContent = `Guest ${slot} · ${guestNames[slot]}`;
    }
  }
  function handSvg() {
    return `<div class="hand-hud"><img class="tiny-hand" src="/activation-hand.png" alt="" draggable="false"></div>`;
  }
  function renderGuestCards() {
    if (!state) return;
    document.getElementById('guest-cards').innerHTML = ['1','2','3','4'].map(slot => {
      const ready = state.ready[slot], connected = state.connected[slot];
      let copy = ready ? 'Handprint verified' : 'Waiting for handprint';
      const progress = ready ? 1 : (state.progress?.[slot] ?? guestProgress[slot]);
      return `<article class="guest-card ${ready ? 'ready' : ''} ${progress > 0 ? 'scanning' : ''} ${connected ? '' : 'offline'}" data-slot="${slot}"><b class="guest-number">0${slot}</b><div class="hand-hud" style="--scan-progress:${progress * 360}deg"><span class="particle-field"></span><span class="biometric-sweep"></span><img class="tiny-hand" src="/activation-hand.png" alt="" draggable="false"></div><h3>${guestNames[slot]}</h3><p><i></i>${progress > 0 && !ready ? `Biometric scan ${Math.round(progress * 100)}%` : copy}</p></article>`;
    }).join('');
  }
  function renderState() {
    if (!role || !state) return;
    if (state.progress) Object.keys(guestProgress).forEach(slot => { guestProgress[slot] = state.progress[slot] || 0; });
    if (state.phase === 'countdown') return runTimeline();
    if (state.phase === 'reveal') return showFinalBlack();
    if (role === 'display' && ['opening', 'introVideo'].includes(ceremonyStage)) return;
    renderBase();
    const count = Object.values(state.ready).filter(Boolean).length;
    if (role === 'display') {
      if (displayEmergencyStart) displayEmergencyStart.disabled = state.phase !== 'waiting';
      els['display-screen'].classList.remove('launch-ready');
      document.getElementById('display-heading').innerHTML = 'Awaiting <em>inauguration</em>';
      document.getElementById('display-subtitle').textContent = '';
      renderGuestCards();
      document.getElementById('display-count').textContent = count === 4 ? 'All handprints verified' : count === 0 ? 'Waiting for all 4 handprints' : `Waiting for ${4 - count} more handprint${4 - count === 1 ? '' : 's'}`;
      document.getElementById('display-ratio').textContent = `${count} / 4`;
      document.querySelectorAll('.verify-step').forEach(step => step.classList.toggle('verified', state.ready[step.dataset.step]));
      const lines = document.querySelectorAll('.verification-track>b');
      lines[0]?.classList.toggle('verified', state.ready['1']);
      lines[1]?.classList.toggle('verified', state.ready['1'] && state.ready['2']);
      lines[2]?.classList.toggle('verified', state.ready['1'] && state.ready['2'] && state.ready['3']);
    } else {
      const ownReady = state.ready[role.slice(-1)];
      if (ownReady) {
        hold.completed = true;
        scanner.classList.add('ready');
        ring.style.strokeDashoffset = '0';
        document.getElementById('scan-copy').textContent = 'Handprint verified';
      }
      document.getElementById('ready-count').textContent = `${count} / 4`;
      document.getElementById('mini-progress-value').style.width = `${count / 4 * 100}%`;
      document.getElementById('status-title').textContent = ownReady ? 'Handprint locked' : 'Awaiting handprint';
      document.getElementById('status-copy').textContent = `Waiting for others: ${count} of 4 ready`;
      if (emergencyStart) emergencyStart.disabled = ownReady;
    }
  }
  function serverTime() { return Date.now() + clockOffset; }
  function getSavedVideoState() {
    try { return JSON.parse(sessionStorage.getItem('ceremonyVideoState') || 'null'); }
    catch { return null; }
  }
  function saveVideoState(stage, runId, startedAt) {
    sessionStorage.setItem('ceremonyVideoState', JSON.stringify({ stage, runId, startedAt }));
  }
  function showMainDisplay() {
    ceremonyStage = 'display';
    introVideo.pause();
    els['opening-screen'].classList.remove('curtain-opening', 'video-playing');
    show('display-screen');
    if (state) renderState();
  }
  function startOpeningSequence() {
    if (ceremonyStage === 'opening') return;

    ceremonyStage = 'opening';
    show('opening-screen');
    els['opening-screen'].classList.remove('curtain-opening', 'final-video');
    clearTimeout(phaseTimer);
    clearTimeout(curtainTimer);
    openCurtainButton.disabled = !videoPreloadSettled.opening;
    openCurtainButton.textContent = videoPreloadSettled.opening ? 'Click to begin' : 'Loading video…';
  }
  function openCurtain() {
    if (ceremonyStage !== 'opening' || els['opening-screen'].classList.contains('curtain-opening')) return;
    openCurtainButton.disabled = true;
    els['opening-screen'].classList.add('curtain-opening');
    playOpeningVideo();
  }
  function setVideoSource(src) {
    const source = introVideo.querySelector('source');
    if (source.getAttribute('src') === src) return;
    source.setAttribute('src', src);
    introVideo.load();
  }
  function playOpeningVideo() {
    videoPurpose = 'opening';
    ceremonyStage = 'introVideo';
    setVideoSource(cachedVideoUrls.opening || videoAssets.opening);
    show('opening-screen');
    els['opening-screen'].classList.add('video-playing');
    introVideo.currentTime = 0;
    introVideo.muted = false;
    const attempt = introVideo.play();
    if (attempt?.catch) attempt.catch(() => {
      introVideo.muted = true;
      introVideo.play().catch(showMainDisplay);
    });
  }
  function showFinalBlack(persist = true) {
    ceremonyStage = 'finalBlack';
    introVideo.pause();
    els['opening-screen'].classList.remove('curtain-opening', 'video-playing', 'final-video');
    show('final-black-screen');
    if (persist && currentVideoRun) saveVideoState('ended', currentVideoRun, null);
  }
  function startIntroVideo() {
    const runId = String(state?.countdownAt || state?.revealAt || 'current-launch');
    const saved = getSavedVideoState();
    currentVideoRun = runId;
    if (saved?.runId === runId && saved.stage === 'ended') return showFinalBlack(false);
    if (ceremonyStage === 'introVideo' && !introVideo.paused) return;

    videoPurpose = 'final';
    ceremonyStage = 'introVideo';
    setVideoSource(cachedVideoUrls.final || videoAssets.final);
    show('opening-screen');
    els['opening-screen'].classList.remove('curtain-opening');
    els['opening-screen'].classList.add('video-playing', 'final-video');
    introVideo.controls = false;
    introVideo.loop = false;
    introVideo.muted = false;

    const startedAt = saved?.runId === runId && saved.stage === 'playing' && saved.startedAt ? saved.startedAt : Date.now();
    saveVideoState('playing', runId, startedAt);

    const beginPlayback = async () => {
      if (ceremonyStage !== 'introVideo' || currentVideoRun !== runId) return;
      const elapsed = Math.max(0, (Date.now() - startedAt) / 1000);
      if (Number.isFinite(introVideo.duration) && elapsed >= introVideo.duration) return showFinalBlack();
      if (elapsed > .25 && Number.isFinite(introVideo.duration)) introVideo.currentTime = Math.min(elapsed, Math.max(0, introVideo.duration - .15));
      try {
        await introVideo.play();
        els['opening-screen'].classList.add('video-playing');
      } catch (audioError) {
        console.error('Inauguration video autoplay with audio was blocked; retrying muted.', audioError);
        introVideo.muted = true;
        try {
          await introVideo.play();
          els['opening-screen'].classList.add('video-playing');
        } catch (videoError) {
          console.error('Inauguration video could not be played.', videoError);
          showFinalBlack();
        }
      }
    };

    if (introVideo.readyState >= 1) beginPlayback();
    else introVideo.addEventListener('loadedmetadata', beginPlayback, { once: true });
  }
  function runTimeline() {
    clearTimeout(phaseTimer);
    if (role === 'display') startIntroVideo();
    else showFinalBlack(false);
  }
  function showReveal() {
    clearTimeout(phaseTimer);
    show('reveal-screen');
    if (revealed) return;
    revealed = true;
    document.querySelectorAll('[data-stat]').forEach(el => {
      const target = Number(el.dataset.stat), suffix = el.dataset.suffix || '';
      if (reduceMotion) { el.textContent = target + suffix; return; }
      const start = performance.now();
      const tick = now => {
        const p = Math.min((now - start) / 1500, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(target * eased) + suffix;
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }
  function resetClient(nextState) {
    clearTimeout(phaseTimer);
    clearTimeout(curtainTimer);
    clearTimeout(releaseTimer);
    state = nextState;
    revealed = false;
    activePointers.clear();
    touchActive = false;
    Object.keys(guestProgress).forEach(slot => { guestProgress[slot] = 0; });
    lastProgressSent = -1;
    ceremonyStage = 'loading';
    currentVideoRun = null;
    introVideo.pause();
    introVideo.currentTime = 0;
    introVideo.muted = false;
    els['opening-screen'].classList.remove('curtain-opening', 'video-playing', 'final-video');
    sessionStorage.removeItem('ceremonyVideoState');
    hold.reset();
    scanner.classList.remove('ready', 'holding');
    scanner.removeAttribute('aria-disabled');
    if (emergencyStart) emergencyStart.disabled = false;
    if (displayEmergencyStart) displayEmergencyStart.disabled = false;
    ring.style.strokeDashoffset = String(circumference);
    renderBase();
    renderState();
    if (role === 'display' && state?.phase === 'waiting') startOpeningSequence();
  }

  document.querySelectorAll('[data-role]').forEach(btn => btn.addEventListener('click', () => chooseRole(btn.dataset.role)));
  document.querySelectorAll('[data-change-role]').forEach(btn => btn.addEventListener('click', clearRole));
  openCurtainButton.addEventListener('click', openCurtain);
  emergencyStart?.addEventListener('click', event => {
    event.preventDefault();
    if (hold.completed) return;
    emergencyStart.disabled = true;
    beginHandHold();
  });
  displayEmergencyStart?.addEventListener('click', event => {
    event.preventDefault();
    if (role === 'display' && state?.phase === 'waiting') {
      displayEmergencyStart.disabled = true;
      socket.emit('admin:emergency-start');
    }
  });
  function beginHandHold() {
    if (hold.completed || !role?.startsWith('guest-')) return;
    clearTimeout(releaseTimer);
    scanner.classList.add('holding');
    document.getElementById('scan-copy').textContent = 'Scanning 0%';
    document.getElementById('status-title').textContent = 'Scanning handprint';
    document.getElementById('status-copy').textContent = 'Keep your palm on the scanner';
    hold.start();
    socket.emit('hand:hold-start', { slot: role.slice(-1) });
  }
  function stopHandHold() {
    if (hold.completed || !role?.startsWith('guest-')) return;
    clearTimeout(releaseTimer);
    // Tablets can emit a synthetic pointer/touch cancel while a palm is
    // settling. Debounce the release so those transient events do not reset
    // an otherwise valid hold.
    releaseTimer = setTimeout(() => {
      releaseTimer = 0;
      if (hold.completed) return;
      scanner.classList.remove('holding');
      hold.stop();
      socket.emit('hand:hold-stop', { slot: role.slice(-1) });
    }, 180);
  }
  scanner.addEventListener('pointerdown', event => {
    if (hold.completed || event.pointerType === 'touch') return;
    event.preventDefault();
    activePointers.add(event.pointerId);
    scanner.setPointerCapture(event.pointerId);
    beginHandHold();
  });
  ['pointerup','pointercancel','lostpointercapture'].forEach(type => scanner.addEventListener(type, event => {
    if (event.pointerType === 'touch') return;
    activePointers.delete(event.pointerId);
    if (activePointers.size === 0 && !touchActive) {
      lastNonTouchUpAt = Date.now();
      stopHandHold();
    }
  }));
  scanner.addEventListener('touchstart', event => {
    if (hold.completed) return;
    event.preventDefault();
    lastTouchEventAt = Date.now();
    if (touchActive) return;
    touchActive = true;
    beginHandHold();
  }, { passive: false });
  scanner.addEventListener('touchend', event => {
    event.preventDefault();
    if (event.touches.length > 0) return;
    lastTouchEventAt = Date.now();
    touchActive = false;
    activePointers.clear();
    // Once a tablet has registered the palm, let the short scan finish. Some
    // touchscreens report an early touchend/cancel while a full palm settles.
  }, { passive: false });
  scanner.addEventListener('touchcancel', () => {
    lastTouchEventAt = Date.now();
    touchActive = false;
    activePointers.clear();
  }, { passive: false });
  guestScreen.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch' || hold.completed || event.target.closest('button:not(#scanner)')) return;
    event.preventDefault();
    touchActive = true;
    beginHandHold();
  }, { capture: true, passive: false });
  guestScreen.addEventListener('pointerup', event => {
    if (event.pointerType !== 'touch') return;
    if (activePointers.size === 0 && !touchActive) stopHandHold();
  }, { capture: true, passive: false });
  guestScreen.addEventListener('touchstart', event => {
    if (hold.completed || event.target.closest('button:not(#scanner)')) return;
    event.preventDefault();
    if (!touchActive) { touchActive = true; beginHandHold(); }
  }, { capture: true, passive: false });
  guestScreen.addEventListener('touchend', event => {
    if (event.touches.length === 0) {
      touchActive = false;
    }
  }, { capture: true, passive: false });
  scanner.addEventListener('click', () => {
    if (hold.completed || !role?.startsWith('guest-')) return;
    const now = Date.now();
    if (now - lastTouchEventAt < 500 || now - lastNonTouchUpAt < 500) return;
    beginHandHold();
  });
  window.addEventListener('keydown', event => {
    const isResetShortcut = (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'r';
    if (role === 'display' && isResetShortcut) {
      event.preventDefault();
      socket.emit('admin:reset');
    }
  });
  socket.on('connect', () => { registerRole(); document.getElementById('connection-copy').textContent = 'Scanner online'; });
  socket.on('disconnect', () => { document.getElementById('connection-copy').textContent = 'Reconnecting…'; });
  socket.on('ceremony:state', next => { state = next; clockOffset = next.serverNow - Date.now(); renderState(); });
  socket.on('launch:countdown', next => { state = next; clockOffset = next.serverNow - Date.now(); runTimeline(); });
  socket.on('hand:progress', ({ slot, progress }) => {
    guestProgress[String(slot)] = Math.max(0, Math.min(1, Number(progress) || 0));
    if (role === 'display' && state?.phase === 'waiting') renderGuestCards();
  });
  socket.on('hand:ready', ({ slot } = {}) => {
    const normalizedSlot = String(slot);
    if (!state?.ready || !Object.prototype.hasOwnProperty.call(state.ready, normalizedSlot)) return;
    state.ready[normalizedSlot] = true;
    state.progress[normalizedSlot] = 1;
    if (role === 'display') renderState();
  });
  socket.on('ceremony:reset', resetClient);
  introVideo.addEventListener('ended', () => {
    if (videoPurpose === 'opening') showMainDisplay();
    else showFinalBlack();
  });
  introVideo.addEventListener('error', () => {
    if (ceremonyStage !== 'introVideo') return;
    console.error('Inauguration video failed to load or decode.', introVideo.error);
    if (videoPurpose === 'opening') showMainDisplay();
    else showFinalBlack();
  });
  ring.style.strokeDasharray = String(circumference);
  ring.style.strokeDashoffset = String(circumference);
  renderBase();
  if (role === 'display') startOpeningSequence();
})();
