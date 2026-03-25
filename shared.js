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
    <div class="nav-links" style="display:flex;align-items:center;gap:20px">
      <a href="/" style="font-size:12px;color:rgba(255,255,255,.35);text-decoration:none;font-weight:500;transition:color .2s" onmouseover="this.style.color='#67e8f9'" onmouseout="this.style.color='rgba(255,255,255,.35)'">Dashboard</a>
      <a href="/bets.html" style="font-size:12px;color:rgba(255,255,255,.35);text-decoration:none;font-weight:500;transition:color .2s" onmouseover="this.style.color='#67e8f9'" onmouseout="this.style.color='rgba(255,255,255,.35)'">My Bets</a>
      <a href="/blog.html" style="font-size:12px;color:rgba(255,255,255,.35);text-decoration:none;font-weight:500;transition:color .2s" onmouseover="this.style.color='#67e8f9'" onmouseout="this.style.color='rgba(255,255,255,.35)'">Blog</a>
      <a href="/roadmap.html" style="font-size:12px;color:rgba(255,255,255,.35);text-decoration:none;font-weight:500;transition:color .2s" onmouseover="this.style.color='#67e8f9'" onmouseout="this.style.color='rgba(255,255,255,.35)'">Roadmap</a>
      <a href="/developers.html" style="font-size:12px;color:rgba(255,255,255,.35);text-decoration:none;font-weight:500;transition:color .2s" onmouseover="this.style.color='#67e8f9'" onmouseout="this.style.color='rgba(255,255,255,.35)'">Developers</a>
      <a href="/login.html" style="font-size:12px;color:#67e8f9;text-decoration:none;font-weight:700;padding:6px 16px;border-radius:10px;border:1px solid rgba(6,182,212,.2);background:rgba(6,182,212,.06);transition:all .2s" onmouseover="this.style.background='rgba(6,182,212,.12)'" onmouseout="this.style.background='rgba(6,182,212,.06)'">Sign In</a>
    </div>
    <button class="nav-burger" onclick="document.querySelector('.nav-mobile').classList.toggle('open')" style="display:none;background:none;border:none;color:#67e8f9;font-size:22px;cursor:pointer;padding:4px 8px">☰</button>
  </div>
  <div class="nav-mobile" style="display:none;padding:12px 24px;border-top:1px solid rgba(255,255,255,.04)">
    <a href="/" style="display:block;font-size:14px;color:rgba(255,255,255,.4);text-decoration:none;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.03)">Dashboard</a>
    <a href="/bets.html" style="display:block;font-size:14px;color:rgba(255,255,255,.4);text-decoration:none;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.03)">💰 My Bets</a>
    <a href="/blog.html" style="display:block;font-size:14px;color:rgba(255,255,255,.4);text-decoration:none;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.03)">Blog</a>
    <a href="/roadmap.html" style="display:block;font-size:14px;color:rgba(255,255,255,.4);text-decoration:none;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.03)">Roadmap</a>
    <a href="/developers.html" style="display:block;font-size:14px;color:rgba(255,255,255,.4);text-decoration:none;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.03)">Developers</a>
    <a href="/executive-summary.html" style="display:block;font-size:14px;color:rgba(255,255,255,.4);text-decoration:none;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.03)">Executive Summary</a>
    <a href="/login.html" style="display:block;font-size:14px;color:#67e8f9;text-decoration:none;padding:10px 0;font-weight:700">Sign In →</a>
  </div>`;
  document.body.prepend(nav);
  document.body.style.paddingTop = '56px';

  // Footer
  const footer = document.createElement('footer');
  footer.style.cssText = 'border-top:1px solid rgba(255,255,255,.05);padding:40px 24px 32px;max-width:1360px;margin:60px auto 0';
  footer.innerHTML = `<div class="footer-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:32px;margin-bottom:32px">
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
  <div class="footer-bottom" style="border-top:1px solid rgba(255,255,255,.04);padding-top:20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
    <div style="font-size:10px;color:rgba(255,255,255,.15)">&copy; 2026 DarkWave Studios, LLC · All rights reserved</div>
    <div style="display:flex;align-items:center;gap:12px">
      <a href="https://dwtl.io" target="_blank" style="font-size:9px;color:rgba(6,182,212,.3);text-decoration:none;cursor:pointer">🛡️ Trust Layer</a>
      <a href="https://lume-lang.org" target="_blank" style="font-size:9px;color:rgba(168,85,247,.3);text-decoration:none">◆ Lume</a>
      <span style="font-size:9px;color:rgba(255,255,255,.1);font-family:monospace">v0.1.0</span>
      <div class="tl-admin-trigger" title="DarkWave Studios" style="width:28px;height:28px;border-radius:8px;background:rgba(6,182,212,.04);border:1px solid rgba(6,182,212,.08);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .3s;user-select:none" onmouseover="this.style.borderColor='rgba(6,182,212,.25)';this.style.boxShadow='0 0 12px rgba(6,182,212,.1)'" onmouseout="this.style.borderColor='rgba(6,182,212,.08)';this.style.boxShadow='none'">
        <span style="font-size:14px;filter:drop-shadow(0 0 4px rgba(6,182,212,.3))">🛡️</span>
      </div>
    </div>
  </div>`;
  document.body.appendChild(footer);

  // Inject styles
  const s = document.createElement('style');
  s.textContent = `
    .fl{display:block;font-size:12px;color:rgba(255,255,255,.35);text-decoration:none;margin-bottom:8px;transition:color .2s}
    .fl:hover{color:#67e8f9}
    .nav-mobile.open{display:block!important}
    @media(max-width:768px){
      .nav-links{display:none!important}
      .nav-burger{display:block!important}
      .footer-grid{grid-template-columns:1fr 1fr!important;gap:24px!important}
      .footer-bottom{flex-direction:column;align-items:center;text-align:center}
    }
    @media(max-width:480px){
      .footer-grid{grid-template-columns:1fr!important}
    }
  `;
  document.head.appendChild(s);

  // Inject PIN gate modal
  const pinMod = document.createElement('div');
  pinMod.id = 'pin-modal-shell';
  pinMod.style.cssText = 'display:none;position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.85);backdrop-filter:blur(12px);align-items:center;justify-content:center';
  pinMod.innerHTML = `<div style="background:#0c1224;border:1px solid rgba(6,182,212,.15);border-radius:20px;max-width:380px;width:90%;padding:40px 32px;position:relative;text-align:center;box-shadow:0 0 80px rgba(6,182,212,.08)">
    <button class="pin-close" style="position:absolute;top:12px;right:16px;background:none;border:none;color:rgba(255,255,255,.3);font-size:24px;cursor:pointer">&times;</button>
    <div style="width:64px;height:64px;border-radius:18px;background:linear-gradient(135deg,rgba(6,182,212,.15),rgba(59,130,246,.1));border:2px solid rgba(6,182,212,.2);display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 20px;box-shadow:0 0 40px rgba(6,182,212,.1)">🛡️</div>
    <h3 style="font-size:18px;font-weight:800;margin-bottom:6px;background:linear-gradient(135deg,#f0f9ff,#67e8f9,#f0f9ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">Developer Portal</h3>
    <p style="font-size:12px;color:rgba(255,255,255,.3);margin-bottom:24px;line-height:1.6">Enter your developer PIN to access the admin console.</p>
    <div class="pin-dots-shell" style="display:flex;gap:8px;justify-content:center;margin-bottom:20px">
      <div class="pds" style="width:44px;height:52px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:#67e8f9"></div>
      <div class="pds" style="width:44px;height:52px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:#67e8f9"></div>
      <div class="pds" style="width:44px;height:52px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:#67e8f9"></div>
      <div class="pds" style="width:44px;height:52px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:#67e8f9"></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;max-width:200px;margin:0 auto" class="pin-pad-shell"></div>
    <p class="pin-error-shell" style="display:none;color:#fca5a5;font-size:11px;margin-top:12px">❌ Incorrect PIN. Try again.</p>
    <p style="font-size:9px;color:rgba(255,255,255,.1);margin-top:16px">Authorized personnel only · Trust Layer Security</p>
  </div>`;
  document.body.appendChild(pinMod);

  // Inject PIN pad buttons
  const pkStyle = 'width:56px;height:44px;border-radius:12px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);color:#fff;font-size:16px;font-weight:700;cursor:pointer;font-family:inherit;transition:all .2s';
  const pad = pinMod.querySelector('.pin-pad-shell');
  [1,2,3,4,5,6,7,8,9,'CLR',0,'→'].forEach(k => {
    const b = document.createElement('button');
    b.style.cssText = pkStyle;
    b.textContent = k;
    if(k==='CLR') b.style.fontSize='10px';
    if(k==='→'){b.style.background='rgba(6,182,212,.1)';b.style.borderColor='rgba(6,182,212,.2)';b.style.color='#67e8f9';}
    b.addEventListener('click', () => {
      if(k==='CLR'){shellPin='';updShellDots();pinMod.querySelector('.pin-error-shell').style.display='none';}
      else if(k==='→'){checkShellPin();}
      else{if(shellPin.length<4){shellPin+=k;updShellDots();if(shellPin.length===4)setTimeout(checkShellPin,200);}}
    });
    pad.appendChild(b);
  });

  let shellPin = '';
  function updShellDots(){pinMod.querySelectorAll('.pds').forEach((d,i)=>{d.textContent=i<shellPin.length?'●':'';d.style.borderColor=i<shellPin.length?'rgba(6,182,212,.3)':'rgba(255,255,255,.1)';d.style.background=i<shellPin.length?'rgba(6,182,212,.06)':'rgba(255,255,255,.03)';});}
  function checkShellPin(){
    if(shellPin==='0424'){pinMod.style.display='none';shellPin='';updShellDots();window.location.href='/admin.html#admin';}
    else{pinMod.querySelector('.pin-error-shell').style.display='';pinMod.querySelectorAll('.pds').forEach(d=>{d.style.borderColor='rgba(239,68,68,.4)';d.style.background='rgba(239,68,68,.06)';});
    setTimeout(()=>{shellPin='';updShellDots();},600);}
  }
  pinMod.querySelector('.pin-close').addEventListener('click',()=>{pinMod.style.display='none';shellPin='';updShellDots();});
  pinMod.addEventListener('click',e=>{if(e.target===pinMod){pinMod.style.display='none';shellPin='';updShellDots();}});
  // Add partner login link below PIN pad
  const partnerLink = document.createElement('a');
  partnerLink.href = '/admin.html';
  partnerLink.textContent = '🤝 Partner Login';
  partnerLink.style.cssText = 'display:block;text-align:center;font-size:10px;color:rgba(168,85,247,.5);text-decoration:none;margin-top:16px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;transition:color .2s';
  partnerLink.addEventListener('mouseenter',()=>{partnerLink.style.color='#c4b5fd';});
  partnerLink.addEventListener('mouseleave',()=>{partnerLink.style.color='rgba(168,85,247,.5)';});
  pinMod.querySelector('.pin-error-shell').parentNode.appendChild(partnerLink);

  // Triple-click Trust Layer shield → PIN Gate
  let tlClicks = 0;
  let tlTimer = null;
  const tlBadge = footer.querySelector('.tl-admin-trigger');
  if (tlBadge) {
    tlBadge.addEventListener('click', (e) => {
      e.preventDefault();
      tlClicks++;
      clearTimeout(tlTimer);
      if (tlClicks >= 3) {
        tlClicks = 0;
        shellPin = '';
        updShellDots();
        pinMod.querySelector('.pin-error-shell').style.display = 'none';
        pinMod.style.display = 'flex';
      }
      tlTimer = setTimeout(() => { tlClicks = 0; }, 800);
    });
  }
}

document.addEventListener('DOMContentLoaded', injectShell);
