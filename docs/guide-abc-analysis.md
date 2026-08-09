# Panduan Halaman ABC Analysis — Thermaltrue WMS v1.0.4

Lokasi menu: **Analysis → ABC Analysis** (rute `/analysis/abc`). Halaman mengelompokkan seluruh material aktif ke dalam kelas **A / B / C** berdasarkan kepentingannya, plus kelas **XYZ** berdasarkan kestabilan pemakaian. Engine di backend: `/api/abc-analysis/classify` & `/api/abc-analysis/summary` (`handlers/abc.rs`), hasil disimpan ke tabel `abc_classification` (per hari) dan otomatis menyebar ke `material_metrics` — sehingga kolom ABC di halaman **Material Analysis** ikut terisi.

---

## 1. Fungsi & Kegunaan Umum

1. **Memilah material berdasarkan nilai** — kelas A (nilai besar, sedikit item), B (menengah), C (kecil, banyak item) — fokus pengawasan ke yang paling berdampak terhadap nilai persediaan.
2. **Mengukur kestabilan pemakaian (XYZ)** — item stabil (X) vs fluktuatif (Y) vs sporadik (Z) sebagai dasar kebijakan stok pengaman.
3. **Menyesuaikan metode analisis** — mode **Single Factor** (klasik, berbasis nilai) atau **Multi-Factor** (skor gabungan nilai + frekuensi + kebaruan, dengan bobot yang bisa diatur).
4. **Menjalankan ulang klasifikasi kapan saja** — setelah data transaksi berubah/bertambah.
5. **Melihat distribusi nilai** antar kelas (pie/treemap) dan rekap kelas XYZ dalam satu kartu.
6. **Export per kelas** ke XLSX (3 sheet: Class A, B, C) untuk laporan.

---

## 2. Isi Halaman Per Bagian

### 2.1. Toolbar (atas kanan)

| Tombol | Fungsi |
|--------|--------|
| **Single Factor / Multi-Factor** | Toggle mode klasifikasi (subjudul halaman ikut berubah) |
| **Weights (…/…/…)** | Buka dialog pengaturan bobot (hanya di mode Multi) |
| **Run Classification** | Jalankan ulang klasifikasi dengan data terkini |
| **Pie / Tree** | Ganti tampilan grafik distribusi nilai |
| **Export XLSX** | Unduh 3 sheet per kelas |
| **Search** | Filter tabel per nama / SKU |

### 2.2. Empat Kartu Ringkasan

- **Total Classified** — jumlah seluruh material yang terklasifikasi
- **Class A** (merah) / **Class B** (kuning) / **Class C** (hijau) — jumlah item per kelas (dari `abc_summary`, periode hari ini)

### 2.3. Grafik "Value Distribution" — Pie atau Treemap

- **Pie**: proporsi nilai persediaan kelas A (merah), B (kuning), C (hijau)
- **Treemap**: peta besar-kecil nilai per material (warna sesuai kelas)

### 2.4. Kartu "XYZ Classification (Stability)"

Tiga baris (jumlah item + %):

| Kelas | Arti | Kriteria (variasi pemakaian bulanan) |
|-------|------|--------------------------------------|
| **X** (hijau) | Stabil | CV < 0.5 |
| **Y** (kuning) | Fluktuatif | 0.5 ≤ CV < 1 |
| **Z** (merah) | Sporadis | CV ≥ 1 |

### 2.5. Tabel per Kelas (Class A, Class B, Class C)

Satu Card per kelas, judul berisi `n of N` item, total nilai, dan % kontribusi. Kolom:

| Kolom | Isi |
|-------|-----|
| SKU / Name | Identitas |
| Stock | stok saat ini |
| Value | `stok × harga` |
| % of Total | kontribusi nilai material vs seluruh nilai |
| Class | badge kelas |
| XYZ | kelas + `Score: <composite_score>` |

Subtotal per kelas di baris paling bawah.

---

## 3. Cara Pemakaian (Workflow)

1. **Buka halaman** — hasil klasifikasi terbaru muncul otomatis (query `classify` + `summary`).
2. **Pilih mode**:
   - **Single Factor** (default): klasifikasi berdasarkan **kontribusi nilai** saja.
   - **Multi-Factor**: jika perlu memperhitungkan frekuensi & kebaruan transaksi juga.
3. **(Opsional, mode Multi)** klik **Weights** → geser slider (Inventory Value / Turnover / Recency) → **Save Weights** (tersimpan di DB, dinormalisasi otomatis).
4. **Run Classification** setelah mode/bobot berubah atau data baru masuk — hasil tersimpan sebagai riwayat harian di `abc_classification`.
5. **Tinjau 4 kartu + pie/treemap** — lihat proporsi nilai antar kelas.
6. **Buka tabel per kelas** dan cari material dengan kotak pencarian.
7. **Export XLSX** untuk laporan.

---

## 4. Cara Analisis Per Material (Step by Step)

1. **Cari material** di tabel kelas (atau lihat kolom "ABC" di halaman **Material Analysis**).
2. **Pahami makna kelas**:
   - **A** → material bernilai/konsumsi **tertinggi** (≈ 80% kontribusi di mode single, atau skor gabungan tinggi). Kebijakan: kontrol ketat — cycle counting rutin, min stock ditegakkan, prioritas purchasing.
   - **B** → menengah. Kendali standar.
   - **C** → banyak item kecil. Kendali ringan; buffer boleh lebih longgar karena biayanya murah.
3. **Baca kelas XYZ material**:
   - **X** (stabil) → pola teratur → bisa **kurangi safety stock**.
   - **Y** (fluktuatif) → naik-turun → safety stock sedang.
   - **Z** (sporadis) → jarang tapi tiba-tiba besar → simpan buffer ekstra atau jadikan make-to-order.
4. **Kombinasikan kelas** — misal **A-X** = penting & stabil (kelola presisi, efisien), **C-Z** = kecil & sporadis (beli saat dibutuhkan).
5. **Lihat composite score** pada kolom XYZ — membandingkan kekuatan antar material sekelas.
6. **Pantau perpindahan kelas antar hari** (riwayat `abc_classification`) — perpindahan cepat menandakan pola berubah, perlu perhatian.
7. **Aksi**: sesuaikan quantity reorder, evaluasi supplier untuk kelas Z, audit stok kelas A, dokumentasi via Export XLSX.

---

## 5. Cara Kerja Teknis (Formula)

- **Single Factor**: urut berdasarkan `consumption_12mo` menurun; kontribusi item = `konsumsi / total konsumsi × 100%`; kumulatif ≤ 80% → A, ≤ 95% → B, sisanya C.
- **Multi-Factor**: skor = `norm_nilai × w_value + norm_turnover × w_turnover + norm_recency × w_recency` (dinormalisasi terhadap nilai maksimum; `recency = 1/(hari+1)`; bobot dari tabel `abc_weights`, default 0.4/0.3/0.3, otomatis dinormalisasi). A jika skor ≥ 0.05, B jika ≥ 0.015, selainnya C.
- **XYZ**: `CV = std dev konsumsi bulanan (12 bulan) / rata-rata` — batas X/Y/Z sesuai tabel §2.4.
- **Riwayat**: disimpan ke `abc_classification` (period harian, `analysis_mode`, `abc_class`, `xyz_class`, `composite_score`, `value_contribution_pct`, `consumption_12mo`, `turnover`, `current_qty`, `unit_price`, `inventory_value`, `previous_class`, `days_since_class_change`), lalu `material_metrics` diperbarui agar Material Analysis ikut menunjukkan badge ABC.
- Akses: permission `view_dashboard`, scope gudang pengguna (warehouse-scoped).

---

_© 2026 Thermaltrue — update terakhir: v1.0.4._