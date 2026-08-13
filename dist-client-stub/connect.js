(function () {
  "use strict";

  var urlInput = document.getElementById("url");
  var statusEl = document.getElementById("status");
  var connectBtn = document.getElementById("connect");
  var scanBtn = document.getElementById("scan");

  function invoke(cmd, args) {
    var w = window;
    var t = w.__TAURI__;
    if (!t) return Promise.reject(new Error("Tauri runtime tidak tersedia"));
    var fn = typeof t.invoke === "function" ? t.invoke : t.core && t.core.invoke;
    if (!fn) return Promise.reject(new Error("Tauri invoke tidak tersedia"));
    return fn(cmd, args);
  }

  function goto(url) {
    window.location.href = url;
  }

  function setStatus(msg, ok) {
    statusEl.textContent = msg || "";
    statusEl.style.color = ok ? "#16a34a" : "#dc2626";
  }

  function busy(bool) {
    connectBtn.disabled = bool;
    scanBtn.disabled = bool;
  }

  async function detect() {
    try {
      var url = await invoke("get_detected_api_url", { ports: [3000, 3001, 3002] });
      if (url) {
        localStorage.setItem("wms_api_url", url);
        setStatus("Ditemukan: " + url + " — memuat aplikasi...", true);
        setTimeout(function () { goto(url); }, 300);
        return true;
      }
    } catch (e) { /* scan gagal, lanjut manual */ }
    return false;
  }

  async function testAndConnect() {
    var raw = urlInput.value.trim().replace(/\/+$/, "");
    if (!raw) { setStatus("Masukkan alamat server terlebih dahulu."); return; }
    if (!/^https?:\/\//i.test(raw)) raw = "http://" + raw;
    busy(true);
    setStatus("Menghubungkan ke " + raw + " ...");
    try {
      var ok = await invoke("check_server_url", { url: raw });
      if (ok) {
        localStorage.setItem("wms_api_url", raw);
        setStatus("Terhubung ke " + raw + " — memuat aplikasi...", true);
        setTimeout(function () { goto(raw); }, 300);
      } else {
        setStatus("Tidak dapat menjangkau " + raw + ". Periksa IP/port server dan firewall.");
      }
    } catch (e) {
      setStatus("Koneksi gagal: " + (e && e.message ? e.message : String(e)));
    } finally {
      busy(false);
    }
  }

  async function scan() {
    busy(true);
    setStatus("Memindai jaringan (subnet /24)...");
    var found = await detect();
    if (!found) {
      setStatus("Tidak menemukan server di jaringan ini. Coba isi alamat server secara manual.");
    }
    busy(false);
  }

  connectBtn.addEventListener("click", testAndConnect);
  scanBtn.addEventListener("click", scan);
  urlInput.addEventListener("keydown", function (e) { if (e.key === "Enter") testAndConnect(); });

  var cached = localStorage.getItem("wms_api_url");
  if (cached) urlInput.value = cached;

  detect().then(function (found) {
    if (!found) {
      setStatus("Server tidak ditemukan di jaringan — masukkan alamat server di bawah.");
    }
  });
})();