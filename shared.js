// ═══ LumeLine Shared Page Shell ═══
// Injects header nav + canonical footer into any page that includes this script

function injectShell() {
  // Header
  const nav = document.createElement('nav');
  nav.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:50;background:rgba(3,7,18,.85);backdrop-filter:blur(16px);border-bottom:1px solid rgba(255,255,255,.04);padding:12px 0';
  nav.innerHTML = `<div style="max-width:1360px;margin:0 auto;padding:0 24px;display:flex;align-items:center;justify-content:space-between">
    <a href="/" style="text-decoration:none;display:flex;align-items:center;gap:10px">
      <span style="font-size:18px;font-weight:900;background:linear-gradient(135deg,#f0f9ff,#67e8f9,#f0f9ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">LumeLine</span>
      <span style="font-size:9px;color:rgba(6,182,212,.4);border:1px solid rgba(6,182,212,.15);border-radius:999px;padding:2px 8px;font-weight:600;text-transform:uppercase;letter-spacing:.08em">Beta</span>
    </a>
    <div style="display:flex;align-items:center;gap:20px">
      <a href="/" style="font-size:12px;color:rgba(255,255,255,.35);text-decoration:none;font-weight:500;transition:color .2s" onmouseover="this.style.color='#67e8f9'" onmouseout="this.style.color='rgba(255,255,255,.35)'">Dashboard</a>
      <a href="/roadmap.html" style="font-size:12px;color:rgba(255,255,255,.35);text-decoration:none;font-weight:500;transition:color .2s" onmouseover="this.style.color='#67e8f9'" onmouseout="this.style.color='rgba(255,255,255,.35)'">Roadmap</a>
      <a href="/developers.html" style="font-size:12px;color:rgba(255,255,255,.35);text-decoration:none;font-weight:500;transition:color .2s" onmouseover="this.style.color='#67e8f9'" onmouseout="this.style.color='rgba(255,255,255,.35)'">Developers</a>
      <a href="/login.html" style="font-size:12px;color:#67e8f9;text-decoration:none;font-weight:700;padding:6px 16px;border-radius:10px;border:1px solid rgba(6,182,212,.2);background:rgba(6,182,212,.06);transition:all .2s" onmouseover="this.style.background='rgba(6,182,212,.12)'" onmouseout="this.style.background='rgba(6,182,212,.06)'">Sign In</a>
    </div>
  </div>`;
  document.body.prepend(nav);
  document.body.style.paddingTop = '56px';

  // Footer
  const footer = document.createElement('footer');
  footer.style.cssText = 'border-top:1px solid rgba(255,255,255,.05);padding:40px 24px 32px;max-width:1360px;margin:60px auto 0';
  footer.innerHTML = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:32px;margin-bottom:32px">
    <div>
      <div style="font-size:18px;font-weight:900;margin-bottom:8px;background:linear-gradient(135deg,#f0f9ff,#67e8f9,#f0f9ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">LumeLine</div>
      <p style="font-size:11px;color:rgba(255,255,255,.2);line-height:1.7;margin-bottom:16px">Odds intelligence platform. Built 100% with Lume. Part of the Trust Layer ecosystem.</p>
      <div style="display:flex;gap:8px">
        <a href="https://x.com/TrustSignal26" target="_blank" rel="noopener" style="width:32px;height:32px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.3);text-decoration:none;font-size:12px">𝕏</a>
        <a href="https://www.facebook.com/profile.php?id=61587475987575" target="_blank" rel="noopener" style="width:32px;height:32px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.3);text-decoration:none;font-size:12px">f</a>
      </div>
    </div>
    <div>
      <div style="font-size:10px;font-weight:700;color:rgba(255,255,255,.25);text-transform:uppercase;letter-spacing:.12em;margin-bottom:12px">Product</div>
      <a href="/" class="fl">Dashboard</a>
      <a href="/login.html" class="fl">Login / Sign Up</a>
      <a href="/dashboard.html" class="fl">My Dashboard</a>
      <a href="/roadmap.html" class="fl">Roadmap</a>
      <a href="/developers.html" class="fl">🔧 Developers</a>
    </div>
    <div>
      <div style="font-size:10px;font-weight:700;color:rgba(255,255,255,.25);text-transform:uppercase;letter-spacing:.12em;margin-bottom:12px">Company</div>
      <a href="/executive-summary.html" class="fl">Executive Summary</a>
      <a href="https://darkwavestudios.io" target="_blank" class="fl">DarkWave Studios</a>
      <a href="https://dwtl.io" target="_blank" class="fl">Trust Layer</a>
      <a href="https://lume-lang.org" target="_blank" class="fl">Built with Lume</a>
    </div>
    <div>
      <div style="font-size:10px;font-weight:700;color:rgba(255,255,255,.25);text-transform:uppercase;letter-spacing:.12em;margin-bottom:12px">Legal</div>
      <a href="/terms.html" class="fl">Terms of Service</a>
      <a href="/privacy.html" class="fl">Privacy Policy</a>
      <a href="/disclaimer.html" class="fl">Disclaimer</a>
      <a href="/responsible-gaming.html" class="fl">Responsible Gaming</a>
    </div>
  </div>
  <div style="border-top:1px solid rgba(255,255,255,.04);padding-top:20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
    <div style="font-size:10px;color:rgba(255,255,255,.15)">&copy; 2026 DarkWave Studios, LLC · All rights reserved</div>
    <div style="display:flex;align-items:center;gap:12px">
      <a href="https://dwtl.io" target="_blank" style="font-size:9px;color:rgba(6,182,212,.3);text-decoration:none">🛡️ Trust Layer</a>
      <a href="https://lume-lang.org" target="_blank" style="font-size:9px;color:rgba(168,85,247,.3);text-decoration:none">◆ Lume</a>
      <span style="font-size:9px;color:rgba(255,255,255,.1);font-family:monospace">v0.1.0</span>
    </div>
  </div>`;
  document.body.appendChild(footer);

  // Inject footer link styles
  const s = document.createElement('style');
  s.textContent = `.fl{display:block;font-size:12px;color:rgba(255,255,255,.35);text-decoration:none;margin-bottom:8px;transition:color .2s}.fl:hover{color:#67e8f9}`;
  document.head.appendChild(s);
}

document.addEventListener('DOMContentLoaded', injectShell);
