# Panduan Halaman Forecaster Analysis — Thermaltrue WMS v1.0.4

Lokasi menu: **Analysis → Forecaster** (rute `/analysis/forecast`). Halaman menjalankan **peramalan permintaan** dengan **8 model pembanding sekaligus** di sisi client, plus hasil forecast **server-side** untuk semua material yang tersimpan di tabel `forecast_metrics` (backend `handlers/forecast.rs`, endpoint `/api/forecast/generate`, `/api/forecast/summary`, `/api/forecast/details`).

---

## 1. Fungsi & Kegunaan Umum

1. **Memperkirakan kebutuhan 1, 3, 6 bulan ke depan** per material — dasar jumlah pembelian/reorder.
2. **Membandingkan 8 model statistik** untuk memilih yang paling akurat per material (MAPE terendah).
3. **Mendeteksi tren permintaan** (naik ▲ / turun ▼ / stabil →) dan **pola musiman**.
4. **Mendapatkan rekomendasi reorder otomatis** — stok cukup atau harus segera beli.
5. **Menghasilkan forecast server-side untuk semua material sekaligus** (Generate Forecast) dan menyimpannya sebagai riwayat harian.
6. **Memantau akurasi**: MAPE, MAE, RMSE per model + interval kepercayaan (confidence bound).
7. **Cache per material + parameter** agar hasil cepat tampil ulang tanpa hitung ulang.

---

## 2. Isi Halaman Per Bagian

### 2.1. Tombol "Generate Forecast" (kanan atas)

Menjalankan perhitungan forecast **untuk semua material aktif** di server (model terbaik: SMA-3 / SES / Holt) → disimpan ke `forecast_metrics` periode hari ini. Setelah sukses muncul notifikasi `Forecast generated (n materials processed)`.

### 2.2. Empat Kartu Ringkasan

| Kartu | Isi |
|-------|-----|
| **Forecasted Materials** | `n of total` — berapa material sudah punya forecast untuk periode hari ini |
| **Trending Up** (hijau) | jumlah material dengan tren naik ▲ |
| **Trending Down** (merah) | jumlah material dengan tren turun ▼ |
| **Avg MAPE** (oranye) | rata-rata kesalahan prediksi semua material + `Seasonal: n items` |

### 2.3. Tabel "Persisted Forecast (Server-Generated)"

Muncul jika sudah pernah Generate. Kolom: Material, SKU, **Forecast 1mo / 3mo / 6mo**, **MAPE %**, **Trend** (ikon ▲/▼/→), **Seasonal** (badge Yes/No). Ini hasil resmi untuk seluruh material — bahan keputusan pembelian & laporan.

### 2.4. "Forecast Controls" (panel pengaturan)

| Kontrol | Fungsi |
|---------|--------|
| **Material** | Pilih satu material untuk analisis detail |
| **History Period** | Riwayat yang dipakai: 6 / 12 / 24 bulan |
| **Horizon** | 1 / 3 / 6 / 12 bulan ke depan yang diramalkan |
| **α (alpha)** | slider 0.01–0.99 (default 0.3) — bobot data terbaru (SES/Holt/HW) |
| **β (beta)** | slider 0.01–0.99 (default 0.1) — bobot tren |
| **γ (gamma)** | slider 0.01–0.99 (default 0.1) — bobot musiman |
| **Cache** | badge `Loaded from cache` / `Live computation` + tombol **Save Cache** / **Clear Cache** |

### 2.5. Grafik "Forecast Comparison — {material}"

Line chart: garis hitam tebal **Actual** (riwayat) + 8 garis putus-putus berwarna (satu per model) + titik forecast horizon per model. Memperlihatkan model mana yang mendekati actual dan arah forecast ke depan.

### 2.6. Tabel "Model Accuracy Comparison"

8 model dengan kolom **Forecast**, **MAPE %**, **MAE**, **RMSE**, **Rating** — baris model terbaik (MAPE terendah) di-highlight hijau + badge **"Best Model (lowest MAPE)"**.

### 2.7. Export XLSX

2 sheet: **Model Accuracy** (8 model + 4 metrik + rating) dan **Persisted Forecast** (material, forecast 1/3/6, MAPE, trend, seasonal).

---

## 3. Cara Pemakaian (Workflow)

1. **Klik Generate Forecast** (guna pertama / setelah data transaksi baru) → isi 4 kartu & tabel Persisted.
2. **Baca 4 kartu ringkasan**: berapa material perlu perhatian (trend down, seasonal, MAPE tinggi).
3. **Pilih material** → atur History Period & Horizon → geser alpha/beta/gamma sesuai kebutuhan.
4. **Lihat grafik perbandingan & tabel akurasi** — kenali model terbaik untuk material itu.
5. **Export XLSX** untuk rekap pembelian / perencanaan restock.

---

## 4. Cara Analisis Per Material (Step by Step)

1. **Pilih material** di `Forecast Controls`.
2. **Baca hasil server** di tabel Persisted: forecast 1/3/6 bulan + MAPE. MAPE < 10% = akurat; di atas 20% = pertimbangkan parameter lain / material sulit diprediksi.
3. **Lihat tren** (▲/▼/→): turun → kurangi pembelian; naik → amankan stok lebih awal.
4. **Lihat is_seasonal**: Ya → siapkan buffer sebelum puncak musiman; Tidak → forecast linear cukup.
5. **Bandingkan 8 model di tabel akurasi** — pakai angka model dengan MAPE terkecil sebagai patokan jumlah pembelian.
6. **Baca rekomendasi**: `Reorder needed: current X < forecast Y/mo` bila ramalan 1 bulan > stok saat ini → segera buat PO.
7. **Save Cache** untuk menyimpan hasil, **Export XLSX** untuk laporan.

---

## 5. Cara Kerja Teknis (Formula)

**Client — 8 model** (riwayat dibangun dari konsumsi 3/6/12 bulan, disintesis dengan variasi kecil):
- **SMA n**: rata-rata n bulan terakhir (n = 3, 6, 12)
- **WMA**: rata-rata tertimbang `Σ v_i·(i+1) / Σ(i+1)`
- **SES**: `s_t = α·x_t + (1−α)·s_(t−1)`
- **Holt**: level + tren (α, β); ramalan = `level + trend`
- **Holt-Winters**: level + tren + musiman (periode 4)
- **Linear Regression**: garis least-squares → proyeksi ke depan
- Akurasi in-sample (MAPE/MAE/RMSE) → **best model = MAPE terendah**

**Server (Generate Forecast)**:
- Riwayat bulanan 12 bulan dari transaksi `out` asli; model dipilih di antara **SMA3 / SES(0.3) / Holt(0.3, 0.1)** berdasarkan total error in-sample terkecil.
- `f1` = hasil model terbaik; `f3 = f1 × 3`, `f6 = f1 × 6`.
- **Confidence**: rentang ±(1.96 × standar deviasi × √horizon).
- **Seasonal index** per kuartal; `is_seasonal` jika deviasi > 20%.
- **Trend**: rata-rata 3 bulan terakhir dibanding awal ±5%.
- **Rekomendasi**: `Reorder needed` bila `f1 > stok saat ini`.
- Tersimpan di `forecast_metrics` (periode harian, model `best`); summary & details dibaca dari tabel itu.

Akses: permission `view_dashboard`, scope gudang (warehouse-scoped).

---

_© 2026 Thermaltrue — update terakhir: v1.0.4._