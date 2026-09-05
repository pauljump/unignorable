// Human-triggered observations; analytics never send location or visitor identifiers.
(() => {
  const root = document.querySelector('[data-record-id]');
  if (!root) return;
  const id = root.dataset.recordId;
  const canonical = document.querySelector('link[rel="canonical"]').href;
  const sent = new Set();
  function metric(event) {
    if (sent.has(event)) return;
    sent.add(event);
    try {
      const key = `unig-record-event:${new Date().toISOString().slice(0, 10)}:${id}:${event}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch { /* Storage is optional; observation still works. */ }
    fetch('/api/record-events', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feature_id: id, event }), keepalive: true }).catch(() => {});
  }
  metric('record_view');
  try {
    const now = Date.now(), day = new Date(now).toISOString().slice(0, 10);
    const stored = JSON.parse(localStorage.getItem('unig-record-visits') || '{}');
    const visits = Object.fromEntries(Object.entries(stored).filter(([, v]) => v && Number(v.at) > now - 30 * 86400000).slice(-49));
    if (visits[id] && visits[id].day !== day) metric('record_return');
    visits[id] = { day, at: now };
    localStorage.setItem('unig-record-visits', JSON.stringify(visits));
  } catch { /* No persistent ID, and blocked storage is fine. */ }
  let visibleMs = 0, lastTick = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    if (!document.hidden) visibleMs += Math.min(1000, now - lastTick);
    lastTick = now;
    if (visibleMs >= 10000) { metric('record_engaged'); clearInterval(timer); }
  }, 1000);
  document.addEventListener('click', event => {
    const link = event.target.closest('[data-record-event]');
    if (link) metric(link.dataset.recordEvent);
  });
  document.getElementById('copy-record').addEventListener('click', async () => {
    const status = document.getElementById('copy-status');
    try { await navigator.clipboard.writeText(canonical); status.textContent = 'Link copied. Ask a neighbor for a fresh check.'; metric('record_copy'); }
    catch { status.textContent = `Copy this link: ${canonical}`; }
  });
  const buttons = [...document.querySelectorAll('[data-check-state]')];
  const status = document.getElementById('check-status');
  const enable = () => buttons.forEach(button => { button.disabled = false; });
  buttons.forEach(button => button.addEventListener('click', () => {
    metric('check_start');
    if (!navigator.geolocation) { status.textContent = 'Location is unavailable. Nothing was submitted. You can share the link with someone nearby.'; return; }
    buttons.forEach(item => { item.disabled = true; });
    status.textContent = 'Checking your proximity…';
    navigator.geolocation.getCurrentPosition(async position => {
      try {
        const response = await fetch('/api/condition-observations', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feature_id: id, state: button.dataset.checkState, lat: position.coords.latitude, lng: position.coords.longitude }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Could not save the observation.');
        status.textContent = payload.duplicate ? 'A check from this connection is already recorded today. No extra check was added.'
          : 'Saved for review. This does not change the estimate or establish resolution. Return after review to see the updated counts.';
      } catch (error) { status.textContent = error.message || 'Could not save. Please try again.'; }
      finally { enable(); }
    }, () => { status.textContent = 'Location was unavailable or permission was declined. Nothing was submitted. You can retry or share this record with someone nearby.'; enable(); },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  }));
})();
